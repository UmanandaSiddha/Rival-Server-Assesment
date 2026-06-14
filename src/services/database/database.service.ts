import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseIntoClientConfig } from 'pg-connection-string';
import { Pool, PoolClient, PoolConfig, QueryResult } from 'pg';

/**
 * Expand the URL via parseIntoClientConfig and set `ssl` explicitly (passing connectionString + ssl
 * together makes pg use rejectUnauthorized: true → SELF_SIGNED_CERT_IN_CHAIN on RDS).
 */
function poolConfigFromDatabaseUrl(connectionString: string | undefined): PoolConfig {
    if (!connectionString?.trim()) {
        return { connectionString };
    }

    let raw = connectionString.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

    let parsed: PoolConfig;
    try {
        parsed = parseIntoClientConfig(raw) as PoolConfig;
    } catch {
        const lower = raw.toLowerCase();
        if (lower.includes('rds.amazonaws.com') || lower.includes('sslmode=require')) {
            return { connectionString: raw, ssl: { rejectUnauthorized: false } };
        }
        return { connectionString: raw };
    }

    const host = String(parsed.host ?? '').toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const isRds = host.includes('rds.amazonaws.com');
    const hadSsl = Boolean(parsed.ssl);
    const strictSsl = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true';

    // Drop libpq-only keys that pg.Pool may not expect (avoid passing through)
    const { sslmode: _s, ...rest } = parsed as PoolConfig & { sslmode?: string };

    if (isLocal && !hadSsl) {
        return { ...rest, ssl: false };
    }

    if (isRds || hadSsl) {
        return {
            ...rest,
            ssl: strictSsl ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
        };
    }

    return rest;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
    private readonly pool: Pool;

    constructor(private readonly configService: ConfigService) {
        const connectionString = this.configService.get<string>('DATABASE_URL') || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error('DATABASE_URL is not set — cannot initialize the database pool.');
        }

        this.pool = new Pool(poolConfigFromDatabaseUrl(connectionString));
    }

    async onModuleInit() {
        await this.pool.query('SELECT 1');
    }

    async onModuleDestroy() {
        await this.pool.end();
    }

    async query<T = any>(text: string, params: any[] = []): Promise<QueryResult<T>> {
        return this.pool.query<T>(text, params);
    }

    async withTransaction<T>(
        handler: (client: PoolClient) => Promise<T>,
        client?: PoolClient,
    ): Promise<T> {
        if (client) {
            return handler(client);
        }

        const txClient = await this.pool.connect();
        try {
            await txClient.query('BEGIN');
            const result = await handler(txClient);
            await txClient.query('COMMIT');
            return result;
        } catch (error) {
            // Don't let a ROLLBACK failure mask the real error that triggered it.
            try {
                await txClient.query('ROLLBACK');
            } catch (rollbackErr) {
                console.error('ROLLBACK failed while handling a transaction error:', rollbackErr);
            }
            throw error;
        } finally {
            txClient.release();
        }
    }

    /**
     * Run `handler` under a session-level advisory lock keyed by `key`, acquired non-blockingly and
     * released on the same client. Returns `null` without running if the lock is already held — callers
     * treat that as "someone else owns this, skip". For serializing long, non-transactional work per entity.
     */
    async withAdvisoryLock<T>(key: string, handler: () => Promise<T>): Promise<T | null> {
        const client = await this.pool.connect();
        try {
            const got = await client.query<{ ok: boolean }>(
                `SELECT pg_try_advisory_lock(hashtext($1)) AS ok`,
                [key],
            );
            if (!got.rows[0]?.ok) return null;
            try {
                return await handler();
            } finally {
                await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]).catch(() => undefined);
            }
        } finally {
            client.release();
        }
    }
}