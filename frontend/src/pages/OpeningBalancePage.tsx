// ENTERPRISE FIX: Phase 3 Duplication Cleanup - Archive Only - 2026-03-26
// All legacy files archived in _ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React from 'react';
import OpeningBalanceView from './OpeningBalanceView';
import { useInventoryStore } from '../store/useInventoryStore';

const OpeningBalanceRoutePage: React.FC = () => {
  const columnConfig = useInventoryStore((state) => state.openingBalanceReportConfig);
  const setColumnConfig = useInventoryStore((state) => state.setOpeningBalanceReportConfig);

  return <OpeningBalanceView columnConfig={columnConfig} onUpdateColumnConfig={setColumnConfig} />;
};

export default OpeningBalanceRoutePage;