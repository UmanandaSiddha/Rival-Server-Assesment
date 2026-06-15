import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Query,
    UseGuards,
} from '@nestjs/common';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/decorator/role.decorator';
import { UserRole } from 'src/database/enums';
import { AdminService } from './admin.service';
import { ListQueryDto } from './dto/list-query.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { SetUserDisabledDto } from './dto/set-user-disabled.dto';
import { ListTasksQueryDto } from '../task/dto/list-tasks-query.dto';

interface RequestUser {
    id: string;
    role?: UserRole;
}

/** Platform-admin endpoints — gated by RoleGuard + @Roles(ADMIN) (app-level role, not team role). */
@Controller('admin')
@UseGuards(AuthGuard, RoleGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
    constructor(private readonly adminService: AdminService) {}

    @Get('users')
    listUsers(@Query() query: ListQueryDto) {
        return this.adminService.listUsers(query);
    }

    @Get('teams')
    listTeams(@Query() query: ListQueryDto) {
        return this.adminService.listTeams(query);
    }

    @Get('tasks')
    listTasks(@getUser() user: RequestUser, @Query() query: ListTasksQueryDto) {
        return this.adminService.listTasks(user, query);
    }

    @Patch('users/:id/role')
    updateUserRole(
        @getUser('id') adminId: string,
        @Param('id') targetUserId: string,
        @Body() dto: UpdateUserRoleDto,
    ) {
        return this.adminService.updateUserRole(
            adminId,
            targetUserId,
            dto.role,
        );
    }

    @Patch('users/:id/disable')
    setUserDisabled(
        @getUser('id') adminId: string,
        @Param('id') targetUserId: string,
        @Body() dto: SetUserDisabledDto,
    ) {
        return this.adminService.setUserDisabled(
            adminId,
            targetUserId,
            dto.disabled,
        );
    }
}
