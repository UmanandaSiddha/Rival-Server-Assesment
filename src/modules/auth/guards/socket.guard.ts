import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
} from '@nestjs/common';
import { Socket } from 'socket.io';
import { AuthService } from '../auth.service';

@Injectable()
export class SocketGuard implements CanActivate {
    constructor(private readonly authService: AuthService) { }

    private extractAccessTokenFromCookieHeader(cookieHeader?: string): string | undefined {
        if (!cookieHeader) {
            return undefined;
        }

        const parts = cookieHeader.split(';');
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed.startsWith('accessToken=')) {
                return decodeURIComponent(trimmed.slice('accessToken='.length));
            }
        }

        return undefined;
    }

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const client: Socket = ctx.switchToWs().getClient<Socket>();
        const authToken = client.handshake.auth?.token as string | undefined;
        const cookieHeader = client.handshake.headers?.cookie as string | undefined;
        const cookieToken = this.extractAccessTokenFromCookieHeader(cookieHeader);
        const token = authToken || cookieToken;

        if (!token) {
            throw new UnauthorizedException('No auth token found in socket handshake or cookies');
        }

        const user = await this.authService.validateUserByToken(token);
        client.data.user = user;
        return true;
    }
}
