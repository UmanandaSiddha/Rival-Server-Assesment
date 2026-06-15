import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { toCamelCaseDeep } from 'src/services/common/case-conversion.util';
import { Permission, UserRole } from 'src/database/enums';
import { AuthorizationService } from '../auth/authorization.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const ADMIN_SYSTEM_ROLE_ID = 'role_system_admin';

interface RequestUser {
    id: string;
    role?: UserRole;
}

@Injectable()
export class TeamService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly authorizationService: AuthorizationService,
        private readonly publisher: RealtimePublisher,
    ) {}

    // --- Teams ---

    async create(user: RequestUser, dto: CreateTeamDto) {
        const name = dto.name.trim();

        // Don't let a user end up with two teams of the same name (case-insensitive),
        // across teams they own or belong to.
        const duplicate = await this.databaseService.query(
            `
                SELECT 1
                FROM "Team" t
                JOIN "TeamMember" tm ON tm."teamId" = t."id"
                WHERE tm."userId" = $1 AND LOWER(t."name") = LOWER($2)
                LIMIT 1
            `,
            [user.id, name],
        );
        if (duplicate.rows[0]) {
            throw new BadRequestException(
                'You already have a team with that name',
            );
        }

        return this.databaseService.withTransaction(async (client) => {
            const teamInsert = await client.query(
                `INSERT INTO "Team" ("name", "ownerId", "isDefault") VALUES ($1, $2, false) RETURNING *`,
                [name, user.id],
            );
            const team = teamInsert.rows[0];

            await client.query(
                `INSERT INTO "TeamMember" ("teamId", "userId", "roleId") VALUES ($1, $2, $3)`,
                [team.id, user.id, ADMIN_SYSTEM_ROLE_ID],
            );

            return toCamelCaseDeep(team);
        });
    }

    async list(user: RequestUser) {
        const result = await this.databaseService.query(
            `
                SELECT t.*, tm."roleId", (t."ownerId" = $1) AS "isOwner",
                    (SELECT COUNT(*)::int FROM "TeamMember" m WHERE m."teamId" = t."id") AS "memberCount"
                FROM "Team" t
                JOIN "TeamMember" tm ON tm."teamId" = t."id" AND tm."userId" = $1
                ORDER BY t."created_at" ASC
            `,
            [user.id],
        );
        return toCamelCaseDeep(result.rows);
    }

    async getOne(user: RequestUser, teamId: string) {
        const access = await this.authorizationService.assertTeamMembership(
            user.id,
            teamId,
            user.role,
        );
        const result = await this.databaseService.query(
            `SELECT * FROM "Team" WHERE "id" = $1 LIMIT 1`,
            [teamId],
        );
        return {
            ...toCamelCaseDeep(result.rows[0]),
            access: {
                isOwner: access.isOwner,
                hasAll: access.hasAll,
                permissions: access.permissions,
            },
        };
    }

    async update(user: RequestUser, teamId: string, dto: UpdateTeamDto) {
        await this.authorizationService.assertTeamPermission(
            user.id,
            teamId,
            Permission.TEAM_UPDATE,
            user.role,
        );
        const result = await this.databaseService.query(
            `UPDATE "Team" SET "name" = $1, "updated_at" = now() WHERE "id" = $2 RETURNING *`,
            [dto.name, teamId],
        );
        return toCamelCaseDeep(result.rows[0]);
    }

    async remove(user: RequestUser, teamId: string) {
        await this.authorizationService.assertTeamPermission(
            user.id,
            teamId,
            Permission.TEAM_DELETE,
            user.role,
        );

        const teamResult = await this.databaseService.query(
            `SELECT "isDefault" FROM "Team" WHERE "id" = $1 LIMIT 1`,
            [teamId],
        );
        const team = teamResult.rows[0];
        if (!team) throw new NotFoundException('Team not found');
        if (team.isDefault)
            throw new BadRequestException('Cannot delete your default team');

        await this.databaseService.query(`DELETE FROM "Team" WHERE "id" = $1`, [
            teamId,
        ]);
        return { id: teamId };
    }

    // --- Members ---

    async listMembers(user: RequestUser, teamId: string) {
        await this.authorizationService.assertTeamMembership(
            user.id,
            teamId,
            user.role,
        );
        const result = await this.databaseService.query(
            `
                SELECT
                    tm."userId", tm."roleId", tm."joinedAt",
                    r."name" AS "roleName", r."permissions"::text[] AS "permissions",
                    u."email", u."firstName", u."lastName", u."avatarUrl", u."isOnline",
                    (t."ownerId" = tm."userId") AS "isOwner"
                FROM "TeamMember" tm
                JOIN "Role" r ON r."id" = tm."roleId"
                JOIN "User" u ON u."id" = tm."userId"
                JOIN "Team" t ON t."id" = tm."teamId"
                WHERE tm."teamId" = $1
                ORDER BY tm."joinedAt" ASC
            `,
            [teamId],
        );
        return toCamelCaseDeep(result.rows);
    }

    async updateMemberRole(
        user: RequestUser,
        teamId: string,
        targetUserId: string,
        roleId: string,
    ) {
        await this.authorizationService.assertTeamPermission(
            user.id,
            teamId,
            Permission.MEMBER_UPDATE_ROLE,
            user.role,
        );
        await this.assertRoleUsable(teamId, roleId);

        const owner = await this.getOwnerId(teamId);
        if (owner === targetUserId) {
            throw new BadRequestException(
                "The team owner's role cannot be changed",
            );
        }

        const result = await this.databaseService.query(
            `UPDATE "TeamMember" SET "roleId" = $1 WHERE "teamId" = $2 AND "userId" = $3 RETURNING *`,
            [roleId, teamId, targetUserId],
        );
        if (!result.rows[0]) throw new NotFoundException('Member not found');

        await this.publisher.emitToTeam(
            teamId,
            'member.role_changed',
            { userId: targetUserId, roleId },
            user.id,
        );
        return toCamelCaseDeep(result.rows[0]);
    }

    async removeMember(
        user: RequestUser,
        teamId: string,
        targetUserId: string,
    ) {
        await this.authorizationService.assertTeamPermission(
            user.id,
            teamId,
            Permission.MEMBER_REMOVE,
            user.role,
        );

        const owner = await this.getOwnerId(teamId);
        if (owner === targetUserId) {
            throw new BadRequestException('The team owner cannot be removed');
        }

        const result = await this.databaseService.query(
            `DELETE FROM "TeamMember" WHERE "teamId" = $1 AND "userId" = $2 RETURNING "id"`,
            [teamId, targetUserId],
        );
        if (!result.rows[0]) throw new NotFoundException('Member not found');

        await this.publisher.emitToTeam(
            teamId,
            'member.removed',
            { userId: targetUserId },
            user.id,
        );
        return { ok: true };
    }

    // --- Roles ---

    async listRoles(user: RequestUser, teamId: string) {
        await this.authorizationService.assertTeamMembership(
            user.id,
            teamId,
            user.role,
        );
        const result = await this.databaseService.query(
            `
                SELECT "id", "teamId", "name", "description", "isSystem", "permissions"::text[] AS "permissions"
                FROM "Role"
                WHERE "teamId" IS NULL OR "teamId" = $1
                ORDER BY "isSystem" DESC, "name" ASC
            `,
            [teamId],
        );
        return toCamelCaseDeep(result.rows);
    }

    async createRole(user: RequestUser, teamId: string, dto: CreateRoleDto) {
        await this.authorizationService.assertTeamPermission(
            user.id,
            teamId,
            Permission.ROLE_CREATE,
            user.role,
        );
        const result = await this.databaseService.query(
            `
                INSERT INTO "Role" ("teamId", "name", "description", "isSystem", "permissions")
                VALUES ($1, $2, $3, false, $4::"Permission"[])
                RETURNING "id", "teamId", "name", "description", "isSystem", "permissions"::text[] AS "permissions"
            `,
            [teamId, dto.name, dto.description ?? null, dto.permissions],
        );
        return toCamelCaseDeep(result.rows[0]);
    }

    async updateRole(
        user: RequestUser,
        teamId: string,
        roleId: string,
        dto: UpdateRoleDto,
    ) {
        await this.authorizationService.assertTeamPermission(
            user.id,
            teamId,
            Permission.ROLE_UPDATE,
            user.role,
        );
        const result = await this.databaseService.query(
            `
                UPDATE "Role"
                SET
                    "name" = COALESCE($1, "name"),
                    "description" = COALESCE($2, "description"),
                    "permissions" = COALESCE($3::"Permission"[], "permissions"),
                    "updated_at" = now()
                WHERE "id" = $4 AND "teamId" = $5 AND "isSystem" = false
                RETURNING "id", "teamId", "name", "description", "isSystem", "permissions"::text[] AS "permissions"
            `,
            [
                dto.name ?? null,
                dto.description ?? null,
                dto.permissions ?? null,
                roleId,
                teamId,
            ],
        );
        if (!result.rows[0])
            throw new NotFoundException('Custom role not found for this team');
        return toCamelCaseDeep(result.rows[0]);
    }

    async deleteRole(user: RequestUser, teamId: string, roleId: string) {
        await this.authorizationService.assertTeamPermission(
            user.id,
            teamId,
            Permission.ROLE_DELETE,
            user.role,
        );
        // FK RESTRICT from TeamMember/Invite blocks deletion of a role still in use (-> 409).
        const result = await this.databaseService.query(
            `DELETE FROM "Role" WHERE "id" = $1 AND "teamId" = $2 AND "isSystem" = false RETURNING "id"`,
            [roleId, teamId],
        );
        if (!result.rows[0])
            throw new NotFoundException('Custom role not found for this team');
        return { id: roleId };
    }

    // --- Helpers (shared with InviteService) ---

    /** A role is usable in a team if it's that team's custom role or a global system role. */
    async assertRoleUsable(teamId: string, roleId: string): Promise<void> {
        const result = await this.databaseService.query(
            `SELECT 1 FROM "Role" WHERE "id" = $1 AND ("teamId" = $2 OR "teamId" IS NULL) LIMIT 1`,
            [roleId, teamId],
        );
        if (!result.rows[0])
            throw new BadRequestException('Invalid role for this team');
    }

    private async getOwnerId(teamId: string): Promise<string> {
        const result = await this.databaseService.query<{ ownerId: string }>(
            `SELECT "ownerId" FROM "Team" WHERE "id" = $1 LIMIT 1`,
            [teamId],
        );
        if (!result.rows[0]) throw new NotFoundException('Team not found');
        return result.rows[0].ownerId;
    }
}
