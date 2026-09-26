import { SetMetadata } from '@nestjs/common';
import { ALLOW_AUTHENTICATED_METADATA_KEY } from '../auth.constants';

export const AllowAuthenticated = () => SetMetadata(ALLOW_AUTHENTICATED_METADATA_KEY, true);
