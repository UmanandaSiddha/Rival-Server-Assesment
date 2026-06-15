import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PoolClient } from 'pg';
import { TASK_COMMAND_QUEUE } from 'src/config/constants';
import { DatabaseService } from 'src/services/database/database.service';
import { toCamelCaseDeep } from 'src/services/common/case-conversion.util';
import { TaskActivityAction, TaskStatus } from 'src/database/enums';
import { RealtimePublisher } from '../../modules/realtime/realtime.publisher';
import {
    CreateTaskData,
    TaskCommand,
    TASK_NOT_FOUND,
    UpdateTaskData,
} from './task.commands';

const MUTABLE_FIELDS = [
    'title',
    'description',
    'status',
    'priority',
    'dueDate',
    'assigneeId',
] as const;

/**
 * Single serialized writer for tasks (concurrency 1 = strict FIFO ordering).
 * Each command runs in one transaction — mutate Task, bump `version`, append TaskActivity —
 * then broadcasts committed state. `version` is the convergence token clients reconcile to.
 */
@Processor(TASK_COMMAND_QUEUE, { concurrency: 1 })
export class TaskProcessor extends WorkerHost {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly publisher: RealtimePublisher,
    ) {
        super();
    }

    async process(job: Job<TaskCommand>): Promise<any> {
        const command = job.data;
        switch (command.type) {
            case 'create':
                return this.handleCreate(
                    command.teamId,
                    command.actorId,
                    command.data,
                );
            case 'update':
                return this.handleUpdate(
                    command.teamId,
                    command.taskId,
                    command.actorId,
                    command.data,
                );
            case 'delete':
                return this.handleDelete(
                    command.teamId,
                    command.taskId,
                    command.actorId,
                );
        }
    }

    private async handleCreate(
        teamId: string,
        actorId: string,
        data: CreateTaskData,
    ): Promise<any> {
        const task = await this.databaseService.withTransaction(
            async (client) => {
                const completedAt =
                    data.status === TaskStatus.DONE ? 'now()' : 'NULL';
                const insert = await client.query(
                    `
                    INSERT INTO "Task"
                        ("teamId", "createdById", "assigneeId", "title", "description", "status", "priority", "dueDate", "completedAt")
                    VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'TODO')::"TaskStatus", COALESCE($7, 'MEDIUM')::"TaskPriority", $8, ${completedAt})
                    RETURNING *
                `,
                    [
                        teamId,
                        actorId,
                        data.assigneeId ?? null,
                        data.title,
                        data.description ?? null,
                        data.status ?? null,
                        data.priority ?? null,
                        data.dueDate ?? null,
                    ],
                );
                const row = insert.rows[0];

                await this.appendActivity(
                    client,
                    row.id,
                    actorId,
                    TaskActivityAction.CREATED,
                    {},
                );
                return toCamelCaseDeep(row);
            },
        );

        await this.publisher.emitToTeam(
            teamId,
            'task.created',
            { task },
            actorId,
        );
        return task;
    }

    private async handleUpdate(
        teamId: string,
        taskId: string,
        actorId: string,
        data: UpdateTaskData,
    ): Promise<any> {
        const outcome = await this.databaseService.withTransaction(
            async (client) => {
                const currentResult = await client.query(
                    `SELECT * FROM "Task" WHERE "id" = $1`,
                    [taskId],
                );
                const current = currentResult.rows[0];
                if (!current) throw new Error(TASK_NOT_FOUND);

                const sets: string[] = [];
                const params: any[] = [];
                let i = 1;
                for (const field of MUTABLE_FIELDS) {
                    if (field in data) {
                        sets.push(`"${field}" = $${i++}`);
                        params.push((data as any)[field]);
                    }
                }

                // Completed/reopened timestamp follows status transitions in/out of DONE.
                if ('status' in data) {
                    if (
                        data.status === TaskStatus.DONE &&
                        current.status !== TaskStatus.DONE
                    ) {
                        sets.push(`"completedAt" = now()`);
                    } else if (
                        data.status !== TaskStatus.DONE &&
                        current.status === TaskStatus.DONE
                    ) {
                        sets.push(`"completedAt" = NULL`);
                    }
                }

                sets.push(`"version" = "version" + 1`);
                sets.push(`"updated_at" = now()`);

                params.push(taskId);
                const updateResult = await client.query(
                    `UPDATE "Task" SET ${sets.join(', ')} WHERE "id" = $${i} RETURNING *`,
                    params,
                );
                const row = updateResult.rows[0];

                const changes = this.diff(current, data);
                const action = this.deriveAction(current, data, changes);
                await this.appendActivity(
                    client,
                    taskId,
                    actorId,
                    action,
                    changes,
                );

                return { task: toCamelCaseDeep(row), changes, action };
            },
        );

        await this.publisher.emitToTeam(
            teamId,
            'task.updated',
            {
                task: outcome.task,
                changes: outcome.changes,
                action: outcome.action,
            },
            actorId,
        );
        return outcome.task;
    }

    private async handleDelete(
        teamId: string,
        taskId: string,
        actorId: string,
    ): Promise<{ id: string }> {
        const deleted = await this.databaseService.query(
            `DELETE FROM "Task" WHERE "id" = $1 RETURNING "id"`,
            [taskId],
        );
        if (!deleted.rows[0]) throw new Error(TASK_NOT_FOUND);

        await this.publisher.emitToTeam(
            teamId,
            'task.deleted',
            { taskId },
            actorId,
        );
        return { id: taskId };
    }

    private async appendActivity(
        client: PoolClient,
        taskId: string,
        actorId: string,
        action: TaskActivityAction,
        changes: Record<string, unknown>,
    ): Promise<void> {
        await client.query(
            `INSERT INTO "TaskActivity" ("taskId", "userId", "action", "changes") VALUES ($1, $2, $3, $4)`,
            [taskId, actorId, action, JSON.stringify(changes)],
        );
    }

    /** Field-level before/after diff for the activity log (only fields present in the update). */
    private diff(
        current: any,
        data: UpdateTaskData,
    ): Record<string, { from: any; to: any }> {
        const changes: Record<string, { from: any; to: any }> = {};
        for (const field of MUTABLE_FIELDS) {
            if (!(field in data)) continue;
            const before = current[field] ?? null;
            const after = (data as any)[field] ?? null;
            if (String(before) !== String(after)) {
                changes[field] = { from: before, to: after };
            }
        }
        return changes;
    }

    private deriveAction(
        current: any,
        data: UpdateTaskData,
        changes: Record<string, unknown>,
    ): TaskActivityAction {
        if ('status' in changes) {
            if (data.status === TaskStatus.DONE)
                return TaskActivityAction.COMPLETED;
            if (current.status === TaskStatus.DONE)
                return TaskActivityAction.REOPENED;
            return TaskActivityAction.STATUS_CHANGED;
        }
        if ('assigneeId' in changes) return TaskActivityAction.ASSIGNED;
        return TaskActivityAction.UPDATED;
    }
}
