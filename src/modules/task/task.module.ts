import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TASK_COMMAND_QUEUE } from 'src/config/constants';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { TaskCommandQueue } from './task.command-queue';
import { TaskProcessor } from './task.processor';

/**
 * Tasks. Writes go through the serialized TaskCommandQueue → TaskProcessor (event-sourced pipeline);
 * reads hit the DB directly. RealtimeModule provides RealtimePublisher for post-commit broadcasts;
 * AuthModule provides the guard + AuthorizationService for permission checks.
 */
@Module({
    imports: [
        AuthModule,
        RealtimeModule,
        BullModule.registerQueue({ name: TASK_COMMAND_QUEUE }),
    ],
    controllers: [TaskController],
    providers: [TaskService, TaskCommandQueue, TaskProcessor],
    exports: [TaskService],
})
export class TaskModule { }
