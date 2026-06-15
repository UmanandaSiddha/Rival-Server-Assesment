import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/services/redis/redis.service';

/** Redis pub/sub channels. Flat and team-scoped so a stream subscribes to exactly its team. */
export const teamChannel = (teamId: string) => `team:${teamId}`;
export const presenceChannel = (teamId: string) => `presence:${teamId}`;

/** Event types pushed to clients. Keep in sync with the frontend handlers. */
export type RealtimeEventType =
    | 'task.created'
    | 'task.updated'
    | 'task.deleted'
    | 'task.activity'
    | 'task.edit_locked'
    | 'task.edit_unlocked'
    | 'task.draft'
    | 'task.attachment_added'
    | 'task.attachment_removed'
    | 'member.added'
    | 'member.removed'
    | 'member.role_changed'
    | 'presence.online'
    | 'presence.offline'
    | 'presence.snapshot';

export interface RealtimeEvent {
    type: RealtimeEventType;
    teamId: string;
    actorId?: string;
    payload?: any;
    at: string; // ISO timestamp
}

/**
 * Publishes domain events to a team's Redis channels — call AFTER a write commits.
 * Every app instance subscribed via RealtimeBus fans the event out to its SSE clients.
 */
@Injectable()
export class RealtimePublisher {
    constructor(private readonly redisService: RedisService) { }

    async emitToTeam(
        teamId: string,
        type: RealtimeEventType,
        payload?: any,
        actorId?: string,
    ): Promise<void> {
        const event: RealtimeEvent = { type, teamId, actorId, payload, at: new Date().toISOString() };
        await this.redisService.publish(teamChannel(teamId), event);
    }

    async emitPresence(teamId: string, event: RealtimeEvent): Promise<void> {
        await this.redisService.publish(presenceChannel(teamId), event);
    }
}
