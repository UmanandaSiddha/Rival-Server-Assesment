import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TeamController } from './team.controller';
import { InviteController } from './invite.controller';
import { TeamService } from './team.service';
import { InviteService } from './invite.service';

/**
 * Teams, members, custom roles, and email invites. Admin-style mutations are synchronous transactional
 * writes (low contention) with post-commit realtime broadcasts. AuthModule provides the guard +
 * AuthorizationService; RealtimeModule the publisher; EmailQueue (global) sends invite emails.
 */
@Module({
    imports: [AuthModule, RealtimeModule],
    controllers: [TeamController, InviteController],
    providers: [TeamService, InviteService],
    exports: [TeamService],
})
export class TeamModule { }
