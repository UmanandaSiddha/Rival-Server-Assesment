import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorator/permission.decorator';
import { AuthorizationService } from '../authorization.service';
import { Permission } from 'src/database/enums';

/**
 * Enforces @RequirePermission(...) on routes with a :taskId or :teamId (or body.teamId).
 * Routes without that context check permissions in the service instead.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly authorizationService: AuthorizationService,
    ) {}

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const permission = this.reflector.getAllAndOverride<Permission>(
            PERMISSION_KEY,
            [ctx.getHandler(), ctx.getClass()],
        );
        if (!permission) return true;

        const req = ctx.switchToHttp().getRequest();
        const user = req.user;
        if (!user) throw new ForbiddenException('Not authenticated');

        const taskId: string | undefined = req.params?.taskId;
        const teamId: string | undefined =
            req.params?.teamId ?? req.body?.teamId;

        if (taskId) {
            await this.authorizationService.assertTaskPermission(
                user.id,
                taskId,
                permission,
                user.role,
            );
            return true;
        }

        if (teamId) {
            await this.authorizationService.assertTeamPermission(
                user.id,
                teamId,
                permission,
                user.role,
            );
            return true;
        }

        throw new ForbiddenException(
            'No team or task context for permission check',
        );
    }
}
