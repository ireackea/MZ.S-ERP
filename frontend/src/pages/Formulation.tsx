// ENTERPRISE FIX: Phase 3 Duplication Cleanup - Archive Only - 2026-03-26
// All legacy files archived in _ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
// ENTERPRISE FIX: Phase 6.3 - Final Surgical Fix & Complete Compliance - 2026-03-13
// Audit Logs moved to Prisma | JWT Cookie-only | Lazy Loading | No JSON fallback
import React, { useEffect } from 'react';
import { toast } from '@services/toastService';
import FormulationView from './FormulationView';
import { useInventoryStore } from '../store/useInventoryStore';
import type { Formula } from '../types';

const FormulationPage: React.FC = () => {
  const formulas = useInventoryStore((state) => state.formulas);
  const loadFormulas = useInventoryStore((state) => state.loadFormulas);
  const createFormula = useInventoryStore((state) => state.createFormula);
  const updateFormula = useInventoryStore((state) => state.updateFormula);
  const deleteFormula = useInventoryStore((state) => state.deleteFormula);

  useEffect(() => {
    const load = async () => {
      try {
        await loadFormulas();
      } catch (error: any) {
        toast.error(error?.response?.data?.message || error?.message || 'تعذر تحميل التركيبات.');
      }
    };

    void load();
  }, [loadFormulas]);

  const onAddFormula = async (formula: Formula) => {
    await createFormula(formula);
  };

  const onUpdateFormula = async (formula: Formula) => {
    await updateFormula(formula);
  };

  const onDeleteFormula = async (id: string) => {
    await deleteFormula(id);
  };

  return (
    <FormulationView
      formulas={formulas}
      onAddFormula={onAddFormula}
      onUpdateFormula={onUpdateFormula}
      onDeleteFormula={onDeleteFormula}
    />
  );
};

export default FormulationPage;
