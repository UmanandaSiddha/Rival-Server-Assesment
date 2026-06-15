import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

/**
 * Tasks. Reads hit the DB directly; writes are dispatched to the TaskCommandQueue
 * (in QueueModule, global) and applied by the serialized TaskProcessor.
 */
@Module({
    imports: [AuthModule],
    controllers: [TaskController],
    providers: [TaskService],
    exports: [TaskService],
})
export class TaskModule {}
