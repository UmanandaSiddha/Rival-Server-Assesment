import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateTeamDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name: string;
}
