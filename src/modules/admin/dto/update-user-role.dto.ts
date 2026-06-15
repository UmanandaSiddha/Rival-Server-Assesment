import { IsEnum } from 'class-validator';
import { UserRole } from 'src/database/enums';

export class UpdateUserRoleDto {
    @IsEnum(UserRole)
    role: UserRole;
}
