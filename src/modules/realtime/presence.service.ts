import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/services/redis/redis.service';
import { RealtimePublisher } from './realtime.publisher';

interface PresenceUser {
    id: string;
    firstName?: string;
    lastName?: string;
}

/**
 * Tracks who's live in a team via the SSE connection lifecycle. Ref-counted per user (Redis hash of
 * open connections) so multiple tabs only go offline on the last close. Transitions are broadcast.
 */
@Injectable()
export class PresenceService {
    constructor(
        private readonly redisService: RedisService,
        private readonly publisher: RealtimePublisher,
    ) { }

    private key(teamId: string): string {
        return `presence:team:${teamId}`;
    }

    async join(teamId: string, user: PresenceUser): Promise<void> {
        const count = await this.redisService.hIncrBy(this.key(teamId), user.id, 1);
        if (count === 1) {
            await this.publisher.emitPresence(teamId, {
                type: 'presence.online',
                teamId,
                actorId: user.id,
                payload: { id: user.id, firstName: user.firstName, lastName: user.lastName },
                at: new Date().toISOString(),
            });
        }
    }

    async leave(teamId: string, user: PresenceUser): Promise<void> {
        const count = await this.redisService.hIncrBy(this.key(teamId), user.id, -1);
        if (count <= 0) {
            await this.redisService.hDel(this.key(teamId), user.id);
            await this.publisher.emitPresence(teamId, {
                type: 'presence.offline',
                teamId,
                actorId: user.id,
                at: new Date().toISOString(),
            });
        }
    }

    /** Current online user ids for a team (count > 0). */
    async onlineUserIds(teamId: string): Promise<string[]> {
        const counts = await this.redisService.hGetAll(this.key(teamId));
        return Object.entries(counts)
            .filter(([, value]) => parseInt(value, 10) > 0)
            .map(([userId]) => userId);
    }
}
