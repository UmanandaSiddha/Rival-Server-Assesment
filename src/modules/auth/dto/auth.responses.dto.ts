export class AuthUserResponseDto {
	id: string;
	email: string;
	firstName: string;
	lastName: string;
	isVerified: boolean;
	role: string;
}

export class AuthTokenOnlyResponseDto {
	message: string;
	accessToken: string;
}

export class AuthSessionResponseDto {
	message: string;
	data: AuthUserResponseDto;
	accessToken: string;
	clientRefreshToken: string;
}

export class AuthMessageResponseDto {
	message: string;
	success: boolean;
}

export class LogoutResponseDto {
	success: boolean;
	message: string;
}
