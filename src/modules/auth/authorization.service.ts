import {
    Injectable,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { Permission, UserRole } from 'src/database/enums';
import { DatabaseService } from 'src/services/database/database.service';

/** A user's effective access in a team. `hasAll` (owner or app-admin) bypasses the permission list. */
export interface TeamAccess {
    teamId: string;
    isOwner: boolean;
    isAppAdmin: boolean;
    hasAll: boolean;
    permissions: Permission[];
}

/**
 * Team-scoped authorization. Members are gated by their role's permissions; the team owner and
 * app-level admins bypass roles (so editing a role can't lock the owner out).
 */
@Injectable()
export class AuthorizationService {
    constructor(private readonly databaseService: DatabaseService) {}

    /** Resolve a user's access in a team. Throws if the team is missing or the user isn't a member. */
    async getTeamAccess(
        userId: string,
        teamId: string,
        userRole?: UserRole,
    ): Promise<TeamAccess> {
        const isAppAdmin = userRole === UserRole.ADMIN;

        const teamResult = await this.databaseService.query<{
            ownerId: string;
        }>(`SELECT "ownerId" FROM "Team" WHERE "id" = $1 LIMIT 1`, [teamId]);
        const team = teamResult.rows[0];
        if (!team) throw new NotFoundException('Team not found');

        const isOwner = team.ownerId === userId;
        if (isOwner || isAppAdmin) {
            return {
                teamId,
                isOwner,
                isAppAdmin,
                hasAll: true,
                permissions: [],
            };
        }

        // Cast enum[] -> text[] so node-pg returns a real string[] (it can't parse custom enum arrays).
        const memberResult = await this.databaseService.query<{
            permissions: Permission[];
        }>(
            `
                SELECT r."permissions"::text[] AS permissions
                FROM "TeamMember" tm
                JOIN "Role" r ON r."id" = tm."roleId"
                WHERE tm."userId" = $1 AND tm."teamId" = $2
                LIMIT 1
            `,
            [userId, teamId],
        );
        const member = memberResult.rows[0];
        if (!member)
            throw new ForbiddenException('You are not a member of this team');

        return {
            teamId,
            isOwner: false,
            isAppAdmin: false,
            hasAll: false,
            permissions: member.permissions ?? [],
        };
    }

    /** Assert the user belongs to (or owns/administers) the team. Returns their access. */
    async assertTeamMembership(
        userId: string,
        teamId: string,
        userRole?: UserRole,
    ): Promise<TeamAccess> {
        return this.getTeamAccess(userId, teamId, userRole);
    }

    /** Assert the user holds `permission` in the team. Returns their access. */
    async assertTeamPermission(
        userId: string,
        teamId: string,
        permission: Permission,
        userRole?: UserRole,
    ): Promise<TeamAccess> {
        const access = await this.getTeamAccess(userId, teamId, userRole);
        if (access.hasAll || access.permissions.includes(permission)) {
            return access;
        }
        throw new ForbiddenException(`Missing permission: ${permission}`);
    }

    /** Resolve the caller's access to a task's team. Use when several permissions need checking. */
    async getTaskAccess(
        userId: string,
        taskId: string,
        userRole?: UserRole,
    ): Promise<TeamAccess> {
        const taskResult = await this.databaseService.query<{ teamId: string }>(
            `SELECT "teamId" FROM "Task" WHERE "id" = $1 LIMIT 1`,
            [taskId],
        );
        const task = taskResult.rows[0];
        if (!task) throw new NotFoundException('Task not found');

        return this.getTeamAccess(userId, task.teamId, userRole);
    }

    /** True if the access grants `permission` (owner/app-admin have all). */
    can(access: TeamAccess, permission: Permission): boolean {
        return access.hasAll || access.permissions.includes(permission);
    }

    /** Assert `permission` against an already-resolved access, else 403. */
    assertCan(access: TeamAccess, permission: Permission): void {
        if (!this.can(access, permission)) {
            throw new ForbiddenException(`Missing permission: ${permission}`);
        }
    }

    /** Resolve a task's team and assert `permission` on it — for flat /tasks/:id routes. */
    async assertTaskPermission(
        userId: string,
        taskId: string,
        permission: Permission,
        userRole?: UserRole,
    ): Promise<TeamAccess> {
        const access = await this.getTaskAccess(userId, taskId, userRole);
        this.assertCan(access, permission);
        return access;
    }
}
