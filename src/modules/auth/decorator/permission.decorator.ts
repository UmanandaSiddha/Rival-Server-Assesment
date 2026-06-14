import { SetMetadata } from '@nestjs/common';
import { Permission } from 'src/database/enums';

export const PERMISSION_KEY = 'requiredPermission';

export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);
