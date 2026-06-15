import { TaskPriority, TaskStatus } from 'src/database/enums';

export interface CreateTaskData {
    title: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
    assigneeId?: string | null;
}

export interface UpdateTaskData {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
    assigneeId?: string | null;
}

/**
 * Commands for the serialized task pipeline. Auth + existence are validated in TaskService
 * before enqueue, so the processor trusts the command. `actorId` is the issuing user.
 */
export type TaskCommand =
    | { type: 'create'; teamId: string; actorId: string; data: CreateTaskData }
    | { type: 'update'; taskId: string; teamId: string; actorId: string; data: UpdateTaskData }
    | { type: 'delete'; taskId: string; teamId: string; actorId: string };

// Error codes the processor throws across the queue boundary; TaskService maps them back to HTTP.
export const TASK_NOT_FOUND = 'TASK_NOT_FOUND';
