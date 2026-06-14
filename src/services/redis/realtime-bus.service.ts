import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RedisService } from './redis.service';

/**
 * Turns Redis pub/sub channels into RxJS Observables for NestJS @Sse() endpoints. Each subscriber
 * gets a dedicated Redis connection, released automatically on unsubscribe (e.g. SSE disconnect).
 * Channels are flat and globbable, e.g. `project:{id}:readiness`, `job:{id}:status`.
 */
@Injectable()
export class RealtimeBus {
    constructor(private readonly redisService: RedisService) {}

    /** Publish a JSON-serialisable payload to a channel. */
    async publish(channel: string, payload: any): Promise<void> {
        await this.redisService.publish(channel, payload);
    }

    /**
     * Subscribe to one or more channels on a dedicated connection (closed on unsubscribe).
     * Messages are JSON-parsed when possible, else returned as raw strings.
     */
    subscribe<T = any>(channel: string | string[]): Observable<T> {
        const channels = Array.isArray(channel) ? channel : [channel];

        return new Observable<T>((subscriber) => {
            const sub = this.redisService.duplicate();
            let closed = false;

            const handler = (incomingChannel: string, message: string) => {
                if (!channels.includes(incomingChannel)) return;
                let parsed: any = message;
                try {
                    parsed = JSON.parse(message);
                } catch {
                    /* keep as raw string */
                }
                if (!closed) subscriber.next(parsed as T);
            };

            sub.on('message', handler);
            sub.subscribe(...channels).catch((error) => {
                if (!closed) subscriber.error(error);
            });

            return () => {
                closed = true;
                sub.off('message', handler);
                sub.quit().catch(() => {
                    /* connection closing — nothing to do */
                });
            };
        });
    }
}
