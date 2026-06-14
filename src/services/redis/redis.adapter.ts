import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { INestApplicationContext } from '@nestjs/common';
import { createRedisConnection } from './redis.module';
import { AuthService } from 'src/modules/auth/auth.service';

function extractAccessTokenFromCookieHeader(cookieHeader?: string): string | undefined {
    if (!cookieHeader) { return undefined; }
    for (const part of cookieHeader.split(';')) {
        const trimmed = part.trim();
        if (trimmed.startsWith('accessToken=')) {
            return decodeURIComponent(trimmed.slice('accessToken='.length));
        }
    }
    return undefined;
}

export class RedisIoAdapter extends IoAdapter {
    private adapterConstructor: ReturnType<typeof createAdapter>;
    private readonly pubClient: Redis;
    private readonly subClient: Redis;
    private readonly app: INestApplicationContext;

    constructor(app: INestApplicationContext, private readonly configService: ConfigService) {
        super(app);
        this.app = app;

        // Use the shared Redis configuration
        this.pubClient = createRedisConnection(this.configService);
        this.subClient = createRedisConnection(this.configService);

        // Add specific event listeners for the adapter
        this.pubClient.on('error', (err) => {
            console.error('Redis Adapter Publisher Error:', err.message);
        });
        this.subClient.on('error', (err) => {
            console.error('Redis Adapter Subscriber Error:', err.message);
        });

        // Add connection success logs
        this.pubClient.on('ready', () => {
            console.log('Redis Publisher for Socket.IO adapter is ready');
        });
        this.subClient.on('ready', () => {
            console.log('Redis Subscriber for Socket.IO adapter is ready');
        });
    }

    async connectToRedis(): Promise<void> {
        try {
            this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
            console.log('RedisIoAdapter is ready.');
        } catch (error) {
            console.error('Failed to create Redis adapter. WebSockets will not be scalable.', error);
            throw error;
        }
    }

    createIOServer(port: number, options?: ServerOptions): any {
        const server = super.createIOServer(port, options);
        if (this.adapterConstructor) {
            server.adapter(this.adapterConstructor);
            console.log('Socket.IO server using Redis adapter');
        } else {
            console.warn('Redis adapter is not available. Running in standalone WebSocket mode.');
        }

        // Authenticate every WS handshake before the gateway's handleConnection runs.
        //
        // Without this, gateways read `client.data.user` in handleConnection and find it
        // undefined — `@UseGuards(SocketGuard)` only fires on @SubscribeMessage handlers,
        // not on connection lifecycle hooks. The result was every WS being disconnected
        // immediately ("WebSocket is closed before the connection is established"), with the
        // SSE fallback silently masking the failure.
        //
        // Token sources, in priority order:
        //   1. handshake.auth.token — set by the frontend (`io(url, { auth: { token } })`).
        //      This is the only path that works cross-origin (e.g. app.ovlox.dev → api.ovlox.dev),
        //      because the browser doesn't send cookies cross-site.
        //   2. accessToken cookie — works for same-origin connections (local dev).
        const authService = this.app.get(AuthService);

        const authMiddleware = async (socket: any, next: (err?: Error) => void) => {
            try {
                const authToken = socket.handshake?.auth?.token as string | undefined;
                const cookieHeader = socket.handshake?.headers?.cookie as string | undefined;
                const cookieToken = extractAccessTokenFromCookieHeader(cookieHeader);
                const token = authToken || cookieToken;
                if (!token) {
                    return next(new Error('Unauthorized: missing token'));
                }
                const user = await authService.validateUserByToken(token);
                socket.data.user = user;
                next();
            } catch (err) {
                next(new Error(`Unauthorized: ${(err as Error).message || 'invalid token'}`));
            }
        };

        // Apply to the default namespace and any explicitly named namespace (e.g. /chat).
        // `server.of(/.*/)` matches all current AND future namespaces.
        server.use(authMiddleware);
        server.of(/.*/).use(authMiddleware);

        return server;
    }
}