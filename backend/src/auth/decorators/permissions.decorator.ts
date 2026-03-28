// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
import { SetMetadata } from '@nestjs/common';
import { PERMISSIONS_METADATA_KEY } from '../auth.constants';

export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_METADATA_KEY, permissions);
