import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthGuard } from './guards/auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { DatabaseModule } from 'src/services/database/database.module';
import { RedisModule } from 'src/services/redis/redis.module';
import { AuthorizationService } from './authorization.service';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { UserThrottlerGuard } from './guards/user-throttler.guard';

@Module({
    imports: [
        ConfigModule,
        DatabaseModule,
        RedisModule,
        // A single generous default applied to every route (per user/IP). Sensitive auth routes
        // tighten this via @Throttle({ default: ... }) — see AuthController. Named throttlers all
        // apply globally, so we keep just one here and override it where stricter limits are needed.
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
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
        AuthorizationService,
        {
            provide: APP_GUARD,
            useClass: UserThrottlerGuard,
        },
    ],
    exports: [
        AuthService,
        JwtModule,
        AuthGuard,
        PermissionGuard,
        AuthorizationService,
    ],
})
export class AuthModule {}
