import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { toCamelCaseDeep } from 'src/services/common/case-conversion.util';
import { UserRole } from 'src/database/enums';
import { AuthService } from '../auth/auth.service';
import { TaskService } from '../task/task.service';
import { ListTasksQueryDto } from '../task/dto/list-tasks-query.dto';
import { ListQueryDto } from './dto/list-query.dto';

interface AdminUser {
    id: string;
    role?: UserRole;
}

@Injectable()
export class AdminService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly authService: AuthService,
        private readonly taskService: TaskService,
    ) {}

    async listUsers(query: ListQueryDto) {
        const { page, limit, offset } = this.paginate(query);
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;

        if (query.search) {
            where.push(
                `("email" ILIKE $${i} OR "firstName" ILIKE $${i} OR "lastName" ILIKE $${i})`,
            );
            params.push(`%${query.search}%`);
            i++;
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const data = await this.databaseService.query(
            `
                SELECT "id", "email", "firstName", "lastName", "role", "isVerified", "isOnline",
                    "isDisabled", "avatarUrl", "created_at"
                FROM "User" ${whereSql}
                ORDER BY "created_at" DESC
                LIMIT $${i++} OFFSET $${i++}
            `,
            [...params, limit, offset],
        );
        const count = await this.databaseService.query(
            `SELECT COUNT(*)::int AS total FROM "User" ${whereSql}`,
            params,
        );
        return this.page(
            toCamelCaseDeep(data.rows),
            count.rows[0]?.total ?? 0,
            page,
            limit,
        );
    }

    async listTeams(query: ListQueryDto) {
        const { page, limit, offset } = this.paginate(query);
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;

        if (query.search) {
            where.push(`t."name" ILIKE $${i++}`);
            params.push(`%${query.search}%`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const data = await this.databaseService.query(
            `
                SELECT t.*,
                    owner."email" AS "ownerEmail", owner."firstName" AS "ownerFirstName", owner."lastName" AS "ownerLastName",
                    (SELECT COUNT(*)::int FROM "TeamMember" m WHERE m."teamId" = t."id") AS "memberCount",
                    (SELECT COUNT(*)::int FROM "Task" tk WHERE tk."teamId" = t."id") AS "taskCount"
                FROM "Team" t
                JOIN "User" owner ON owner."id" = t."ownerId"
                ${whereSql}
                ORDER BY t."created_at" DESC
                LIMIT $${i++} OFFSET $${i++}
            `,
            [...params, limit, offset],
        );
        const count = await this.databaseService.query(
            `SELECT COUNT(*)::int AS total FROM "Team" t ${whereSql}`,
            params,
        );
        return this.page(
            toCamelCaseDeep(data.rows),
            count.rows[0]?.total ?? 0,
            page,
            limit,
        );
    }

    /** All tasks across every team. Delegates to TaskService.list — an admin bypasses team scoping. */
    listTasks(admin: AdminUser, query: ListTasksQueryDto) {
        return this.taskService.list(admin, query);
    }

    async updateUserRole(
        adminId: string,
        targetUserId: string,
        role: UserRole,
    ) {
        if (adminId === targetUserId && role !== UserRole.ADMIN) {
            throw new BadRequestException(
                'You cannot remove your own admin role',
            );
        }

        const result = await this.databaseService.query(
            `UPDATE "User" SET "role" = $1::"UserRole", "updated_at" = now() WHERE "id" = $2 RETURNING "id", "email", "role"`,
            [role, targetUserId],
        );
        if (!result.rows[0]) throw new NotFoundException('User not found');

        // Drop the cached user so the new role takes effect on the next request.
        await this.authService.invalidateUserCache(targetUserId);
        return toCamelCaseDeep(result.rows[0]);
    }

    async setUserDisabled(
        adminId: string,
        targetUserId: string,
        disabled: boolean,
    ) {
        if (adminId === targetUserId && disabled) {
            throw new BadRequestException(
                'You cannot disable your own account',
            );
        }

        const result = await this.databaseService.query(
            `UPDATE "User" SET "isDisabled" = $1, "updated_at" = now() WHERE "id" = $2 RETURNING "id", "email", "isDisabled"`,
            [disabled, targetUserId],
        );
        if (!result.rows[0]) throw new NotFoundException('User not found');

        await this.authService.invalidateUserCache(targetUserId);
        return toCamelCaseDeep(result.rows[0]);
    }

    // --- Helpers ---

    private paginate(query: ListQueryDto) {
        const page = query.page ?? 1;
        const limit = query.limit ?? 20;
        return { page, limit, offset: (page - 1) * limit };
    }

    private page<T>(data: T[], total: number, page: number, limit: number) {
        return {
            data,
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0,
        };
    }
}
