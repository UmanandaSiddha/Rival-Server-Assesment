import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
    InjectThrottlerOptions,
    InjectThrottlerStorage,
    ThrottlerGuard,
    ThrottlerModuleOptions,
    ThrottlerStorage,
} from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';

type JwtPayload = {
    id?: string;
};

type RequestWithUser = Record<string, any> & {
    ip?: string;
    ips?: string[];
    cookies?: Record<string, string>;
    headers?: Record<string, string | string[] | undefined>;
    user?: {
        id?: string;
    };
};

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
    constructor(
        @InjectThrottlerOptions() options: ThrottlerModuleOptions,
        @InjectThrottlerStorage() storageService: ThrottlerStorage,
        reflector: Reflector,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
    ) {
        super(options, storageService, reflector);
    }

    protected async getTracker(req: RequestWithUser): Promise<string> {
        const userIdFromRequest = req.user?.id;
        if (userIdFromRequest) {
            return `user:${userIdFromRequest}`;
        }

        const token = this.extractToken(req);
        const userIdFromToken = await this.resolveUserIdFromToken(token);
        if (userIdFromToken) {
            return `user:${userIdFromToken}`;
        }

        return `ip:${this.getClientIp(req)}`;
    }

    private extractToken(req: RequestWithUser): string | undefined {
        const cookieToken = req.cookies?.accessToken;
        if (cookieToken) {
            return cookieToken;
        }

        const authHeader = req.headers?.authorization;
        const normalized = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        if (!normalized) {
            return undefined;
        }

        const [scheme, token] = normalized.split(' ');
        if (scheme?.toLowerCase() !== 'bearer' || !token) {
            return undefined;
        }

        return token;
    }

    private async resolveUserIdFromToken(token?: string): Promise<string | undefined> {
        if (!token) {
            return undefined;
        }

        const secret = this.configService.get<string>('ACCESS_TOKEN_SECRET');
        if (!secret) {
            return undefined;
        }

        try {
            const payload = await this.jwtService.verifyAsync<JwtPayload>(token, { secret });
            return payload.id;
        } catch {
            return undefined;
        }
    }

    private getClientIp(req: RequestWithUser): string {
        if (Array.isArray(req.ips) && req.ips.length > 0) {
            return req.ips[0];
        }

        const forwarded = req.headers?.['x-forwarded-for'];
        const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        if (forwardedValue) {
            const firstForwardedIp = forwardedValue.split(',')[0]?.trim();
            if (firstForwardedIp) {
                return firstForwardedIp;
            }
        }

        return req.ip ?? 'unknown';
    }
}