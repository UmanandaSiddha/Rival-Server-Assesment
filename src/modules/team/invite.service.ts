import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { DatabaseService } from 'src/services/database/database.service';
import { toCamelCaseDeep } from 'src/services/common/case-conversion.util';
import { EmailQueue } from 'src/services/queue/email.queue';
import { Permission, UserRole } from 'src/database/enums';
import { AuthorizationService } from '../auth/authorization.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { TeamService } from './team.service';
import { CreateInviteDto } from './dto/create-invite.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface RequestUser {
    id: string;
    role?: UserRole;
    email?: string;
    firstName?: string;
    lastName?: string;
}

@Injectable()
export class InviteService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly configService: ConfigService,
        private readonly authorizationService: AuthorizationService,
        private readonly teamService: TeamService,
        private readonly emailQueue: EmailQueue,
        private readonly publisher: RealtimePublisher,
    ) { }

    async create(user: RequestUser, teamId: string, dto: CreateInviteDto) {
        await this.authorizationService.assertTeamPermission(user.id, teamId, Permission.MEMBER_INVITE, user.role);
        await this.teamService.assertRoleUsable(teamId, dto.roleId);

        const email = dto.email.toLowerCase();

        // Reject if the email already belongs to a member of this team.
        const existingMember = await this.databaseService.query(
            `
                SELECT 1 FROM "User" u
                JOIN "TeamMember" tm ON tm."userId" = u."id" AND tm."teamId" = $1
                WHERE LOWER(u."email") = $2
                LIMIT 1
            `,
            [teamId, email],
        );
        if (existingMember.rows[0]) {
            throw new BadRequestException('That user is already a member of this team');
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

        // Partial unique index blocks a second PENDING invite for the same (team, email) -> 409.
        const result = await this.databaseService.query(
            `
                INSERT INTO "Invite" ("teamId", "email", "roleId", "invitedById", "token", "expiresAt")
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `,
            [teamId, email, dto.roleId, user.id, token, expiresAt],
        );
        const invite = toCamelCaseDeep(result.rows[0]);

        const teamResult = await this.databaseService.query(`SELECT "name" FROM "Team" WHERE "id" = $1`, [teamId]);
        const teamName = teamResult.rows[0]?.name ?? 'a team';
        const inviteUrl = `${this.configService.get<string>('FRONTEND_URL') ?? ''}/invite/${token}`;

        await this.emailQueue.enqueue({
            to: email,
            subject: `You've been invited to join ${teamName}`,
            template: 'invite',
            data: {
                teamName,
                invitedByName: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
                inviteUrl,
                expiresAt: expiresAt.toDateString(),
            },
        });

        return { ...invite, inviteUrl };
    }

    async list(user: RequestUser, teamId: string) {
        await this.authorizationService.assertTeamPermission(user.id, teamId, Permission.MEMBER_INVITE, user.role);
        const result = await this.databaseService.query(
            `
                SELECT i."id", i."email", i."roleId", i."status", i."expiresAt", i."created_at",
                    r."name" AS "roleName"
                FROM "Invite" i
                JOIN "Role" r ON r."id" = i."roleId"
                WHERE i."teamId" = $1 AND i."status" = 'PENDING'
                ORDER BY i."created_at" DESC
            `,
            [teamId],
        );
        return toCamelCaseDeep(result.rows);
    }

    async revoke(user: RequestUser, teamId: string, inviteId: string) {
        await this.authorizationService.assertTeamPermission(user.id, teamId, Permission.MEMBER_INVITE, user.role);
        const result = await this.databaseService.query(
            `
                UPDATE "Invite" SET "status" = 'REVOKED', "updated_at" = now()
                WHERE "id" = $1 AND "teamId" = $2 AND "status" = 'PENDING'
                RETURNING "id"
            `,
            [inviteId, teamId],
        );
        if (!result.rows[0]) throw new NotFoundException('Pending invite not found');
        return { ok: true };
    }

    /** Public: show who/what an invite is for, before the recipient logs in. */
    async getByToken(token: string) {
        const result = await this.databaseService.query(
            `
                SELECT i."email", i."status", i."expiresAt",
                    t."name" AS "teamName",
                    inviter."firstName" AS "invitedByFirstName", inviter."lastName" AS "invitedByLastName"
                FROM "Invite" i
                JOIN "Team" t ON t."id" = i."teamId"
                LEFT JOIN "User" inviter ON inviter."id" = i."invitedById"
                WHERE i."token" = $1
                LIMIT 1
            `,
            [token],
        );
        const invite = result.rows[0];
        if (!invite) throw new NotFoundException('Invite not found');
        return toCamelCaseDeep(invite);
    }

    async accept(user: RequestUser, token: string) {
        const invite = await this.loadActionableInvite(token, user);

        const result = await this.databaseService.withTransaction(async (client) => {
            await client.query(
                `
                    INSERT INTO "TeamMember" ("teamId", "userId", "roleId")
                    VALUES ($1, $2, $3)
                    ON CONFLICT ("teamId", "userId") DO NOTHING
                `,
                [invite.teamId, user.id, invite.roleId],
            );

            await client.query(
                `
                    UPDATE "Invite"
                    SET "status" = 'ACCEPTED', "acceptedById" = $1, "acceptedAt" = now(), "updated_at" = now()
                    WHERE "id" = $2
                `,
                [user.id, invite.id],
            );

            const teamResult = await client.query(`SELECT * FROM "Team" WHERE "id" = $1`, [invite.teamId]);
            return toCamelCaseDeep(teamResult.rows[0]);
        });

        await this.publisher.emitToTeam(
            invite.teamId,
            'member.added',
            {
                userId: user.id,
                roleId: invite.roleId,
                user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email },
            },
            user.id,
        );

        return result;
    }

    async decline(user: RequestUser, token: string) {
        const invite = await this.loadActionableInvite(token, user);
        await this.databaseService.query(
            `UPDATE "Invite" SET "status" = 'DECLINED', "updated_at" = now() WHERE "id" = $1`,
            [invite.id],
        );
        return { ok: true };
    }

    /** Load a PENDING, unexpired invite addressed to the calling user; expire it if past its TTL. */
    private async loadActionableInvite(token: string, user: RequestUser) {
        const result = await this.databaseService.query(
            `SELECT * FROM "Invite" WHERE "token" = $1 AND "status" = 'PENDING' LIMIT 1`,
            [token],
        );
        const invite = result.rows[0] ? toCamelCaseDeep(result.rows[0]) : null;
        if (!invite) throw new NotFoundException('Invite not found or already used');

        if (new Date(invite.expiresAt) <= new Date()) {
            await this.databaseService.query(
                `UPDATE "Invite" SET "status" = 'EXPIRED', "updated_at" = now() WHERE "id" = $1`,
                [invite.id],
            );
            throw new BadRequestException('Invite has expired');
        }

        if (!user.email || user.email.toLowerCase() !== String(invite.email).toLowerCase()) {
            throw new ForbiddenException('This invite was sent to a different email address');
        }

        return invite;
    }
}
