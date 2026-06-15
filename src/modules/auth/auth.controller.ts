import { Response } from 'express';
import {
    Body,
    Controller,
    Get,
    Post,
    Put,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { OtpDto, SignUpDto, LoginDto } from './dto';
import { AuthGuard, getUser } from './guards/auth.guard';
import { AllowUnverified } from './decorator/allow-unverified.decorator';
import { Request } from 'express';
import { RequestDto } from './dto/request.dto';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Throttle({ otp: { limit: 5, ttl: 300_000 } })
    @Post('request-otp')
    requestOtp(@Body() dto: RequestDto) {
        return this.authService.requestOtp(dto);
    }

    @Throttle({ auth: { limit: 5, ttl: 60_000 } })
    @Post('sign-up')
    signUp(@Body() dto: SignUpDto, @Res({ passthrough: true }) res: Response) {
        return this.authService.signUp(dto, res);
    }

    @Get('refresh-token')
    refreshToken(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        return this.authService.refreshToken(req, res);
    }

    // Allowed while unverified so the client can rehydrate and show the verify-account state.
    @UseGuards(AuthGuard)
    @AllowUnverified()
    @Get('me')
    me(@getUser('id') userId: string) {
        return this.authService.me(userId);
    }

    // OTP brute-force prevention: 5/300s keeps success <1-in-200k against a 6-digit OTP.
    @Throttle({ otp: { limit: 5, ttl: 300_000 } })
    @Post('verify-otp')
    verifyOtp(@Body() dto: OtpDto, @Res({ passthrough: true }) res: Response) {
        return this.authService.verifyOtp(dto, res);
    }

    // Credential-stuffing prevention: 5/60s.
    @Throttle({ auth: { limit: 5, ttl: 60_000 } })
    @Post('sign-in')
    signIn(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
        return this.authService.signIn(dto, res);
    }

    @UseGuards(AuthGuard)
    @AllowUnverified()
    @Put('logout')
    async logout(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
        @getUser('id') userId: string,
    ) {
        return this.authService.logout(req, res, userId);
    }
}
