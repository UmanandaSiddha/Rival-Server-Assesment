import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateMemberRoleDto {
    @IsString()
    @IsNotEmpty()
    roleId: string;
}
