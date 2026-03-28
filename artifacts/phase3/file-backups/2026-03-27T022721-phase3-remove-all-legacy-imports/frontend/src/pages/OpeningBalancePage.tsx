// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React from 'react';
import OpeningBalanceView from '../components/OpeningBalancePage';
import { useInventoryStore } from '../store/useInventoryStore';

const OpeningBalanceRoutePage: React.FC = () => {
  const columnConfig = useInventoryStore((state) => state.openingBalanceReportConfig);
  const setColumnConfig = useInventoryStore((state) => state.setOpeningBalanceReportConfig);

  return <OpeningBalanceView columnConfig={columnConfig} onUpdateColumnConfig={setColumnConfig} />;
};

export default OpeningBalanceRoutePage;