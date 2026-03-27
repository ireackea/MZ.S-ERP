// ENTERPRISE FIX: Phase 3 Duplication Cleanup - Archive Only - 2026-03-26
// All legacy files archived in _ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/
// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import React from 'react';
import BackupCenterView from '../components/BackupCenter';
import type { User } from '../types';

interface BackupCenterPageProps {
  currentUser?: User;
}

const BackupCenterPage: React.FC<BackupCenterPageProps> = ({ currentUser }) => {
  return <BackupCenterView currentUser={currentUser} />;
};

export default BackupCenterPage;
