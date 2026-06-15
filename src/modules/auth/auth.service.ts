import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import {
    OtpDto,
    SignUpDto,
    LoginDto,
} from './dto';
import { RedisService } from 'src/services/redis/redis.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Request, Response } from 'express';
import { RequestDto } from './dto/request.dto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from 'src/database/enums';
import { REDIS_USER_TOKEN_CACHE_PREFIX, USER_TOKEN_CACHE_TTL } from 'src/config/constants';
import { DatabaseService } from 'src/services/database/database.service';
import { EmailQueue } from 'src/services/queue/email.queue';
import { toCamelCaseDeep } from 'src/services/common/case-conversion.util';

// System role seeded for every new user in their default team (migration 004).
const ADMIN_SYSTEM_ROLE_ID = 'role_system_admin';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type AuthenticatedUser = {
    id: string;
    [key: string]: any;
};

@Injectable()
export class AuthService {

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly configService: ConfigService,
        private readonly jwtService: JwtService,
        private readonly redisService: RedisService,
        private readonly emailQueue: EmailQueue,
    ) { }

    // --- Helper Functions ---

    // Verify user by token with caching
    async validateUserByToken(token: string): Promise<AuthenticatedUser> {
        try {
            const cacheKey = `${REDIS_USER_TOKEN_CACHE_PREFIX}:${token}`;
            const cachedUser = await this.redisService.get(cacheKey);

            if (cachedUser) {
                return JSON.parse(cachedUser) as AuthenticatedUser;
            }

            const secret = this.configService.get<string>('ACCESS_TOKEN_SECRET');
            const payload: { id: string } = await this.jwtService.verifyAsync(token, { secret });

            const userResult = await this.databaseService.query(
                `SELECT * FROM "User" WHERE "id" = $1 LIMIT 1`,
                [payload.id],
            );
            const user = userResult.rows[0] ? toCamelCaseDeep(userResult.rows[0]) as AuthenticatedUser : null;
            if (!user) throw new UnauthorizedException('Invalid user.');
            if (user.isDisabled) throw new UnauthorizedException('Account is blocked.');

            await this.redisService.set(cacheKey, JSON.stringify(user), USER_TOKEN_CACHE_TTL);

            return user;
        } catch (err: any) {
            if (err.name === 'TokenExpiredError') throw new UnauthorizedException('Token expired.');
            throw new UnauthorizedException('Invalid token.');
        }
    }

    // Invalidate the token cache when a user's data changes.
    async invalidateUserCache(userId: string): Promise<void> {
        try {
            const pattern = `${REDIS_USER_TOKEN_CACHE_PREFIX}:*`;
            const keys = await this.redisService.scanKeys(pattern);

            if (keys.length > 0) {
                const keysToDelete: string[] = [];
                for (const key of keys) {
                    const cachedData = await this.redisService.get(key);
                    if (cachedData) {
                        const user = JSON.parse(cachedData);
                        if (user.id === userId) {
                            keysToDelete.push(key);
                        }
                    }
                }
                if (keysToDelete.length > 0) {
                    await this.redisService.del(...keysToDelete);
                }
            }
        } catch (error) {
            console.error('Failed to invalidate user cache:', error);
        }
    }

    async generateToken(userId: string, type: 'ACCESS_TOKEN' | 'REFRESH_TOKEN', sessionId: string | null): Promise<string> {
        const secret = type === 'ACCESS_TOKEN'
            ? this.configService.get<string>('ACCESS_TOKEN_SECRET')
            : this.configService.get<string>('REFRESH_TOKEN_SECRET');
        const expiresIn = type === 'ACCESS_TOKEN' ? '15m' : '7d';

        const payload = type === 'ACCESS_TOKEN' ? { id: userId } : { id: userId, sessionId };

        return this.jwtService.sign(payload, { secret, expiresIn });
    }

    // 6-digit OTP; always '000000' in development.
    async generateOTP(): Promise<{ otpString: string, otpToken: string, otpExpire: number }> {
        let otpString: string;
        if (this.configService.get<string>('NODE_ENV') !== 'development') {
            otpString = Math.floor(100000 + Math.random() * 900000).toString();
        } else {
            otpString = '000000';
        }

        const otpToken = crypto
            .createHash('sha256')
            .update(otpString)
            .digest('hex');

        const otpExpire = Date.now() + 5 * 60 * 1000;

        return { otpString, otpToken, otpExpire };
    }

    async sendToken(res: Response, type: 'ACCESS_TOKEN' | 'REFRESH_TOKEN', token: string): Promise<void> {
        const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
        const tokenName = type === 'ACCESS_TOKEN' ? 'accessToken' : 'refreshToken';
        const age = type === 'ACCESS_TOKEN' ? 15 : 7 * 24 * 60;

        res.cookie(tokenName, token, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            maxAge: age * 60 * 1000,
            path: '/',
        });
    }

    async clearToken(res: Response, type: 'ACCESS_TOKEN' | 'REFRESH_TOKEN'): Promise<void> {
        const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
        const tokenName = type === 'ACCESS_TOKEN' ? 'accessToken' : 'refreshToken';

        res.clearCookie(tokenName, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            path: '/',
        });
    }

    /** Queue the OTP email. */
    private async deliverOtp(email: string, otpString: string, firstName?: string): Promise<void> {
        await this.emailQueue.enqueue({
            to: email,
            subject: 'Your verification code',
            template: 'otp',
            data: { otpCode: otpString, firstName, expiresInMinutes: 5 },
        });
    }

    /** Queue a welcome email after a user verifies. */
    private async deliverWelcome(email: string, firstName?: string): Promise<void> {
        await this.emailQueue.enqueue({
            to: email,
            subject: 'Welcome aboard',
            template: 'welcome',
            data: { firstName },
        });
    }

    // --- Services ---

    /** Current authenticated user (safe columns only) — lets the client rehydrate on refresh. */
    async me(userId: string) {
        const result = await this.databaseService.query(
            `
                SELECT "id", "email", "firstName", "lastName", "role", "isVerified", "isOnline",
                    "isDisabled", "avatarUrl", "timezone", "created_at", "updated_at"
                FROM "User" WHERE "id" = $1 LIMIT 1
            `,
            [userId],
        );
        if (!result.rows[0]) throw new UnauthorizedException('User not found');
        return { data: toCamelCaseDeep(result.rows[0]) };
    }

    async requestOtp(dto: RequestDto) {
        const { email } = dto;

        const userResult = await this.databaseService.query(
            `SELECT * FROM "User" WHERE "email" = $1 LIMIT 1`,
            [email],
        );
        const user = userResult.rows[0] ? toCamelCaseDeep(userResult.rows[0]) : null;
        if (!user) throw new BadRequestException('Invalid Request!!');

        const { otpString, otpToken, otpExpire } = await this.generateOTP();

        await this.databaseService.query(
            `
                UPDATE "User"
                SET
                    "oneTimePassword" = $1,
                    "oneTimeExpire" = $2,
                    "updated_at" = NOW()
                WHERE "id" = $3
            `,
            [otpToken, new Date(otpExpire), user.id],
        );

        await this.deliverOtp(email, otpString, user.firstName);

        return { message: 'OTP sent successfully!!', success: true };
    }

    async signUp(dto: SignUpDto, res: Response) {
        const { firstName, lastName, email, password } = dto;

        const existing = await this.databaseService.query(
            `SELECT "id" FROM "User" WHERE "email" = $1 LIMIT 1`,
            [email],
        );
        if (existing.rows[0]) throw new BadRequestException('User already exists !!');

        const hashedPassword = await bcrypt.hash(password, 10);
        const { otpString, otpToken, otpExpire } = await this.generateOTP();

        const isAdmin = this.configService.get<string>('DEFAULT_ADMIN_EMAIL') === email;

        const { newUser, session } = await this.databaseService.withTransaction(async (client) => {
            const userInsert = await client.query(
                `
                    INSERT INTO "User" (
                        "firstName",
                        "lastName",
                        "password",
                        "email",
                        "role",
                        "oneTimePassword",
                        "oneTimeExpire"
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING *
                `,
                [
                    firstName,
                    lastName,
                    hashedPassword,
                    email,
                    isAdmin ? UserRole.ADMIN : UserRole.USER,
                    otpToken,
                    new Date(otpExpire),
                ],
            );
            const newUser = userInsert.rows[0];

            // Give the new user a default (personal) team and make them its owner + Admin member.
            const teamInsert = await client.query(
                `
                    INSERT INTO "Team" ("name", "ownerId", "isDefault")
                    VALUES ($1, $2, true)
                    RETURNING *
                `,
                [`${firstName}'s Team`, newUser.id],
            );
            const team = teamInsert.rows[0];

            await client.query(
                `
                    INSERT INTO "TeamMember" ("teamId", "userId", "roleId")
                    VALUES ($1, $2, $3)
                `,
                [team.id, newUser.id, ADMIN_SYSTEM_ROLE_ID],
            );

            const sessionInsert = await client.query(
                `
                    INSERT INTO "Session" ("userId", "refreshToken", "expiresAt")
                    VALUES ($1, $2, $3)
                    RETURNING *
                `,
                [newUser.id, '', new Date(Date.now() + SESSION_TTL_MS)],
            );

            return {
                newUser: toCamelCaseDeep(newUser),
                session: toCamelCaseDeep(sessionInsert.rows[0]),
            };
        });

        const accessToken = await this.generateToken(newUser.id, 'ACCESS_TOKEN', null);
        const refreshToken = await this.generateToken(newUser.id, 'REFRESH_TOKEN', session.id);

        const hashedToken = await bcrypt.hash(refreshToken, 10);

        await this.databaseService.query(
            `UPDATE "Session" SET "refreshToken" = $1, "updated_at" = NOW() WHERE "id" = $2`,
            [hashedToken, session.id],
        );

        const clientRefreshToken = `${session.id}.${refreshToken}`;

        await this.sendToken(res, 'ACCESS_TOKEN', accessToken);
        await this.sendToken(res, 'REFRESH_TOKEN', clientRefreshToken);

        await this.deliverOtp(email, otpString, firstName);

        const { password: _pw, oneTimePassword: _otp, oneTimeExpire: _otpExp, ...safeUser } = newUser as any;

        return { message: 'User registered successfully!!', data: safeUser };
    }

    async verifyOtp(dto: OtpDto, res: Response) {
        const { otpString, email } = dto;
        const oneTimePassword = crypto.createHash('sha256').update(otpString).digest('hex');

        const userResult = await this.databaseService.query(
            `
                SELECT *
                FROM "User"
                WHERE "oneTimePassword" = $1
                    AND "oneTimeExpire" > NOW()
                    AND "email" = $2
                LIMIT 1
            `,
            [oneTimePassword, email],
        );

        const user = userResult.rows[0] ? toCamelCaseDeep(userResult.rows[0]) : null;
        if (!user) throw new BadRequestException('Invalid OTP or expired');

        const updatedUserResult = await this.databaseService.query(
            `
                UPDATE "User"
                SET
                    "isVerified" = TRUE,
                    "oneTimePassword" = NULL,
                    "oneTimeExpire" = NULL,
                    "updated_at" = NOW()
                WHERE "id" = $1
                RETURNING *
            `,
            [user.id],
        );

        const updatedUser = toCamelCaseDeep(updatedUserResult.rows[0]);

        await this.invalidateUserCache(user.id);

        const sessionResult = await this.databaseService.query(
            `
                INSERT INTO "Session" ("userId", "refreshToken", "expiresAt")
                VALUES ($1, $2, $3)
                RETURNING *
            `,
            [user.id, '', new Date(Date.now() + SESSION_TTL_MS)],
        );

        const session = toCamelCaseDeep(sessionResult.rows[0]);

        const accessToken = await this.generateToken(updatedUser.id, 'ACCESS_TOKEN', null);
        const refreshToken = await this.generateToken(updatedUser.id, 'REFRESH_TOKEN', session.id);

        const hashedToken = await bcrypt.hash(refreshToken, 10);

        await this.databaseService.query(
            `UPDATE "Session" SET "refreshToken" = $1, "updated_at" = NOW() WHERE "id" = $2`,
            [hashedToken, session.id],
        );

        const clientRefreshToken = `${session.id}.${refreshToken}`;

        await this.sendToken(res, 'ACCESS_TOKEN', accessToken);
        await this.sendToken(res, 'REFRESH_TOKEN', clientRefreshToken);

        await this.deliverWelcome(updatedUser.email, updatedUser.firstName);

        const { password: _pw, oneTimePassword: _otp, oneTimeExpire: _otpExp, ...safeUser } = updatedUser as any;

        return { message: 'User verified successfully', data: safeUser };
    }

    async refreshToken(req: Request, res: Response) {
        const clientToken = req.cookies?.['refreshToken'] || req.headers.authorization?.split(' ')?.[1];
        if (!clientToken) throw new NotFoundException('Refresh token not found!!');

        const parts = clientToken.split('.');
        const sessionId = parts.shift();
        const token = parts.join('.');

        if (!sessionId || !token) throw new UnauthorizedException('Malformed token');

        const decoded = await this.jwtService.verifyAsync(token, {
            secret: this.configService.get<string>('REFRESH_TOKEN_SECRET'),
        });
        if (!decoded) throw new UnauthorizedException('Invalid refresh token!!');

        const userResult = await this.databaseService.query(
            `SELECT * FROM "User" WHERE "id" = $1 LIMIT 1`,
            [decoded.id],
        );
        const user = userResult.rows[0] ? toCamelCaseDeep(userResult.rows[0]) : null;
        if (!user) throw new UnauthorizedException('Invalid refresh token!!');

        const sessionResult = await this.databaseService.query(
            `SELECT * FROM "Session" WHERE "id" = $1 LIMIT 1`,
            [decoded.sessionId],
        );
        const session = sessionResult.rows[0] ? toCamelCaseDeep(sessionResult.rows[0]) : null;
        if (!session) throw new ForbiddenException('Session expired');

        if (new Date(session.expiresAt) <= new Date(Date.now())) {
            await this.databaseService.query(
                `DELETE FROM "Session" WHERE "id" = $1`,
                [session.id],
            );
            throw new ForbiddenException('Session expired');
        }

        const valid = await bcrypt.compare(token, session.refreshToken);
        if (!valid) throw new ForbiddenException('Invalid session');

        // Rotate both tokens
        const accessToken = await this.generateToken(user.id, 'ACCESS_TOKEN', null);
        const newRefreshToken = await this.generateToken(user.id, 'REFRESH_TOKEN', session.id);

        const hashedToken = await bcrypt.hash(newRefreshToken, 10);

        await this.databaseService.query(
            `UPDATE "Session" SET "refreshToken" = $1, "expiresAt" = $2, "updated_at" = NOW() WHERE "id" = $3`,
            [hashedToken, new Date(Date.now() + SESSION_TTL_MS), session.id],
        );

        const clientRefreshToken = `${session.id}.${newRefreshToken}`;

        await this.sendToken(res, 'ACCESS_TOKEN', accessToken);
        await this.sendToken(res, 'REFRESH_TOKEN', clientRefreshToken);

        return { message: 'Token refreshed successfully' };
    }

    async signIn(dto: LoginDto, res: Response) {
        const { password, email } = dto;

        const userResult = await this.databaseService.query(
            `SELECT * FROM "User" WHERE "email" = $1 LIMIT 1`,
            [email],
        );

        const user = userResult.rows[0] ? toCamelCaseDeep(userResult.rows[0]) : null;
        if (!user) throw new BadRequestException('Invalid credentials!!');
        if (user.isDisabled) throw new ForbiddenException('Account is blocked. Contact support.');

        const isPasswordValid = user.password ? await bcrypt.compare(password, user.password) : false;
        if (!isPasswordValid) throw new BadRequestException('Invalid credentials!!');

        const sessionResult = await this.databaseService.query(
            `
                INSERT INTO "Session" ("userId", "refreshToken", "expiresAt")
                VALUES ($1, $2, $3)
                RETURNING *
            `,
            [user.id, '', new Date(Date.now() + SESSION_TTL_MS)],
        );

        const session = toCamelCaseDeep(sessionResult.rows[0]);

        const accessToken = await this.generateToken(user.id, 'ACCESS_TOKEN', null);
        const refreshToken = await this.generateToken(user.id, 'REFRESH_TOKEN', session.id);

        const hashedToken = await bcrypt.hash(refreshToken, 10);

        await this.databaseService.query(
            `UPDATE "Session" SET "refreshToken" = $1, "updated_at" = NOW() WHERE "id" = $2`,
            [hashedToken, session.id],
        );

        const clientRefreshToken = `${session.id}.${refreshToken}`;

        await this.sendToken(res, 'ACCESS_TOKEN', accessToken);
        await this.sendToken(res, 'REFRESH_TOKEN', clientRefreshToken);

        const { password: _pw, oneTimePassword: _otp, oneTimeExpire: _otpExp, ...safeUser } = user as any;

        return { message: 'User logged in successfully!!', data: safeUser };
    }

    async logout(req: Request, res: Response, userId: string) {
        const refreshToken = req.cookies.refreshToken;

        if (refreshToken) {
            const [sessionId] = refreshToken.split('.');

            if (sessionId) {
                await this.databaseService.query(
                    `DELETE FROM "Session" WHERE "id" = $1 AND "userId" = $2`,
                    [sessionId, userId],
                );
            }
        }

        await this.invalidateUserCache(userId);

        await this.clearToken(res, 'ACCESS_TOKEN');
        await this.clearToken(res, 'REFRESH_TOKEN');

        return { success: true, message: 'User logged out successfully!!' };
    }
}
