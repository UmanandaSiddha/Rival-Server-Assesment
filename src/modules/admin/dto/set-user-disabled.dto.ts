import { IsBoolean } from 'class-validator';

export class SetUserDisabledDto {
    @IsBoolean()
    disabled: boolean;
}
