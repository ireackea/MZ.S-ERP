// ENTERPRISE FIX: Phase 6.3 - Final Surgical Fix & Complete Compliance - 2026-03-13
// Audit Logs moved to Prisma | JWT Cookie-only | Lazy Loading | No JSON fallback
import React, { useEffect, useState } from 'react';
import apiClient from '@api/client';
import { toast } from '@services/toastService';
import FormulationView from '../components/Formulation';
import type { Formula } from '../types';

const normalizeFormula = (raw: any): Formula => ({
  id: String(raw?.id || crypto.randomUUID()),
  code: String(raw?.code || ''),
  name: String(raw?.name || ''),
  targetProductId: String(raw?.targetProductId || raw?.targetItemId || ''),
  isActive: raw?.isActive !== false,
  notes: raw?.notes ? String(raw.notes) : undefined,
  items: Array.isArray(raw?.items)
    ? raw.items.map((entry: any) => ({
        itemId: String(entry?.itemId || ''),
        percentage: Number(entry?.percentage || 0),
        weightPerTon: Number(entry?.weightPerTon || 0),
      }))
    : [],
});

const toPayload = (formula: Formula) => ({
  id: formula.id,
  code: formula.code,
  name: formula.name,
  targetProductId: formula.targetProductId,
  targetItemId: formula.targetProductId,
  isActive: formula.isActive,
  notes: formula.notes || '',
  items: formula.items.map((entry) => ({
    itemId: entry.itemId,
    percentage: Number(entry.percentage || 0),
    weightPerTon: Number(entry.weightPerTon || 0),
  })),
});

const FormulationPage: React.FC = () => {
  const [formulas, setFormulas] = useState<Formula[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await apiClient.get('/formulations');
        const rows = Array.isArray(response.data)
          ? response.data
          : Array.isArray(response.data?.data)
            ? response.data.data
            : [];
        if (!active) return;
        setFormulas(rows.map(normalizeFormula));
      } catch (error: any) {
        toast.error(error?.response?.data?.message || error?.message || 'تعذر تحميل التركيبات.');
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const onAddFormula = async (formula: Formula) => {
    const response = await apiClient.post('/formulations', toPayload(formula));
    const saved = normalizeFormula(response.data);
    setFormulas((current) => [saved, ...current]);
  };

  const onUpdateFormula = async (formula: Formula) => {
    const response = await apiClient.put(`/formulations/${encodeURIComponent(String(formula.id))}`, toPayload(formula));
    const saved = normalizeFormula(response.data);
    setFormulas((current) => current.map((entry) => (String(entry.id) === String(saved.id) ? saved : entry)));
  };

  const onDeleteFormula = async (id: string) => {
    await apiClient.post('/formulations/delete', { ids: [id] });
    setFormulas((current) => current.filter((entry) => String(entry.id) !== String(id)));
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
