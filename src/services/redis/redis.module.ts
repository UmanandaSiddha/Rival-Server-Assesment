import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RealtimeBus } from './realtime-bus.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { REDIS_CLIENT } from 'src/config/constants';

export const createRedisConnection = (configService: ConfigService): Redis => {
    const host =
        configService.get<string>('REDIS_HOST') ?? process.env.REDIS_HOST;
    const portRaw =
        configService.get<string>('REDIS_PORT') ??
        process.env.REDIS_PORT ??
        '6379';
    const port = parseInt(String(portRaw), 10) || 6379;
    const tlsEnabled = ['true', '1', 'yes'].includes(
        String(
            configService.get<string>('REDIS_TLS_ENABLED') ??
                process.env.REDIS_TLS_ENABLED ??
                '',
        ).toLowerCase(),
    );

    if (!host || !host.trim()) {
        throw new Error(
            'Missing Redis connection details: REDIS_HOST is required.',
        );
    }

    const config: RedisOptions = {
        host: host.trim(),
        port,
        connectTimeout: 10000,
        lazyConnect: false,
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
            const delay = Math.min(times * 2000, 30000);
            console.log(`Redis retry attempt ${times}, delay: ${delay}ms`);
            return delay;
        },
        enableReadyCheck: true,
        keepAlive: 30000,
        ...(tlsEnabled && {
            tls: { rejectUnauthorized: false },
        }),
        reconnectOnError: (err: Error) => {
            const targetErrors = [
                'READONLY',
                'ECONNRESET',
                'ENOTFOUND',
                'ETIMEDOUT',
                'Socket closed unexpectedly',
            ];
            console.error('Redis connection error:', err.message);
            return targetErrors.some((targetError) =>
                err.message.includes(targetError),
            )
                ? 1
                : false;
        },
    };

    const client = new Redis(config);

    client.on('connect', () =>
        console.log(`Redis TCP connection established to ${host}:${port}`),
    );
    client.on('ready', () => console.log('Redis is ready for commands'));
    client.on('end', () =>
        console.warn('Redis connection closed. Attempting to reconnect...'),
    );
    client.on('reconnecting', (ms: number) =>
        console.log(`Redis reconnecting in ${ms}ms...`),
    );
    client.on('error', (err) =>
        console.error('Redis Client Error:', err.message),
    );

    return client;
};

@Global()
@Module({
    imports: [ConfigModule],
    providers: [
        {
            provide: REDIS_CLIENT,
            inject: [ConfigService],
            useFactory: async (configService: ConfigService) => {
                const client = createRedisConnection(configService);
                console.log('Redis client created via RedisModule.');
                return client;
            },
        },
        RedisService,
        RealtimeBus,
    ],
    exports: [RedisService, RealtimeBus, REDIS_CLIENT],
})
export class RedisModule {}
