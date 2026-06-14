import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { TaskStatus } from 'src/database/enums';

export const TASK_SORT_FIELDS = ['dueDate', 'priority', 'createdAt', 'updatedAt'] as const;
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

export class ListTasksQueryDto {
    // Scope to a single team (membership is checked). Omit to list across all the caller's teams.
    @IsOptional()
    @IsString()
    teamId?: string;

    @IsOptional()
    @IsEnum(TaskStatus)
    status?: TaskStatus;

    @IsOptional()
    @IsString()
    assigneeId?: string;

    // Case-insensitive title search (trigram-indexed).
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsEnum(TASK_SORT_FIELDS)
    sort?: TaskSortField;

    @IsOptional()
    @IsEnum(['asc', 'desc'])
    order?: 'asc' | 'desc';

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}
