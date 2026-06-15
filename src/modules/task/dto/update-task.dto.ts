import {
    IsEnum,
    IsISO8601,
    IsOptional,
    IsString,
    MaxLength,
} from 'class-validator';
import { TaskPriority, TaskStatus } from 'src/database/enums';

// All fields optional. `null` is allowed for assigneeId (unassign) and dueDate (clear) — @IsOptional
// skips validation when the value is null or undefined, so an explicit null passes through.
export class UpdateTaskDto {
    @IsOptional()
    @IsString()
    @MaxLength(300)
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(10000)
    description?: string | null;

    @IsOptional()
    @IsEnum(TaskStatus)
    status?: TaskStatus;

    @IsOptional()
    @IsEnum(TaskPriority)
    priority?: TaskPriority;

    @IsOptional()
    @IsISO8601()
    dueDate?: string | null;

    @IsOptional()
    @IsString()
    assigneeId?: string | null;
}
