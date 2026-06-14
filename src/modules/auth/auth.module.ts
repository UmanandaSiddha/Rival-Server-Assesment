import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthGuard } from './guards/auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { DatabaseModule } from 'src/services/database/database.module';
import { RedisModule } from 'src/services/redis/redis.module';
import { SocketGuard } from './guards/socket.guard';
import { AuthorizationService } from './authorization.service';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { UserThrottlerGuard } from './guards/user-throttler.guard';

@Module({
	imports: [
		ConfigModule,
		DatabaseModule,
		RedisModule,
		ThrottlerModule.forRoot([
			// `auth` — for any credential-bearing endpoint (sign-in, sign-up, google).
			// Pre-2026-05 this was `short: 3 per 1s` which is 180/min — way too loose
			// against credential stuffing. Tightened to 5/min per IP+route, which still
			// lets honest users retry a misclick without locking them out for an hour.
			{ name: 'auth', ttl: 60_000, limit: 5 },
			// `otp` — for OTP request/verify. A wider window (5 min) because OTPs are
			// the primary attack surface for brute force; 5 attempts per 5 min keeps the
			// success probability against a 6-digit OTP under 1 in 200k.
			{ name: 'otp', ttl: 300_000, limit: 5 },
			// `long` — kept for any consumers still referencing the old name.
			{ name: 'long', ttl: 60_000, limit: 5 },
		]),
		JwtModule.registerAsync({
			inject: [ConfigService],
			useFactory: async (configService: ConfigService) => ({
				secret: configService.getOrThrow<string>('ACCESS_TOKEN_SECRET'),
				signOptions: { expiresIn: '15m' },
			}),
		}),
	],
	controllers: [AuthController],
	providers: [
		AuthService,
		AuthGuard,
		PermissionGuard,
		SocketGuard,
		AuthorizationService,
		{
			provide: APP_GUARD,
			useClass: UserThrottlerGuard,
		},
	],
	exports: [AuthService, JwtModule, AuthGuard, PermissionGuard, SocketGuard, AuthorizationService],
})
export class AuthModule { }
