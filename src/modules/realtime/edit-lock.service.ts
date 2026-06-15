import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/services/redis/redis.service';
import { RealtimePublisher } from './realtime.publisher';

export interface EditLockHolder {
    userId: string;
    firstName?: string;
    lastName?: string;
}

export interface EditLockResult {
    ok: boolean;
    holder: EditLockHolder | null;
}

interface LockUser {
    id: string;
    firstName?: string;
    lastName?: string;
}

// TTL refreshed by drafts/heartbeats; auto-expires if the editor vanishes so a task never stays locked.
const LOCK_TTL_SECONDS = 30;

/**
 * One-editor-at-a-time lock for a task, in Redis. Cooperative/soft (UX only) — the durable write
 * still goes through the versioned task pipeline, so the lock is never a correctness dependency.
 */
@Injectable()
export class EditLockService {
    constructor(
        private readonly redisService: RedisService,
        private readonly publisher: RealtimePublisher,
    ) {}

    private key(taskId: string): string {
        return `editlock:task:${taskId}`;
    }

    async getHolder(taskId: string): Promise<EditLockHolder | null> {
        const raw = await this.redisService.get(this.key(taskId));
        if (!raw) return null;
        try {
            return JSON.parse(raw) as EditLockHolder;
        } catch {
            return null;
        }
    }

    /** Acquire the lock, or refresh it if the caller already holds it. Fails if someone else holds it. */
    async acquire(
        teamId: string,
        taskId: string,
        user: LockUser,
    ): Promise<EditLockResult> {
        const key = this.key(taskId);
        const holder: EditLockHolder = {
            userId: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
        };
        const value = JSON.stringify(holder);

        const won = await this.redisService.setNxEx(
            key,
            value,
            LOCK_TTL_SECONDS,
        );
        if (won) {
            await this.publisher.emitToTeam(
                teamId,
                'task.edit_locked',
                { taskId, holder },
                user.id,
            );
            return { ok: true, holder };
        }

        const current = await this.getHolder(taskId);
        if (current && current.userId === user.id) {
            // Re-entrant: extend the TTL (SET EX, no NX).
            await this.redisService.set(key, value, LOCK_TTL_SECONDS);
            return { ok: true, holder };
        }

        return { ok: false, holder: current };
    }

    /** Extend the lock TTL — only succeeds if the caller currently holds it. */
    async refresh(taskId: string, user: LockUser): Promise<boolean> {
        const current = await this.getHolder(taskId);
        if (current && current.userId === user.id) {
            await this.redisService.set(
                this.key(taskId),
                JSON.stringify(current),
                LOCK_TTL_SECONDS,
            );
            return true;
        }
        return false;
    }

    /** Release the lock — only the holder can. Broadcasts so others can take over. */
    async release(
        teamId: string,
        taskId: string,
        user: LockUser,
    ): Promise<void> {
        const current = await this.getHolder(taskId);
        if (current && current.userId === user.id) {
            await this.redisService.del(this.key(taskId));
            await this.publisher.emitToTeam(
                teamId,
                'task.edit_unlocked',
                { taskId },
                user.id,
            );
        }
    }
}
