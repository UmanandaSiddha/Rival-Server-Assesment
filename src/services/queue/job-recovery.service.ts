import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DatabaseService } from 'src/services/database/database.service';
import { LoggerService } from 'src/services/logger/logger.service';
import { JobStatus, JobType } from 'src/database/enums';
import { LLMQueue, LLMJobPayload } from './llm.queue';
import { EnqueueAttempt, SweepGate, enqueueWithRetry } from './queue-recovery.util';

/**
 * Outbox-pattern recovery for all LLM Job rows (chat, summary, project_report).
 *
 * The Job table is treated as the source of truth: a `Job` row at status=PENDING is a
 * promise that work needs doing, regardless of whether the BullMQ enqueue succeeded.
 * BullMQ is just a fast-path hint. When the hint is lost (Redis blip, process crash
 * between transaction commit and queue.add), this service is the recovery mechanism.
 *
 * Crucially, there is NO standalone cron sweeping the DB on a fixed interval. Recovery
 * runs only when:
 *   1. The application boots (`OnApplicationBootstrap`) — catches anything orphaned by
 *      a previous process.
 *   2. A new chat message is enqueued — piggybacks an opportunistic sweep on real
 *      traffic, rate-limited to one sweep per `SWEEP_MIN_INTERVAL_MS` per process so
 *      heavy chat traffic doesn't hammer the DB.
 *
 * If the app is idle and no new messages arrive, stuck jobs sit until the next deploy /
 * restart. That's an acceptable trade — the alternative (an always-on cron) costs DB
 * cycles 99% of the time for the 1% case where work is actually needed.
 *
 * Mode coverage: the sweep filter is intentionally inclusive (`payload->>'mode' IN
 * ('chat','summary','project_report')`) so summary jobs from webhook ingestion and
 * project_report jobs from the reports endpoint are recovered with the same machinery.
 * The re-enqueue preserves the original mode from the stored payload.
 */
@Injectable()
export class JobRecoveryService implements OnApplicationBootstrap {
    private readonly logger = new LoggerService(JobRecoveryService.name);
    private readonly sweepGate = new SweepGate(JobRecoveryService.SWEEP_MIN_INTERVAL_MS);

    /** Minimum gap between opportunistic sweeps within a single process. */
    private static readonly SWEEP_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 min
    /** Age threshold for a PENDING row to be considered stuck. */
    private static readonly STUCK_PENDING_AGE_SECONDS = 30;
    /** Age threshold for a RUNNING row whose worker likely crashed. */
    private static readonly STUCK_RUNNING_AGE_MINUTES = 5;
    /** Cap on rows recovered per sweep — keeps work bounded. */
    private static readonly SWEEP_BATCH_LIMIT = 25;

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly llmQueue: LLMQueue,
    ) { }

    async onApplicationBootstrap(): Promise<void> {
        // Boot sweep — `force=true` bypasses the per-process rate limit because we always
        // want to drain any jobs left behind by the previous process on startup.
        try {
            const recovered = await this.sweepIfDue({ force: true });
            if (recovered > 0) {
                this.logger.log(
                    `[BOOT-SWEEP] recovered ${recovered} orphaned LLM job(s)`,
                    JobRecoveryService.name,
                );
            }
        } catch (err: any) {
            // Never crash the app for a recovery failure — the next LLM enqueue will retry.
            this.logger.error(
                `[BOOT-SWEEP] failed: ${err?.message ?? err}`,
                JobRecoveryService.name,
            );
        }
    }

    /**
     * Enqueue with synchronous retry. Returns `ok: false` only if all attempts failed,
     * in which case the Job row stays PENDING in the DB and the next opportunistic /
     * boot sweep will pick it up. Worst-case wall-clock cost: ~1.2 s.
     */
    async enqueueChatWithRetry(payload: LLMJobPayload): Promise<EnqueueAttempt> {
        return enqueueWithRetry(
            `job=${payload.jobId}`,
            () => this.llmQueue.enqueue(payload),
            this.logger,
        );
    }

    /**
     * Rate-limited opportunistic sweep. Designed to be called fire-and-forget from a
     * hot path (e.g. right after enqueueing a fresh chat job) — it self-throttles so
     * busy chat traffic doesn't translate into thrashing the Job table.
     */
    async sweepIfDue(opts: { force?: boolean } = {}): Promise<number> {
        if (!this.sweepGate.shouldSweep(opts.force)) return 0;
        return this.sweepPendingChatJobs();
    }

    /**
     * The modes this sweep recovers. Each mode's BullMQ payload shape is `LLMJobPayload`
     * with a discriminator on `mode`; the worker dispatches accordingly. By treating the
     * stored payload as authoritative and re-using its `mode`, we recover any LLM job
     * regardless of which entry-point created it.
     */
    private static readonly RECOVERABLE_MODES: ReadonlyArray<LLMJobPayload['mode']> = [
        'chat',
        'summary',
        'project_report',
        'agent',
    ];

    /**
     * Two recovery paths, in this order:
     *   1. Reset stale RUNNING rows back to PENDING (single atomic UPDATE). We do NOT
     *      enqueue them here — step 2's SELECT picks them up. Otherwise we'd enqueue
     *      twice, because the reset row's `created_at` is unchanged and still satisfies
     *      the `< NOW() - 30s` filter below.
     *   2. SELECT all PENDING rows older than the stuck threshold (now including any
     *      just-reset rows from step 1) and enqueue each one. `FOR UPDATE SKIP LOCKED`
     *      keeps multi-instance deploys safe — two replicas running this concurrently
     *      won't fight over the same row.
     *
     * Covers chat, summary, and project_report jobs — the WHERE clause filters on
     * RECOVERABLE_MODES so a future new mode is recovered the moment it's added there.
     */
    private async sweepPendingChatJobs(): Promise<number> {
        const staleRunningReset = await this.resetStaleRunningJobs();

        const pendingResult = await this.databaseService.query<{ id: string; payload: any }>(
            `
                SELECT id, payload
                FROM "Job"
                WHERE type = $1
                    AND status = $2
                    AND created_at < NOW() - ($3 || ' seconds')::interval
                    AND attempts < "maxAttempts"
                    AND payload->>'mode' = ANY($5::text[])
                ORDER BY created_at
                LIMIT $4
                FOR UPDATE SKIP LOCKED
            `,
            [
                JobType.LLM,
                JobStatus.PENDING,
                String(JobRecoveryService.STUCK_PENDING_AGE_SECONDS),
                JobRecoveryService.SWEEP_BATCH_LIMIT,
                JobRecoveryService.RECOVERABLE_MODES as unknown as string[],
            ],
        );

        let enqueued = 0;
        for (const row of pendingResult.rows) {
            const payload = (row.payload ?? {}) as LLMJobPayload;
            // Preserve the original `mode` from the stored payload — never assume 'chat'.
            // A summary or project_report row re-enqueued as 'chat' would silently fail in
            // the worker, which would mask the recovery success.
            const result = await this.enqueueChatWithRetry({
                ...payload,
                jobId: row.id,
            });
            if (result.ok) enqueued++;
        }

        if (enqueued > 0 || staleRunningReset > 0) {
            this.logger.log(
                `[SWEEP] enqueued=${enqueued} (incl. ${staleRunningReset} reset from stale RUNNING)`,
                JobRecoveryService.name,
            );
        }
        return enqueued;
    }

    /**
     * Reset stale RUNNING rows to PENDING in a single atomic UPDATE. Returns the count of
     * affected rows for telemetry — the caller does NOT re-enqueue these, they're left for
     * the immediately-following PENDING sweep to pick up (avoids double-enqueue).
     *
     * `attempts` is incremented here so a worker that crashes mid-process consumes one
     * retry credit. Without this, a job that consistently OOMs the worker would loop
     * forever (stale-reset every ~5 min) — the `attempts < maxAttempts` guard above
     * would never trip. With it, after maxAttempts crashes the row stops being recovered.
     */
    private async resetStaleRunningJobs(): Promise<number> {
        // RETURNING the new attempts count + mode so we can emit a [STUCK-FINAL] log line
        // when a stale-lock reset is the increment that pushes the job past its retry budget.
        // Mirrors the format used by the other three recovery surfaces.
        const result = await this.databaseService.query<{
            id: string;
            attempts: number;
            maxAttempts: number;
            mode: string;
        }>(
            `
                UPDATE "Job"
                SET status = $1,
                    attempts = attempts + 1,
                    "lockedAt" = NULL,
                    "workerId" = NULL,
                    "updated_at" = NOW()
                WHERE type = $2
                    AND status = $3
                    AND "lockedAt" IS NOT NULL
                    AND "lockedAt" < NOW() - ($4 || ' minutes')::interval
                    AND attempts < "maxAttempts"
                    AND payload->>'mode' = ANY($5::text[])
                RETURNING id, attempts, "maxAttempts", payload->>'mode' AS mode
            `,
            [
                JobStatus.PENDING,
                JobType.LLM,
                JobStatus.RUNNING,
                String(JobRecoveryService.STUCK_RUNNING_AGE_MINUTES),
                JobRecoveryService.RECOVERABLE_MODES as unknown as string[],
            ],
        );

        for (const row of result.rows) {
            if (row.attempts >= row.maxAttempts) {
                this.logger.error(
                    `[STUCK-FINAL] surface=llm-job id=${row.id} mode=${row.mode} ` +
                    `attempts=${row.attempts} maxAttempts=${row.maxAttempts} ` +
                    `reason=stale-running-reset`,
                    JobRecoveryService.name,
                );
            }
        }

        return result.rowCount ?? result.rows.length;
    }
}
