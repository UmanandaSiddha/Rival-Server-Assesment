import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeController } from './realtime.controller';
import { RealtimePublisher } from './realtime.publisher';
import { PresenceService } from './presence.service';
import { EditLockService } from './edit-lock.service';

/**
 * Real-time layer. RedisModule (global) provides RealtimeBus + RedisService; AuthModule provides the
 * AuthGuard + AuthorizationService used to authenticate/authorize the SSE stream. Exports the
 * publisher + presence so feature modules (tasks, teams) can emit events after their writes commit.
 */
@Module({
    imports: [AuthModule],
    controllers: [RealtimeController],
    providers: [RealtimePublisher, PresenceService, EditLockService],
    exports: [RealtimePublisher, PresenceService, EditLockService],
})
export class RealtimeModule { }
