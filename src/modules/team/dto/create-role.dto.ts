import { ArrayUnique, IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Permission } from 'src/database/enums';

export class CreateRoleDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(60)
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(300)
    description?: string;

    @IsArray()
    @ArrayUnique()
    @IsEnum(Permission, { each: true })
    permissions: Permission[];
}
