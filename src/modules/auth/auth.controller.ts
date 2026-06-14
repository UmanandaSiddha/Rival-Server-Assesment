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
import {
	OtpDto,
	SignUpDto,
	LoginDto
} from './dto';
import { AuthGuard, getUser } from './guards/auth.guard';
import { AllowUnverified } from './decorator/allow-unverified.decorator';
import { Request } from 'express';
import { RequestDto } from './dto/request.dto';

@Controller('auth')
export class AuthController {
	constructor(private readonly authService: AuthService) { }

	// REQUEST-OTP
	@Throttle({ otp: { limit: 5, ttl: 300_000 } })
	@Post('request-otp')
	requestOtp(@Body() dto: RequestDto) {
		return this.authService.requestOtp(dto);
	}

	// SIGN-UP
	@Throttle({ auth: { limit: 5, ttl: 60_000 } })
	@Post('sign-up')
	signUp(@Body() dto: SignUpDto, @Res({ passthrough: true }) res: Response) {
		return this.authService.signUp(dto, res);
	}

	// REFRESH-TOKEN
	@Get('refresh-token')
	refreshToken(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
		return this.authService.refreshToken(req, res);
	}

	// VERIFY-OTP — OTP brute-force prevention. 5/300s gives <1-in-200k success
	// probability against a 6-digit OTP, well below the resend/expiry window.
	@Throttle({ otp: { limit: 5, ttl: 300_000 } })
	@Post('verify-otp')
	verifyOtp(@Body() dto: OtpDto, @Res({ passthrough: true }) res: Response) {
		return this.authService.verifyOtp(dto, res);
	}

	// SIGN-IN — credential stuffing prevention. 5/60s.
	@Throttle({ auth: { limit: 5, ttl: 60_000 } })
	@Post('sign-in')
	signIn(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
		return this.authService.signIn(dto, res);
	}

	// LOGOUT
	@UseGuards(AuthGuard)
	@AllowUnverified()
	@Put('logout')
	async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @getUser('id') userId: string) {
		return this.authService.logout(req, res, userId);
	}
}

