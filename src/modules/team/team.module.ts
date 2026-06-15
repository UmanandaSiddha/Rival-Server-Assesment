import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TeamController } from './team.controller';
import { InviteController } from './invite.controller';
import { TeamService } from './team.service';
import { InviteService } from './invite.service';

/**
 * Teams, members, custom roles, and email invites. Mutations are synchronous transactional
 * writes with post-commit realtime broadcasts.
 */
@Module({
    imports: [AuthModule, RealtimeModule],
    controllers: [TeamController, InviteController],
    providers: [TeamService, InviteService],
    exports: [TeamService],
})
export class TeamModule { }
