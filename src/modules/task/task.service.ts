import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { toCamelCaseDeep } from 'src/services/common/case-conversion.util';
import { Permission, UserRole } from 'src/database/enums';
import { AuthorizationService } from '../auth/authorization.service';
import { TaskCommandQueue } from 'src/services/queue/task-command.queue';
import { TASK_NOT_FOUND, TaskCommand } from 'src/services/queue/task.commands';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';

interface RequestUser {
    id: string;
    role?: UserRole;
}

const SORT_COLUMNS: Record<string, string> = {
    dueDate: '"dueDate"',
    priority: 'priority',
    createdAt: '"created_at"',
    updatedAt: '"updated_at"',
};

@Injectable()
export class TaskService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly authorizationService: AuthorizationService,
        private readonly commandQueue: TaskCommandQueue,
    ) {}

    // --- Writes: authorize synchronously, then run through the serialized command pipeline ---

    async create(user: RequestUser, dto: CreateTaskDto): Promise<any> {
        await this.authorizationService.assertTeamPermission(
            user.id,
            dto.teamId,
            Permission.TASK_CREATE,
            user.role,
        );

        if (dto.assigneeId) {
            await this.assertAssigneeIsMember(dto.teamId, dto.assigneeId);
        }

        return this.runCommand({
            type: 'create',
            teamId: dto.teamId,
            actorId: user.id,
            data: {
                title: dto.title,
                description: dto.description ?? null,
                status: dto.status,
                priority: dto.priority,
                dueDate: dto.dueDate ?? null,
                assigneeId: dto.assigneeId ?? null,
            },
        });
    }

    async update(
        user: RequestUser,
        taskId: string,
        dto: UpdateTaskDto,
    ): Promise<any> {
        const keys = Object.keys(dto);
        if (keys.length === 0)
            throw new BadRequestException('No fields to update');

        const access = await this.authorizationService.getTaskAccess(
            user.id,
            taskId,
            user.role,
        );

        // Field-specific permissions (owner/app-admin bypass inside assertCan).
        if ('status' in dto)
            this.authorizationService.assertCan(
                access,
                Permission.TASK_UPDATE_STATUS,
            );
        if ('priority' in dto)
            this.authorizationService.assertCan(
                access,
                Permission.TASK_UPDATE_PRIORITY,
            );
        if ('assigneeId' in dto)
            this.authorizationService.assertCan(access, Permission.TASK_ASSIGN);
        if ('title' in dto || 'description' in dto || 'dueDate' in dto) {
            this.authorizationService.assertCan(access, Permission.TASK_UPDATE);
        }

        if (dto.assigneeId) {
            await this.assertAssigneeIsMember(access.teamId, dto.assigneeId);
        }

        return this.runCommand({
            type: 'update',
            taskId,
            teamId: access.teamId,
            actorId: user.id,
            data: { ...dto },
        });
    }

    async remove(user: RequestUser, taskId: string): Promise<{ id: string }> {
        const access = await this.authorizationService.getTaskAccess(
            user.id,
            taskId,
            user.role,
        );
        this.authorizationService.assertCan(access, Permission.TASK_DELETE);
        return this.runCommand({
            type: 'delete',
            taskId,
            teamId: access.teamId,
            actorId: user.id,
        });
    }

    // --- Reads: direct DB, no queue ---

    async findOne(user: RequestUser, taskId: string): Promise<any> {
        const access = await this.authorizationService.getTaskAccess(
            user.id,
            taskId,
            user.role,
        );
        this.authorizationService.assertCan(access, Permission.TASK_READ);

        const result = await this.databaseService.query(
            `SELECT * FROM "Task" WHERE "id" = $1 LIMIT 1`,
            [taskId],
        );
        return toCamelCaseDeep(result.rows[0]);
    }

    async list(user: RequestUser, query: ListTasksQueryDto) {
        const page = query.page ?? 1;
        const limit = query.limit ?? 20;
        const offset = (page - 1) * limit;
        const isAdmin = user.role === UserRole.ADMIN;

        const where: string[] = [];
        const params: any[] = [];
        let i = 1;

        if (query.teamId) {
            if (!isAdmin) {
                await this.authorizationService.assertTeamMembership(
                    user.id,
                    query.teamId,
                    user.role,
                );
            }
            where.push(`t."teamId" = $${i++}`);
            params.push(query.teamId);
        } else if (!isAdmin) {
            // Only tasks in teams the caller is a member of or owns.
            const p = i++;
            where.push(
                `(t."teamId" IN (SELECT "teamId" FROM "TeamMember" WHERE "userId" = $${p})
                    OR EXISTS (SELECT 1 FROM "Team" tt WHERE tt."id" = t."teamId" AND tt."ownerId" = $${p}))`,
            );
            params.push(user.id);
        }

        if (query.status) {
            where.push(`t."status" = $${i++}`);
            params.push(query.status);
        }
        if (query.assigneeId) {
            where.push(`t."assigneeId" = $${i++}`);
            params.push(query.assigneeId);
        }
        if (query.search) {
            where.push(`t."title" ILIKE $${i++}`);
            params.push(`%${query.search}%`);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const sortColumn = SORT_COLUMNS[query.sort ?? 'createdAt'];
        const order = (query.order ?? 'desc').toUpperCase();

        const dataSql = `
            SELECT t.* FROM "Task" t
            ${whereSql}
            ORDER BY ${sortColumn} ${order} NULLS LAST, t."id" ${order}
            LIMIT $${i++} OFFSET $${i++}
        `;
        const dataResult = await this.databaseService.query(dataSql, [
            ...params,
            limit,
            offset,
        ]);

        const countResult = await this.databaseService.query(
            `SELECT COUNT(*)::int AS total FROM "Task" t ${whereSql}`,
            params,
        );
        const total = countResult.rows[0]?.total ?? 0;

        return {
            data: toCamelCaseDeep(dataResult.rows),
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0,
        };
    }

    async activity(user: RequestUser, taskId: string, page = 1, limit = 50) {
        const access = await this.authorizationService.getTaskAccess(
            user.id,
            taskId,
            user.role,
        );
        this.authorizationService.assertCan(access, Permission.TASK_READ);

        const offset = (page - 1) * limit;
        const result = await this.databaseService.query(
            `
                SELECT ta.*, u."firstName" AS "actorFirstName", u."lastName" AS "actorLastName"
                FROM "TaskActivity" ta
                LEFT JOIN "User" u ON u."id" = ta."userId"
                WHERE ta."taskId" = $1
                ORDER BY ta."created_at" DESC
                LIMIT $2 OFFSET $3
            `,
            [taskId, limit, offset],
        );
        return toCamelCaseDeep(result.rows);
    }

    // --- Helpers ---

    private async assertAssigneeIsMember(
        teamId: string,
        assigneeId: string,
    ): Promise<void> {
        const result = await this.databaseService.query(
            `
                SELECT 1
                FROM "TeamMember"
                WHERE "teamId" = $1 AND "userId" = $2
                UNION
                SELECT 1
                FROM "Team"
                WHERE "id" = $1 AND "ownerId" = $2
                LIMIT 1
            `,
            [teamId, assigneeId],
        );
        if (!result.rows[0]) {
            throw new BadRequestException(
                'Assignee is not a member of this team',
            );
        }
    }

    private async runCommand(command: TaskCommand): Promise<any> {
        try {
            return await this.commandQueue.dispatch(command);
        } catch (error: any) {
            if (error?.message === TASK_NOT_FOUND) {
                throw new NotFoundException('Task not found');
            }
            throw error;
        }
    }
}
