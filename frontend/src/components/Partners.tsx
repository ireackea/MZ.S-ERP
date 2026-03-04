// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27

import React, { useState } from 'react';
import { Partner, PartnerType, Transaction, Order } from '../types';
import { Users, UserPlus, Phone, MapPin, Search, Edit2, Trash2, Save, X, AlertTriangle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from '@services/toastService';

interface PartnersProps {
  partners: Partner[];
  onAddPartner: (partner: Partner) => void;
  onUpdatePartner: (partner: Partner) => void;
  onDeletePartner: (id: string) => void;
  transactions?: Transaction[];
  orders?: Order[];
}

const Partners: React.FC<PartnersProps> = ({ partners, onAddPartner, onUpdatePartner, onDeletePartner, transactions = [], orders = [] }) => {
  const [activeTab, setActiveTab] = useState<PartnerType>('supplier');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState<Partial<Partner>>({});

  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    partnerId: string;
    partnerName: string;
    usageCount: number;
  }>({ isOpen: false, partnerId: '', partnerName: '', usageCount: 0 });

  const filteredPartners = partners.filter(p =>
    p.type === activeTab &&
    (p.name.includes(searchTerm) || p.phone.includes(searchTerm))
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone) {
      toast.error('8y7�7�80 8&87 7�8&8y7� 7�87�88�8 7�88&7�88�7�7�');
      return;
    }

    if (formData.id) {
      onUpdatePartner(formData as Partner);
    } else {
      onAddPartner({
        ...formData,
        id: uuidv4(),
        type: activeTab,
        createdAt: new Date().toISOString(),
      } as Partner);
    }

    handleCloseModal();
  };

  const handleOpenModal = (partner?: Partner) => {
    if (partner) {
      setFormData({ ...partner });
    } else {
      setFormData({ type: activeTab });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setFormData({});
  };

  const handleDeleteClick = (partner: Partner) => {
    const usageCount = [
      ...(transactions?.filter(t => t.supplierOrReceiver === partner.name) || []),
      ...(orders?.filter(o => o.partnerId === partner.id) || []),
    ].length;

    setDeleteModal({
      isOpen: true,
      partnerId: partner.id,
      partnerName: partner.name,
      usageCount,
    });
  };

  const confirmDelete = () => {
    if (deleteModal.partnerId) {
      onDeletePartner(deleteModal.partnerId);
      toast.success('7�8& 7�7�8~ 7�87�7�8y8� 7�8 7�7�7�');
    }
    setDeleteModal({ isOpen: false, partnerId: '', partnerName: '', usageCount: 0 });
  };

  return (
    <div className="p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">7�87�8&87�7 8�7�88&8�7�7�8y8 </h2>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition"
        >
          <UserPlus className="w-5 h-5" />
          7�7�7�8~7� 7�7�8y8�
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setActiveTab('supplier')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'supplier'
              ? 'text-emerald-600 border-b-2 border-emerald-600'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          7�88&8�7�7�8�8 
        </button>
        <button
          onClick={() => setActiveTab('customer')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'customer'
              ? 'text-emerald-600 border-b-2 border-emerald-600'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          7�87�8&87�7
        </button>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="7�7�7� 7�7�87�7�8& 7�8� 7�88!7�7�8~..."
            className="w-full md:w-96 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2 pr-10 pl-4 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="text-right py-3 px-4 text-sm font-medium text-slate-500 dark:text-slate-400">#</th>
              <th className="text-right py-3 px-4 text-sm font-medium text-slate-500 dark:text-slate-400">7�87�7�8&</th>
              <th className="text-right py-3 px-4 text-sm font-medium text-slate-500 dark:text-slate-400">7�88!7�7�8~</th>
              <th className="text-right py-3 px-4 text-sm font-medium text-slate-500 dark:text-slate-400">7�87�8 8�7�8 </th>
              <th className="text-right py-3 px-4 text-sm font-medium text-slate-500 dark:text-slate-400">7�88 8�7�</th>
              <th className="text-right py-3 px-4 text-sm font-medium text-slate-500 dark:text-slate-400">7�7�7�7�77�7�</th>
            </tr>
          </thead>
          <tbody>
            {filteredPartners.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-slate-500 dark:text-slate-400">
                  87� 8y8�7�7� 7�7�8�7�7 87�7�7�8!8&
                </td>
              </tr>
            ) : (
              filteredPartners.map((partner, index) => (
                <tr key={partner.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-3 px-4 text-sm text-slate-900 dark:text-white">{index + 1}</td>
                  <td className="py-3 px-4 text-sm text-slate-900 dark:text-white">{partner.name}</td>
                  <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-300">{partner.phone}</td>
                  <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-300">{partner.address || '-'}</td>
                  <td className="py-3 px-4 text-sm">
                    <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                      partner.type === 'supplier'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    }`}>
                      {partner.type === 'supplier' ? '8&8�7�7�' : '7�8&8y8'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleOpenModal(partner)}
                        className="p-1 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded transition"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(partner)}
                        className="p-1 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                {formData.id ? '7�7�7�8y8 7�7�8y8�' : '7�7�7�8~7� 7�7�8y8� 7�7�8y7�'}
              </h3>
              <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  7�87�7�8& *
                </label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  7�88!7�7�8~ *
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input
                    type="tel"
                    value={formData.phone || ''}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2 pr-10 pl-4 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  7�87�8 8�7�8 
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input
                    type="text"
                    value={formData.address || ''}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2 pr-10 pl-4 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 py-2 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                >
                  7�877�7
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition"
                >
                  <Save className="w-4 h-4 inline ml-2" />
                  7�8~7�
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">7�7�8�8y7� 7�87�7�8~</h3>
            </div>

            <p className="text-slate-600 dark:text-slate-300 mb-4">
              8!8 7�8 7� 8&7�7�8�7� 8&8  7�7�8~ "<span className="font-bold">{deleteModal.partnerName}</span>"7�
            </p>

            {deleteModal.usageCount > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-xl p-3 mb-4">
                <p className="text-amber-800 dark:text-amber-200 text-sm">
                  ①︈ 8!7�7� 7�87�7�8y8� 8&7�7�7�7� 7�8� {deleteModal.usageCount} 7�7�8�7�/7�87�
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setDeleteModal({ ...deleteModal, isOpen: false })}
                className="flex-1 py-2 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                7�877�7
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition"
              >
                <Trash2 className="w-4 h-4 inline ml-2" />
                7�7�8~
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Partners;

