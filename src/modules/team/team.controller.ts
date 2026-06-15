import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { UserRole } from 'src/database/enums';
import { TeamService } from './team.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

interface RequestUser {
    id: string;
    role?: UserRole;
}

@Controller('teams')
@UseGuards(AuthGuard)
export class TeamController {
    constructor(private readonly teamService: TeamService) {}

    // Teams
    @Post()
    create(@getUser() user: RequestUser, @Body() dto: CreateTeamDto) {
        return this.teamService.create(user, dto);
    }

    @Get()
    list(@getUser() user: RequestUser) {
        return this.teamService.list(user);
    }

    @Get(':teamId')
    getOne(@getUser() user: RequestUser, @Param('teamId') teamId: string) {
        return this.teamService.getOne(user, teamId);
    }

    @Patch(':teamId')
    update(
        @getUser() user: RequestUser,
        @Param('teamId') teamId: string,
        @Body() dto: UpdateTeamDto,
    ) {
        return this.teamService.update(user, teamId, dto);
    }

    @Delete(':teamId')
    remove(@getUser() user: RequestUser, @Param('teamId') teamId: string) {
        return this.teamService.remove(user, teamId);
    }

    // Members
    @Get(':teamId/members')
    listMembers(@getUser() user: RequestUser, @Param('teamId') teamId: string) {
        return this.teamService.listMembers(user, teamId);
    }

    @Patch(':teamId/members/:userId')
    updateMemberRole(
        @getUser() user: RequestUser,
        @Param('teamId') teamId: string,
        @Param('userId') targetUserId: string,
        @Body() dto: UpdateMemberRoleDto,
    ) {
        return this.teamService.updateMemberRole(
            user,
            teamId,
            targetUserId,
            dto.roleId,
        );
    }

    @Delete(':teamId/members/:userId')
    removeMember(
        @getUser() user: RequestUser,
        @Param('teamId') teamId: string,
        @Param('userId') targetUserId: string,
    ) {
        return this.teamService.removeMember(user, teamId, targetUserId);
    }

    // Roles
    @Get(':teamId/roles')
    listRoles(@getUser() user: RequestUser, @Param('teamId') teamId: string) {
        return this.teamService.listRoles(user, teamId);
    }

    @Post(':teamId/roles')
    createRole(
        @getUser() user: RequestUser,
        @Param('teamId') teamId: string,
        @Body() dto: CreateRoleDto,
    ) {
        return this.teamService.createRole(user, teamId, dto);
    }

    @Patch(':teamId/roles/:roleId')
    updateRole(
        @getUser() user: RequestUser,
        @Param('teamId') teamId: string,
        @Param('roleId') roleId: string,
        @Body() dto: UpdateRoleDto,
    ) {
        return this.teamService.updateRole(user, teamId, roleId, dto);
    }

    @Delete(':teamId/roles/:roleId')
    deleteRole(
        @getUser() user: RequestUser,
        @Param('teamId') teamId: string,
        @Param('roleId') roleId: string,
    ) {
        return this.teamService.deleteRole(user, teamId, roleId);
    }
}
