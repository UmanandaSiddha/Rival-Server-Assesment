import {
    ArrayUnique,
    IsArray,
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
} from 'class-validator';
import { Permission } from 'src/database/enums';

export class UpdateRoleDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(60)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(300)
    description?: string;

    @IsOptional()
    @IsArray()
    @ArrayUnique()
    @IsEnum(Permission, { each: true })
    permissions?: Permission[];
}
