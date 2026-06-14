import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateInviteDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    roleId: string;
}
