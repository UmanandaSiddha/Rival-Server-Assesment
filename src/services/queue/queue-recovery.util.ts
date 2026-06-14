import { LoggerService } from 'src/services/logger/logger.service';

/**
 * Shared primitives for queue-outbox recovery services.
 *
 * Two pieces:
 *   - `enqueueWithRetry` — generic in-process retry-with-backoff around a queue-add call.
 *     Returns ok=true on first success, ok=false only if all attempts fail. The caller is
 *     responsible for keeping a durable DB row that lets a later sweep recover anything
 *     that ended in ok=false.
 *   - `SweepGate` — per-instance, in-memory rate limiter for opportunistic sweeps. Lets
 *     callers do `if (gate.shouldSweep()) sweepNow()` without rolling their own throttle.
 *
 * Neither piece is queue-specific — writeback, notification, chat, etc. all share them.
 */

/** First attempt immediate, then 200ms, then 1000ms. Worst-case wall-clock: ~1.2s. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [0, 200, 1000];

export interface EnqueueAttempt {
    ok: boolean;
    attempts: number;
    error?: string;
}

/**
 * Run `enqueue` with bounded synchronous retry. Designed for fire-and-forget queue.add
 * calls where the durable record already exists in Postgres — failure here is recoverable
 * by a later sweep, not catastrophic.
 *
 * `label` is included in log lines so we can correlate retry/failure events with the
 * specific outbox row that needed them.
 */
export async function enqueueWithRetry(
    label: string,
    enqueue: () => Promise<unknown>,
    logger: LoggerService,
    delaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<EnqueueAttempt> {
    let lastError: any = null;

    for (let i = 0; i < delaysMs.length; i++) {
        if (delaysMs[i] > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, delaysMs[i]));
        }
        try {
            await enqueue();
            if (i > 0) {
                logger.log(`[ENQUEUE-RETRY] ${label} recovered on attempt ${i + 1}`);
            }
            return { ok: true, attempts: i + 1 };
        } catch (err: any) {
            lastError = err;
        }
    }

    logger.warn(
        `[ENQUEUE] ${label} failed after ${delaysMs.length} attempts: ` +
            `${lastError?.message ?? lastError}. Outbox row stays — sweep will retry.`,
    );
    return {
        ok: false,
        attempts: delaysMs.length,
        error: lastError?.message ?? 'enqueue failed',
    };
}

/**
 * Per-process in-memory throttle. Use case: an opportunistic sweep is fired from a hot
 * path (e.g. after every chat send), but we don't want it to actually run more than once
 * per `minIntervalMs` because the DB query has a fixed cost regardless of how busy the
 * caller is. `force=true` bypasses the gate — boot-time sweeps use this so the first
 * recovery on app start isn't skipped just because the in-memory timestamp is zero.
 */
export class SweepGate {
    private lastAt = 0;

    constructor(private readonly minIntervalMs: number) {}

    shouldSweep(force = false): boolean {
        const now = Date.now();
        if (!force && now - this.lastAt < this.minIntervalMs) return false;
        this.lastAt = now;
        return true;
    }
}
