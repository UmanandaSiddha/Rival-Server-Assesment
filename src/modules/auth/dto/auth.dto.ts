import { IsEmail, IsNotEmpty, IsString } from "class-validator"

export class OtpDto {

    @IsString()
    @IsNotEmpty()
    otpString: string;

    @IsEmail()
    @IsNotEmpty()
    email: string;
}
