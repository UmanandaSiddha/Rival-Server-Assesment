import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { UserRole } from 'src/database/enums';
import { TaskService } from './task.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';

interface RequestUser {
    id: string;
    role?: UserRole;
}

@Controller('tasks')
@UseGuards(AuthGuard)
export class TaskController {
    constructor(private readonly taskService: TaskService) {}

    @Post()
    create(@getUser() user: RequestUser, @Body() dto: CreateTaskDto) {
        return this.taskService.create(user, dto);
    }

    @Get()
    list(@getUser() user: RequestUser, @Query() query: ListTasksQueryDto) {
        return this.taskService.list(user, query);
    }

    @Get(':id')
    findOne(@getUser() user: RequestUser, @Param('id') id: string) {
        return this.taskService.findOne(user, id);
    }

    @Get(':id/activity')
    activity(@getUser() user: RequestUser, @Param('id') id: string) {
        return this.taskService.activity(user, id);
    }

    @Patch(':id')
    update(
        @getUser() user: RequestUser,
        @Param('id') id: string,
        @Body() dto: UpdateTaskDto,
    ) {
        return this.taskService.update(user, id, dto);
    }

    @Delete(':id')
    remove(@getUser() user: RequestUser, @Param('id') id: string) {
        return this.taskService.remove(user, id);
    }
}
