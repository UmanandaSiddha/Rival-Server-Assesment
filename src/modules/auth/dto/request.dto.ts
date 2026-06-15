import { IsEmail, IsNotEmpty } from 'class-validator';

export class RequestDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;
}
