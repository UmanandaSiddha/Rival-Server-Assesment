import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Permission, UserRole } from 'src/database/enums';
import { DatabaseService } from 'src/services/database/database.service';

/**
 * A user's effective access within a single team.
 * `hasAll` is true for the team owner (Team.ownerId) and app-level admins (User.role = 'ADMIN'),
 * who bypass the permission list entirely. Otherwise `permissions` is their role's permission set.
 */
export interface TeamAccess {
    teamId: string;
    isOwner: boolean;
    isAppAdmin: boolean;
    hasAll: boolean;
    permissions: Permission[];
}

/**
 * Team-scoped authorization. A member's allowed actions come from their role's `permissions` array
 * (Role.permissions). The team owner and app-level admins are never gated by a role, so editing a
 * role can never lock the owner out, and an admin can always view/act across teams (admin bonus).
 */
@Injectable()
export class AuthorizationService {
    constructor(private readonly databaseService: DatabaseService) { }

    /**
     * Resolve a user's access in a team. Throws NotFound if the team is gone, Forbidden if the user
     * is neither owner, app-admin, nor a member. The result is safe to use for permission checks.
     */
    async getTeamAccess(userId: string, teamId: string, userRole?: UserRole): Promise<TeamAccess> {
        const isAppAdmin = userRole === UserRole.ADMIN;

        const teamResult = await this.databaseService.query<{ ownerId: string }>(
            `SELECT "ownerId" FROM "Team" WHERE "id" = $1 LIMIT 1`,
            [teamId],
        );
        const team = teamResult.rows[0];
        if (!team) throw new NotFoundException('Team not found');

        const isOwner = team.ownerId === userId;
        if (isOwner || isAppAdmin) {
            return { teamId, isOwner, isAppAdmin, hasAll: true, permissions: [] };
        }

        // Cast the enum array to text[] so node-pg returns a real string[] (it can't parse
        // arrays of custom enum types and would otherwise hand back the raw '{A,B}' literal).
        const memberResult = await this.databaseService.query<{ permissions: Permission[] }>(
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
        if (!member) throw new ForbiddenException('You are not a member of this team');

        return {
            teamId,
            isOwner: false,
            isAppAdmin: false,
            hasAll: false,
            permissions: member.permissions ?? [],
        };
    }

    /** Assert the user belongs to (or owns/administers) the team. Returns their access. */
    async assertTeamMembership(userId: string, teamId: string, userRole?: UserRole): Promise<TeamAccess> {
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

    /**
     * Resolve a task's team, then assert `permission` on it. Use for flat /tasks/:id routes where the
     * team isn't in the URL. Returns the access for the task's team.
     */
    async assertTaskPermission(
        userId: string,
        taskId: string,
        permission: Permission,
        userRole?: UserRole,
    ): Promise<TeamAccess> {
        const taskResult = await this.databaseService.query<{ teamId: string }>(
            `SELECT "teamId" FROM "Task" WHERE "id" = $1 LIMIT 1`,
            [taskId],
        );
        const task = taskResult.rows[0];
        if (!task) throw new NotFoundException('Task not found');

        return this.assertTeamPermission(userId, task.teamId, permission, userRole);
    }
}
