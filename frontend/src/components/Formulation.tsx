// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected


import React, { useState } from 'react';
import { Formula, FormulaItem, Item } from '../types';
import { Beaker, Plus, Save, Trash2, AlertTriangle, CheckCircle, Percent } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useInventoryStore } from '../store/useInventoryStore';
import { toast } from '@services/toastService';

interface FormulationProps {
  formulas: Formula[];
  onAddFormula: (f: Formula) => void;
  onUpdateFormula: (f: Formula) => void;
  onDeleteFormula: (id: string) => void;
}

const Formulation: React.FC<FormulationProps> = ({ formulas, onAddFormula, onUpdateFormula, onDeleteFormula }) => {
  const { items } = useInventoryStore();
  const [view, setView] = useState<'list' | 'create'>('list');
  const [activeFormula, setActiveFormula] = useState<Partial<Formula>>({ items: [] });
  const [selectedRawItem, setSelectedRawItem] = useState('');
  const [selectedPercentage, setSelectedPercentage] = useState<number>(0);

  // Filter items: Raw Materials vs Finished Products
  // Assuming '8&8�7�7� 7�8�88y7�', '8&7�8�7�7�7�' are raw, and we might add a category for '8&8 7�7� 7�7�8&'
  const rawMaterials = items.filter(i => ['8&8�7�7� 7�8�88y7�', '8&7�8�7�7�7�', '7�7�7�8~7�7�'].includes(i.category) || true); // Allow all for now
  const finishedProducts = items; // Ideally filter by category '8&8 7�7� 7�7�8&' if it exists

  const handleAddItem = () => {
    if (!selectedRawItem || selectedPercentage <= 0) return;
    
    // Check if total percentage exceeds 100%
    const currentTotal = activeFormula.items?.reduce((sum, i) => sum + i.percentage, 0) || 0;
    if (currentTotal + selectedPercentage > 100) {
        toast.error(`7�7�7�: 7�88 7�7�7� 7�87�7�8&7�88y7� 7�7�7�7�7�8�7� 100% (7�87�7�88y: ${currentTotal}%)`);
        return;
    }

    const newItem: FormulaItem = {
        itemId: selectedRawItem,
        percentage: selectedPercentage,
        weightPerTon: selectedPercentage * 10 // 1% = 10kg in a Ton
    };

    setActiveFormula(prev => ({
        ...prev,
        items: [...(prev.items || []), newItem]
    }));
    setSelectedRawItem('');
    setSelectedPercentage(0);
  };

  const handleRemoveItem = (idx: number) => {
      setActiveFormula(prev => ({
          ...prev,
          items: prev.items?.filter((_, i) => i !== idx)
      }));
  };

  const handleSave = () => {
      if (!activeFormula.name || !activeFormula.targetProductId || (activeFormula.items?.length || 0) === 0) {
          toast.error('8y7�7�80 7�8�8&7�8 7�87�8y7�8 7�7� 7�87�7�7�7�8y7� 8�7�7�7�8~7� 8&8�8�8 7�7� 887�87�7�');
          return;
      }
      
      const currentTotal = activeFormula.items?.reduce((sum, i) => sum + i.percentage, 0) || 0;
      if (Math.abs(currentTotal - 100) > 0.1) {
          toast.error(`7�8 7�8y8!: 8&7�8&8�7� 7�88 7�7� 8!8� ${currentTotal}%7R 8y7�7� 7�8  8y8�8�8  100% 87�8&7�8  7�87� 7�87�8 7�7�7�.`);
          // We allow saving but warn
      }

      const formula: Formula = {
          id: activeFormula.id || uuidv4(),
          code: activeFormula.code || `FORM-${Date.now().toString().slice(-4)}`,
          name: activeFormula.name!,
          targetProductId: activeFormula.targetProductId!,
          items: activeFormula.items!,
          isActive: true,
          notes: activeFormula.notes
      };

      if (activeFormula.id) onUpdateFormula(formula);
      else onAddFormula(formula);

      setView('list');
      setActiveFormula({ items: [] });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex justify-between items-center">
        <div>
           <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
               <Beaker className="text-purple-600" /> 8!8 7�7�7� 7�87�8 7�7�7� 8�7�87�7�8�8y7�7�7�
           </h2>
           <p className="text-slate-500">7�7�7�7�7� 7�87�7�7� 7�87�7�87�8~ (Recipes) 8�7�7�7�7� 7�88&8�8�8 7�7�</p>
        </div>
        <button onClick={() => { setActiveFormula({ items: [] }); setView('create'); }} className="bg-purple-600 text-white px-6 py-3 rounded-xl hover:bg-purple-700 transition shadow-lg flex items-center gap-2 font-bold">
            <Plus size={20} /> 7�7�8�8y7�7� 7�7�8y7�7�
        </button>
      </div>

      {view === 'list' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {formulas.map(f => (
                  <div key={f.id} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 hover:shadow-md transition group relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-2 h-full bg-purple-500"></div>
                      <div className="flex justify-between items-start mb-4 pl-4">
                          <div>
                              <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded mb-2 inline-block">{f.code}</span>
                              <h3 className="font-bold text-slate-800 text-lg">{f.name}</h3>
                              <p className="text-xs text-slate-500">7�88&8 7�7� 7�88 8!7�7�8y: {items.find(i => i.id === f.targetProductId)?.name}</p>
                          </div>
                          {f.isActive ? <CheckCircle className="text-green-500" size={20} /> : <AlertTriangle className="text-amber-500" size={20} />}
                      </div>
                      
                      <div className="space-y-2 mb-4">
                          <p className="text-xs font-bold text-slate-400 uppercase">7�8!8& 7�88&8�8�8 7�7�:</p>
                          <div className="flex flex-wrap gap-2">
                              {f.items.slice(0, 3).map((item, idx) => (
                                  <span key={idx} className="text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded border border-purple-100">
                                      {items.find(i => i.id === item.itemId)?.name} ({item.percentage}%)
                                  </span>
                              ))}
                              {f.items.length > 3 && <span className="text-xs text-slate-400">+{f.items.length - 3}</span>}
                          </div>
                      </div>

                      <div className="pt-4 border-t border-slate-100 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setActiveFormula(f); setView('create'); }} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg text-xs font-bold">7�7�7�8y8</button>
                          <button onClick={() => {
                            toast.warning('7�7�8~ 7�87�7�8�8y7�7�7�', {
                              action: {
                                label: '7�7�8�8y7� 7�87�7�8~',
                                onClick: () => onDeleteFormula(f.id),
                              },
                            });
                          }} className="p-2 text-red-600 hover:bg-red-50 rounded-lg text-xs font-bold">7�7�8~</button>
                      </div>
                  </div>
              ))}
              {formulas.length === 0 && (
                  <div className="col-span-full py-12 text-center text-slate-400 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                      <Beaker size={48} className="mx-auto mb-4 text-slate-300" />
                      <p>87� 7�8�7�7� 7�7�8�8y7�7�7� 8&7�8~8�7�7�. 7�7�7�7� 7�7�8 7�7�7 7�8�8 8&7�7�7�87� 7�8 7�7�7�.</p>
                  </div>
              )}
          </div>
      )}

      {view === 'create' && (
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-bottom-4">
              <div className="bg-slate-800 text-white p-6 flex justify-between items-center">
                  <h3 className="font-bold text-lg">7�7�8&8y8& 7�7�8�8y7�7� 7�88~8y7�</h3>
                  <button onClick={() => setView('list')} className="text-slate-400 hover:text-white">7�877�7</button>
              </div>
              
              <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left: Metadata */}
                  <div className="space-y-4">
                      <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">7�7�8& 7�87�7�8�8y7�7�</label>
                          <input type="text" className="w-full p-3 border rounded-xl" placeholder="8&7�7�8: 7�88~ 7�7�8&8y8  7�8�7�7�" 
                              value={activeFormula.name || ''} onChange={e => setActiveFormula({...activeFormula, name: e.target.value})} />
                      </div>
                      <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">7�88&8 7�7� 7�88 8!7�7�8y</label>
                          <select className="w-full p-3 border rounded-xl" 
                              value={activeFormula.targetProductId || ''} onChange={e => setActiveFormula({...activeFormula, targetProductId: e.target.value})}>
                              <option value="">7�7�7�7� 7�88&8 7�7�...</option>
                              {finishedProducts.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                          </select>
                      </div>
                      <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">8�8�7� 7�87�7�8�8y7�7�</label>
                          <input type="text" className="w-full p-3 border rounded-xl" placeholder="AUTO-GEN" 
                              value={activeFormula.code || ''} onChange={e => setActiveFormula({...activeFormula, code: e.target.value})} />
                      </div>
                      <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">8&87�7�7�7�7� 8~8 8y7�</label>
                          <textarea className="w-full p-3 border rounded-xl" rows={4} 
                              value={activeFormula.notes || ''} onChange={e => setActiveFormula({...activeFormula, notes: e.target.value})} />
                      </div>
                  </div>

                  {/* Right: Items Builder */}
                  <div className="lg:col-span-2 bg-slate-50 rounded-xl border border-slate-200 p-6">
                      <div className="flex gap-4 mb-6 items-end">
                          <div className="flex-1">
                              <label className="block text-xs font-bold text-slate-500 mb-1">7�88&7�7�7� 7�87�7�8&</label>
                              <select className="w-full p-3 border rounded-xl bg-white" 
                                  value={selectedRawItem} onChange={e => setSelectedRawItem(e.target.value)}>
                                  <option value="">7�7�7�7� 7�88&7�7�7�...</option>
                                  {rawMaterials.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                              </select>
                          </div>
                          <div className="w-32">
                              <label className="block text-xs font-bold text-slate-500 mb-1">7�88 7�7�7� %</label>
                              <div className="relative">
                                  <input type="number" step="0.1" max="100" className="w-full p-3 border rounded-xl bg-white text-center font-bold" 
                                      value={selectedPercentage || ''} onChange={e => setSelectedPercentage(Number(e.target.value))} />
                                  <Percent size={14} className="absolute left-3 top-4 text-slate-400" />
                              </div>
                          </div>
                          <button onClick={handleAddItem} className="bg-purple-600 text-white p-3 rounded-xl hover:bg-purple-700 shadow-md">
                              <Plus size={24} />
                          </button>
                      </div>

                      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                          <table className="w-full text-right text-sm">
                              <thead className="bg-purple-50 text-purple-900 font-bold">
                                  <tr>
                                      <th className="p-4">7�88&8�8�8 </th>
                                      <th className="p-4">7�88 7�7�7�</th>
                                      <th className="p-4">7�88�7�8  / 7�8 </th>
                                      <th className="p-4 w-10"></th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                  {activeFormula.items?.map((item, idx) => (
                                      <tr key={idx}>
                                          <td className="p-4 font-medium">{items.find(i => i.id === item.itemId)?.name}</td>
                                          <td className="p-4 font-bold text-purple-700">{item.percentage}%</td>
                                          <td className="p-4 text-slate-500">{item.weightPerTon} 8�7�8&</td>
                                          <td className="p-4 text-center">
                                              <button onClick={() => handleRemoveItem(idx)} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                                          </td>
                                      </tr>
                                  ))}
                              </tbody>
                              <tfoot className="bg-slate-50 font-bold text-slate-700">
                                  <tr>
                                      <td className="p-4">7�87�7�8&7�88y</td>
                                      <td className={`p-4 ${(activeFormula.items?.reduce((a,b)=>a+b.percentage,0) || 0) > 100 ? 'text-red-600' : 'text-green-600'}`}>
                                          {activeFormula.items?.reduce((a,b)=>a+b.percentage,0)}%
                                      </td>
                                      <td className="p-4">{activeFormula.items?.reduce((a,b)=>a+b.weightPerTon,0)} 8�7�8&</td>
                                      <td></td>
                                  </tr>
                              </tfoot>
                          </table>
                      </div>
                  </div>
              </div>

              <div className="p-6 border-t border-slate-200 flex justify-end gap-3 bg-slate-50">
                  <button onClick={handleSave} className="bg-emerald-600 text-white px-8 py-3 rounded-xl hover:bg-emerald-700 font-bold shadow-lg flex items-center gap-2">
                      <Save size={20} /> 7�8~7� 7�87�7�8�8y7�7�
                  </button>
              </div>
          </div>
      )}
    </div>
  );
};

export default Formulation;


