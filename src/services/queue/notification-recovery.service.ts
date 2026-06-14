import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService } from 'src/services/database/database.service';
import { LoggerService } from 'src/services/logger/logger.service';
import { NotificationChannel, NotificationStatus, NotificationType } from 'src/database/enums';
import { EnqueueAttempt, SweepGate, enqueueWithRetry } from './queue-recovery.util';

export interface NotificationEnqueuePayload {
    notificationId: string;
    userId: string;
    type: NotificationType;
    channel: NotificationChannel;
    referenceId?: string;
}

/**
 * Outbox-pattern recovery for NotificationLog rows.
 *
 * The NotificationLog table is already designed as an outbox — it carries `status`,
 * `retryCount`, and `nextRetryAt`. We just need to wire a sweep that re-enqueues rows
 * BullMQ has lost (PENDING > 30s old) and FAILED rows whose backoff has elapsed.
 *
 * Same triggers as WritebackRecoveryService:
 *   1. Boot — drain anything orphaned by the previous process exit.
 *   2. Opportunistic on each `notificationsService.queueNotification` call, throttled to
 *      at most one actual sweep per SWEEP_MIN_INTERVAL_MS per process.
 *
 * No standalone cron. Idle app = zero DB cycles.
 */
@Injectable()
export class NotificationRecoveryService implements OnApplicationBootstrap {
    private readonly logger = new LoggerService(NotificationRecoveryService.name);
    private readonly sweepGate = new SweepGate(NotificationRecoveryService.SWEEP_MIN_INTERVAL_MS);

    private static readonly SWEEP_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 min
    private static readonly STUCK_PENDING_AGE_SECONDS = 30;
    /** Must match NotificationProcessor.STALE_LOCK_MINUTES — coherent reclaim semantics. */
    private static readonly STALE_LOCK_MINUTES = 5;
    private static readonly SWEEP_BATCH_LIMIT = 50;
    private static readonly MAX_RETRIES = 3;

    constructor(
        @InjectQueue('NOTIFICATION') private readonly notificationQueue: Queue,
        private readonly databaseService: DatabaseService,
    ) { }

    async onApplicationBootstrap(): Promise<void> {
        try {
            const recovered = await this.sweepIfDue({ force: true });
            if (recovered > 0) {
                this.logger.log(
                    `[BOOT-SWEEP] recovered ${recovered} notification(s)`,
                    NotificationRecoveryService.name,
                );
            }
        } catch (err: any) {
            this.logger.error(
                `[BOOT-SWEEP] failed: ${err?.message ?? err}`,
                NotificationRecoveryService.name,
            );
        }
    }

    /**
     * Synchronous-retry wrapper around the raw BullMQ queue add. Matches the existing
     * NotificationProcessor expectations (attempts: 3, exponential 5s backoff, removeOnComplete).
     */
    async enqueueWithRetry(payload: NotificationEnqueuePayload): Promise<EnqueueAttempt> {
        return enqueueWithRetry(
            `notification=${payload.notificationId}`,
            () =>
                this.notificationQueue.add('send-notification', payload, {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 5000 },
                    removeOnComplete: true,
                }),
            this.logger,
        );
    }

    async sweepIfDue(opts: { force?: boolean } = {}): Promise<number> {
        if (!this.sweepGate.shouldSweep(opts.force)) return 0;
        return this.sweepStuckNotifications();
    }

    /**
     * Two-step recovery (same pattern as JobRecoveryService / WritebackRecoveryService):
     *   1. Clear stale `lockedAt` from rows whose worker has crashed. Status is unchanged
     *      (NotificationLog has no intermediate "PROCESSING" status — the lockedAt itself
     *      was the only "this worker is on it" signal).
     *   2. SELECT all unlocked PENDING-too-old rows + FAILED-past-retry rows and re-enqueue.
     *      Stale rows just-unlocked in step 1 fall into the PENDING branch and get
     *      enqueued exactly once.
     */
    private async sweepStuckNotifications(): Promise<number> {
        const staleResetCount = await this.clearStaleNotificationLocks();

        const result = await this.databaseService.query<{
            id: string;
            userId: string;
            type: NotificationType;
            channel: NotificationChannel;
            referenceId: string | null;
        }>(
            `
                SELECT "id", "userId", "type", "channel", "referenceId"
                FROM "NotificationLog"
                WHERE "lockedAt" IS NULL
                    AND (
                        (
                            -- BullMQ never picked it up after creation
                            "status" = $1
                            AND "createdAt" < NOW() - ($4 || ' seconds')::interval
                        )
                        OR (
                            -- FAILED but the exponential-backoff window has elapsed and retries remain
                            "status" = $2
                            AND "retryCount" < $3
                            AND "nextRetryAt" IS NOT NULL
                            AND "nextRetryAt" <= NOW()
                        )
                    )
                ORDER BY "createdAt"
                LIMIT $5
                FOR UPDATE SKIP LOCKED
            `,
            [
                NotificationStatus.PENDING,
                NotificationStatus.FAILED,
                NotificationRecoveryService.MAX_RETRIES,
                String(NotificationRecoveryService.STUCK_PENDING_AGE_SECONDS),
                NotificationRecoveryService.SWEEP_BATCH_LIMIT,
            ],
        );

        let recovered = 0;
        for (const row of result.rows) {
            const enqueueResult = await this.enqueueWithRetry({
                notificationId: row.id,
                userId: row.userId,
                type: row.type,
                channel: row.channel,
                referenceId: row.referenceId ?? undefined,
            });
            if (enqueueResult.ok) recovered++;
        }

        if (recovered > 0 || staleResetCount > 0) {
            this.logger.log(
                `[SWEEP] enqueued ${recovered} notification(s) (incl. ${staleResetCount} unlocked from stale workers)`,
                NotificationRecoveryService.name,
            );
        }
        return recovered;
    }

    /**
     * Strip stale `lockedAt` from rows whose worker has crashed. Atomic single-statement
     * UPDATE; rows just-unlocked here are picked up by the subsequent SELECT in the same
     * sweep call (no double-enqueue, because the SELECT requires lockedAt IS NULL).
     *
     * Each crash counts against the retry budget — without incrementing retryCount, a
     * worker that consistently OOMs on the same notification would loop forever (one cycle
     * per ~5 min). With the increment, the row converges to retryCount >= MAX_RETRIES and
     * the SELECT's FAILED branch (which checks retryCount < MAX_RETRIES) stops picking it up.
     */
    private async clearStaleNotificationLocks(): Promise<number> {
        // RETURNING the new retryCount + key metadata so the stale-lock reset emits a
        // [STUCK-FINAL] log line when this increment is the one that pushes the row past
        // its retry budget. Picked up by /admin/queue/stuck and by external log-aggregation
        // alerting (same prefix used across all four recovery surfaces).
        const result = await this.databaseService.query<{
            id: string;
            retryCount: number;
            channel: string;
            type: string;
            userId: string;
        }>(
            `
                UPDATE "NotificationLog"
                SET "lockedAt" = NULL,
                    "workerId" = NULL,
                    "retryCount" = COALESCE("retryCount", 0) + 1
                WHERE "lockedAt" IS NOT NULL
                    AND "lockedAt" < NOW() - ($1 || ' minutes')::interval
                    AND "status" IN ($2, $3)
                RETURNING "id", "retryCount", "channel", "type", "userId"
            `,
            [
                String(NotificationRecoveryService.STALE_LOCK_MINUTES),
                NotificationStatus.PENDING,
                NotificationStatus.FAILED,
            ],
        );

        for (const row of result.rows) {
            if (row.retryCount >= NotificationRecoveryService.MAX_RETRIES) {
                this.logger.error(
                    `[STUCK-FINAL] surface=notification id=${row.id} ` +
                    `channel=${row.channel} type=${row.type} userId=${row.userId} ` +
                    `retryCount=${row.retryCount} reason=stale-lock-cleanup`,
                    NotificationRecoveryService.name,
                );
            }
        }
        return result.rowCount ?? result.rows.length;
    }
}
