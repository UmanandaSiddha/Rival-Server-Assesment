import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/config/constants';

@Injectable()
export class RedisService {

    constructor(@Inject(REDIS_CLIENT) private client: Redis) { }

    // Reverse map: socketId → userId, one entry per live socket.
    private readonly SOCKET_TO_USER = 'socket:socketToUser';
    // Forward map: userId → Set<socketId>. A SET reference-counts presence across concurrent
    // sockets, so User.isOnline only flips FALSE when the last socket disconnects.
    private userSocketsKey(userId: string): string {
        return `socket:userSockets:${userId}`;
    }

    // --- Caching ---
    async get(key: string): Promise<string | null> {
        try {
            return await this.client.get(key);
        } catch (error) {
            console.error(`Redis GET error for key ${key}:`, error);
            return null;
        }
    }

    async set(key: string, value: string, ttl?: number): Promise<void> {
        try {
            if (ttl) {
                await this.client.set(key, value, 'EX', ttl);
            } else {
                await this.client.set(key, value);
            }
        } catch (error) {
            console.error(`Redis SET error for key ${key}:`, error);
        }
    }

    async del(...keys: string[]): Promise<number> {
        try {
            return await this.client.del(...keys);
        } catch (error) {
            console.error(`Redis DEL error:`, error);
            return 0;
        }
    }

    /** SET key val EX ttl NX — atomic acquire. Returns true only if the key was newly set (lock won). */
    async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
        const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
        return result === 'OK';
    }

    /** Cursor-based SCAN — non-blocking alternative to KEYS, which is O(N) and blocks the event loop. */
    async scanKeys(pattern: string, count = 200): Promise<string[]> {
        const found: string[] = [];
        try {
            let cursor = '0';
            do {
                const [next, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', count);
                cursor = next;
                if (batch.length) found.push(...batch);
            } while (cursor !== '0');
        } catch (error) {
            console.error(`Redis SCAN error for pattern ${pattern}:`, error);
        }
        return found;
    }

    async exists(key: string): Promise<boolean> {
        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch (error) {
            console.error(`Redis EXISTS error for key ${key}:`, error);
            return false;
        }
    }

    async expire(key: string, seconds: number): Promise<boolean> {
        try {
            const result = await this.client.expire(key, seconds);
            return result === 1;
        } catch (error) {
            console.error(`Redis EXPIRE error for key ${key}:`, error);
            return false;
        }
    }

    async ttl(key: string): Promise<number> {
        try {
            return await this.client.ttl(key);
        } catch (error) {
            console.error(`Redis TTL error for key ${key}:`, error);
            return -1;
        }
    }

    async flushAll() {
        try {
            return await this.client.flushall();
        } catch (error) {
            console.error('Redis FLUSHALL error:', error);
            return null
        }
    }

    // --- Hash Commands ---
    async hSet(hashKey: string, field: string, value: string): Promise<void> {
        try {
            await this.client.hset(hashKey, field, value);
        } catch (error) {
            console.error(`Redis HSET error for key ${hashKey}, field ${field}:`, error);
        }
    }

    async hGet(hashKey: string, field: string): Promise<string | null> {
        try {
            return await this.client.hget(hashKey, field);
        } catch (error) {
            console.error(`Redis HGET error for key ${hashKey}, field ${field}:`, error);
            return null;
        }
    }

    async hDel(hashKey: string, field: string | string[]): Promise<number> {
        if (Array.isArray(field)) {
            return await this.client.hdel(hashKey, ...field);
        } else {
            return await this.client.hdel(hashKey, field);
        }
    }

    async hGetAll(hashKey: string): Promise<Record<string, string>> {
        try {
            return await this.client.hgetall(hashKey);
        } catch (error) {
            console.error(`Redis HGETALL error for key ${hashKey}:`, error);
            return {};
        }
    }

    /** Atomically add `by` to a hash field and return the new value. Used for presence ref-counting. */
    async hIncrBy(hashKey: string, field: string, by: number): Promise<number> {
        return this.client.hincrby(hashKey, field, by);
    }

    // --- Z Commands ---
    async zAdd(key: string, score: number, member: string): Promise<void> {
        try {
            await this.client.zadd(key, score, member);
        } catch (error) {
            console.error(`Redis ZADD error for key ${key}:`, error);
        }
    }

    async zRange(key: string, start: number, stop: number): Promise<string[]> {
        try {
            return await this.client.zrange(key, start, stop);
        } catch (error) {
            console.error(`Redis ZRANGE error for key ${key}:`, error);
            return [];
        }
    }

    async zRevrange(key: string, start: number, stop: number): Promise<string[]> {
        try {
            return await this.client.zrevrange(key, start, stop);
        } catch (error) {
            console.error(`Redis ZREVRANGE error for key ${key}:`, error);
            return [];
        }
    }

    // --- Socket Components ---
    async registerSocket(userId: string, socketId: string): Promise<void> {
        try {
            await this.client
                .multi()
                .hset(this.SOCKET_TO_USER, socketId, userId)
                .sadd(this.userSocketsKey(userId), socketId)
                .exec();
        } catch (error) {
            console.error(`registerSocket Failed`, error);
        }
    }

    /** Returns one socketId for a user — legacy callers that don't need fan-out. */
    async getSocketIdByUser(userId: string): Promise<string | null> {
        try {
            const ids = await this.client.smembers(this.userSocketsKey(userId));
            return ids[0] ?? null;
        } catch (error) {
            console.error(`getSocketIdByUser Failed`, error);
            return null;
        }
    }

    /** Returns every active socketId across all namespaces for a user. */
    async getSocketIdsByUser(userId: string): Promise<string[]> {
        try {
            return await this.client.smembers(this.userSocketsKey(userId));
        } catch (error) {
            console.error(`getSocketIdsByUser Failed`, error);
            return [];
        }
    }

    async getUserBySocket(socketId: string): Promise<string | null> {
        try {
            return await this.hGet(this.SOCKET_TO_USER, socketId);
        } catch (error) {
            console.error(`getUserBySocket Failed`, error);
            return null;
        }
    }

    /**
     * Removes a socketId from the user's presence record. Returns the owning userId and `wasLast`
     * (the user's final socket) — callers use `wasLast` to decide whether to flip User.isOnline FALSE.
     */
    async unregisterSocket(socketId: string): Promise<{ userId: string | null; wasLast: boolean }> {
        try {
            const userId = await this.getUserBySocket(socketId);
            if (!userId) {
                return { userId: null, wasLast: false };
            }
            await this.client
                .multi()
                .hdel(this.SOCKET_TO_USER, socketId)
                .srem(this.userSocketsKey(userId), socketId)
                .exec();
            const remaining = await this.client.scard(this.userSocketsKey(userId));
            return { userId, wasLast: remaining === 0 };
        } catch (error) {
            console.error(`unregisterSocket Failed`, error);
            return { userId: null, wasLast: false };
        }
    }

    // --- Pub / Sub ---
    async publish(channel: string, payload: any): Promise<void> {
        try {
            const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
            await this.client.publish(channel, message);
        } catch (error) {
            console.error(`Redis PUBLISH error for channel ${channel}:`, error);
        }
    }

    /**
     * Dedicated subscriber connection — ioredis subscribers can't share a connection with regular
     * commands, so each caller gets its own duplicate and must `.quit()` it when done.
     */
    duplicate(): Redis {
        return this.client.duplicate();
    }
}