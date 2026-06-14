import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorator/permission.decorator';
import { AuthorizationService } from '../authorization.service';
import { Permission } from 'src/database/enums';

/**
 * Enforces @RequirePermission(...) on team-scoped routes. Resolves the team context from the URL/body:
 *   - :taskId param  -> permission is checked against the task's team
 *   - :teamId param or body.teamId -> checked directly
 * The team owner and app-level admins bypass inside AuthorizationService. For flat /tasks/:id routes
 * (no :teamId/:taskId), check in the service via AuthorizationService.assertTaskPermission instead.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly authorizationService: AuthorizationService,
    ) { }

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const permission = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, [
            ctx.getHandler(),
            ctx.getClass(),
        ]);
        if (!permission) return true;

        const req = ctx.switchToHttp().getRequest();
        const user = req.user;
        if (!user) throw new ForbiddenException('Not authenticated');

        const taskId: string | undefined = req.params?.taskId;
        const teamId: string | undefined = req.params?.teamId ?? req.body?.teamId;

        if (taskId) {
            await this.authorizationService.assertTaskPermission(user.id, taskId, permission, user.role);
            return true;
        }

        if (teamId) {
            await this.authorizationService.assertTeamPermission(user.id, teamId, permission, user.role);
            return true;
        }

        throw new ForbiddenException('No team or task context for permission check');
    }
}
