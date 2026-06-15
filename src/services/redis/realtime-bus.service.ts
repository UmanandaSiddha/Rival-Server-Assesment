import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Observable } from 'rxjs';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

type Listener = (message: any) => void;

/**
 * Turns Redis pub/sub channels into RxJS Observables for @Sse() endpoints.
 *
 * One shared subscriber connection per process, with in-memory ref-counting of channels
 * (channel -> set of listeners). Redis connections are O(instances), not O(users), so it
 * avoids the maxclients (~10k) ceiling of one-connection-per-client. Channel is SUBSCRIBEd
 * on its first local listener and UNSUBSCRIBEd on its last.
 */
@Injectable()
export class RealtimeBus implements OnModuleDestroy {
    private subscriber?: Redis;
    private readonly listeners = new Map<string, Set<Listener>>();

    constructor(private readonly redisService: RedisService) { }

    /** Publish a JSON-serialisable payload to a channel (uses the main client, not the subscriber). */
    async publish(channel: string, payload: any): Promise<void> {
        await this.redisService.publish(channel, payload);
    }

    private ensureSubscriber(): Redis {
        if (this.subscriber) return this.subscriber;

        // ioredis: once a connection runs SUBSCRIBE it's in subscriber mode, so this is dedicated.
        const sub = this.redisService.duplicate();
        sub.on('message', (channel: string, message: string) => {
            const set = this.listeners.get(channel);
            if (!set || set.size === 0) return;

            let parsed: any = message;
            try {
                parsed = JSON.parse(message);
            } catch {
                /* keep as raw string */
            }
            for (const listener of set) listener(parsed);
        });

        this.subscriber = sub;
        return sub;
    }

    /**
     * Subscribe to one or more channels. Messages are JSON-parsed when possible, else raw strings.
     * Returns a cold Observable; the actual Redis SUBSCRIBE is shared across all callers of a channel.
     */
    subscribe<T = any>(channel: string | string[]): Observable<T> {
        const channels = Array.isArray(channel) ? channel : [channel];

        return new Observable<T>((subscriber) => {
            const sub = this.ensureSubscriber();
            const listener: Listener = (message) => subscriber.next(message as T);

            for (const ch of channels) {
                let set = this.listeners.get(ch);
                if (!set) {
                    set = new Set<Listener>();
                    this.listeners.set(ch, set);
                    // First local listener for this channel — subscribe on the shared connection.
                    sub.subscribe(ch).catch((error) => subscriber.error(error));
                }
                set.add(listener);
            }

            return () => {
                for (const ch of channels) {
                    const set = this.listeners.get(ch);
                    if (!set) continue;
                    set.delete(listener);
                    if (set.size === 0) {
                        this.listeners.delete(ch);
                        // Last local listener gone — stop receiving this channel from Redis.
                        sub.unsubscribe(ch).catch(() => { /* shutting down */ });
                    }
                }
            };
        });
    }

    async onModuleDestroy(): Promise<void> {
        if (this.subscriber) {
            await this.subscriber.quit().catch(() => { /* nothing to do */ });
        }
    }
}
