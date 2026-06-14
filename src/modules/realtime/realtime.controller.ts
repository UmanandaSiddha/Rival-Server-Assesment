import {
    Body,
    ConflictException,
    Controller,
    Delete,
    Param,
    Post,
    Sse,
    UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { AuthorizationService } from '../auth/authorization.service';
import { RealtimeBus } from 'src/services/redis/realtime-bus.service';
import { PresenceService } from './presence.service';
import { EditLockService } from './edit-lock.service';
import { RealtimePublisher, teamChannel, presenceChannel } from './realtime.publisher';
import { DraftDto } from './dto/draft.dto';

interface SseMessage {
    data: any;
}

interface RequestUser {
    id: string;
    role?: any;
    firstName?: string;
    lastName?: string;
}

/**
 * Server-Sent Events for a team: live task/team changes + presence (who's online), on one stream.
 * The browser opens `new EventSource('/realtime/teams/:teamId/stream', { withCredentials: true })`;
 * auth is via the accessToken cookie (EventSource can't set headers). Presence is bound to the
 * connection: the user is marked online on subscribe and offline when the stream tears down.
 */
@Controller('realtime')
@UseGuards(AuthGuard)
export class RealtimeController {
    constructor(
        private readonly realtimeBus: RealtimeBus,
        private readonly presenceService: PresenceService,
        private readonly authorizationService: AuthorizationService,
        private readonly editLockService: EditLockService,
        private readonly publisher: RealtimePublisher,
    ) { }

    @Sse('teams/:teamId/stream')
    stream(@Param('teamId') teamId: string, @getUser() user: RequestUser): Observable<SseMessage> {
        return new Observable<SseMessage>((subscriber) => {
            let teardown = () => { };

            (async () => {
                // Only team members (or owner/app-admin) may listen.
                await this.authorizationService.assertTeamMembership(user.id, teamId, user.role);

                await this.presenceService.join(teamId, user);

                // Send the current online snapshot first so the client can render presence immediately.
                const onlineUserIds = await this.presenceService.onlineUserIds(teamId);
                subscriber.next({ data: { type: 'presence.snapshot', teamId, payload: { onlineUserIds } } });

                const inner = this.realtimeBus
                    .subscribe([teamChannel(teamId), presenceChannel(teamId)])
                    .subscribe({
                        next: (event) => subscriber.next({ data: event }),
                        error: (err) => subscriber.error(err),
                    });

                teardown = () => {
                    inner.unsubscribe();
                    void this.presenceService.leave(teamId, user);
                };
            })().catch((err) => subscriber.error(err));

            return () => teardown();
        });
    }

    /** Claim the edit lock for a task (or refresh it if you already hold it). */
    @Post('teams/:teamId/tasks/:taskId/edit-lock')
    async acquireEditLock(
        @Param('teamId') teamId: string,
        @Param('taskId') taskId: string,
        @getUser() user: RequestUser,
    ) {
        await this.authorizationService.assertTeamMembership(user.id, teamId, user.role);
        return this.editLockService.acquire(teamId, taskId, user);
    }

    /** Release the edit lock you hold so another member can take over. */
    @Delete('teams/:teamId/tasks/:taskId/edit-lock')
    async releaseEditLock(
        @Param('teamId') teamId: string,
        @Param('taskId') taskId: string,
        @getUser() user: RequestUser,
    ) {
        await this.authorizationService.assertTeamMembership(user.id, teamId, user.role);
        await this.editLockService.release(teamId, taskId, user);
        return { ok: true };
    }

    /**
     * Broadcast a batched in-progress edit to watchers (read-only). Requires holding the edit lock,
     * which enforces one-editor-at-a-time and refreshes the lock TTL. The draft is never persisted —
     * the durable save goes through the task command pipeline.
     */
    @Post('teams/:teamId/tasks/:taskId/draft')
    async streamDraft(
        @Param('teamId') teamId: string,
        @Param('taskId') taskId: string,
        @Body() dto: DraftDto,
        @getUser() user: RequestUser,
    ) {
        await this.authorizationService.assertTeamMembership(user.id, teamId, user.role);

        const holdsLock = await this.editLockService.refresh(taskId, user);
        if (!holdsLock) {
            throw new ConflictException('You do not hold the edit lock for this task');
        }

        await this.publisher.emitToTeam(
            teamId,
            'task.draft',
            { taskId, title: dto.title, description: dto.description },
            user.id,
        );
        return { ok: true };
    }
}
