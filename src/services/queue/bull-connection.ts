import { ConfigService } from '@nestjs/config';
import { ConnectionOptions } from 'bullmq';

/**
 * Builds the Redis connection BullMQ uses. Separate from the app's REDIS_CLIENT because BullMQ
 * requires maxRetriesPerRequest: null for its blocking workers. Shared by the queue root and by
 * any QueueEvents instance (e.g. the task command pipeline awaiting job completion).
 */
export function buildBullConnection(configService: ConfigService): ConnectionOptions {
    const tlsEnabled = ['true', '1', 'yes'].includes(
        String(configService.get<string>('REDIS_TLS_ENABLED') ?? '').toLowerCase(),
    );
    const port = parseInt(String(configService.get<string>('REDIS_PORT') ?? '6379'), 10) || 6379;

    return {
        host: configService.get<string>('REDIS_HOST') ?? 'localhost',
        port,
        connectTimeout: 10000,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        keepAlive: 30000,
        ...(tlsEnabled && { tls: { rejectUnauthorized: false } }),
    };
}
