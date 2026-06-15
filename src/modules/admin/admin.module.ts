import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TaskModule } from '../task/task.module';
import { RoleGuard } from '../auth/guards/role.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/** Platform-admin APIs (users/teams/tasks + role & disable), gated by app-level ADMIN role. */
@Module({
    imports: [AuthModule, TaskModule],
    controllers: [AdminController],
    providers: [AdminService, RoleGuard],
})
export class AdminModule {}
