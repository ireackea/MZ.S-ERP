import { SetMetadata } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../auth.constants';

export const Roles = (...roles: string[]) => SetMetadata(ROLES_METADATA_KEY, roles);
