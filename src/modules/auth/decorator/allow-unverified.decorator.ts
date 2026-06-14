import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_KEY = 'allowUnverified';

export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED_KEY, true);
