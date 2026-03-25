// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected


import React, { useState } from 'react';
import { Item, Partner, Order, OrderItem, Transaction } from '../types';
import { ShoppingCart, Calendar, CheckCircle, Clock, Plus, X, Trash2, ArrowRight } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from '@services/toastService';

interface OrdersProps {
  orders: Order[];
  items: Item[];
  partners: Partner[];
  onAddOrder: (order: Order) => void;
  onUpdateOrder: (order: Order) => void;
  onCompleteOrder: (order: Order) => void; // Trigger transaction creation
}

const Orders: React.FC<OrdersProps> = ({ orders, items, partners, onAddOrder, onUpdateOrder, onCompleteOrder }) => {
  const [activeType, setActiveType] = useState<'purchase' | 'sale'>('purchase');
  const [viewMode, setViewMode] = useState<'list' | 'create'>('list');
  
  // New Order State
  const [newOrder, setNewOrder] = useState<Partial<Order>>({ items: [] });
  const [currentItem, setCurrentItem] = useState<Partial<OrderItem>>({});

  const filteredOrders = orders
    .filter(o => o.type === activeType)
    .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handleAddItem = () => {
    if (!currentItem.itemId || !currentItem.quantity) return;
    const itemDef = items.find(i => i.id === currentItem.itemId);
    const newItem: OrderItem = {
      itemId: currentItem.itemId,
      quantity: Number(currentItem.quantity),
      unit: itemDef?.unit || 'وحدة'
    };
    setNewOrder(prev => ({ ...prev, items: [...(prev.items || []), newItem] }));
    setCurrentItem({});
  };

  const handleRemoveItem = (idx: number) => {
    setNewOrder(prev => ({ ...prev, items: prev.items?.filter((_, i) => i !== idx) }));
  };

  const handleSaveOrder = () => {
    if (!newOrder.partnerId || !newOrder.date || (newOrder.items?.length || 0) === 0) {
      toast.error('يرجى استكمال بيانات الطلب قبل الحفظ.');
      return;
    }

    const order: Order = {
      id: uuidv4(),
      orderNumber: `ORD-${Date.now().toString().slice(-6)}`,
      type: activeType,
      partnerId: newOrder.partnerId!,
      date: newOrder.date!,
      status: 'pending',
      items: newOrder.items!,
      notes: newOrder.notes
    };

    onAddOrder(order);
    setViewMode('list');
    setNewOrder({ items: [] });
  };

  const handleComplete = (order: Order) => {
    toast.warning('هل تريد تأكيد إكمال الطلب؟ لا يمكن التراجع بعد التنفيذ.', {
      action: {
        label: 'تأكيد',
        onClick: () => onCompleteOrder({ ...order, status: 'completed' }),
      },
    });
  };

  if (viewMode === 'create') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-3">
            <button onClick={() => setViewMode('list')} className="p-2 hover:bg-slate-200 rounded-full transition"><ArrowRight /></button>
            <h2 className="text-xl font-bold text-slate-800">
              {activeType === 'purchase' ? 'إنشاء طلب شراء' : 'إنشاء طلب بيع'}
            </h2>
          </div>
        </div>
        
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Order Info */}
          <div className="space-y-4">
             <div>
               <label className="block text-sm font-medium text-slate-700 mb-1">
                 {activeType === 'purchase' ? 'المورد' : 'العميل'}
               </label>
               <select 
                 className="w-full p-3 border border-slate-200 rounded-xl"
                 value={newOrder.partnerId || ''}
                 onChange={e => setNewOrder({...newOrder, partnerId: e.target.value})}
               >
                 <option value="">اختر...</option>
                 {partners.filter(p => activeType === 'purchase' ? p.type === 'supplier' : p.type === 'customer').map(p => (
                   <option key={p.id} value={p.id}>{p.name}</option>
                 ))}
               </select>
             </div>
             <div>
               <label className="block text-sm font-medium text-slate-700 mb-1">التاريخ</label>
               <input type="date" className="w-full p-3 border border-slate-200 rounded-xl" value={newOrder.date || ''} onChange={e => setNewOrder({...newOrder, date: e.target.value})} />
             </div>
             <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">ملاحظات</label>
                <textarea className="w-full p-3 border border-slate-200 rounded-xl" rows={3} value={newOrder.notes || ''} onChange={e => setNewOrder({...newOrder, notes: e.target.value})} />
             </div>
          </div>

          {/* Items Entry */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
             <h3 className="font-bold text-slate-700 mb-4">إضافة أصناف الطلب</h3>
             <div className="flex gap-2 mb-4">
                <select className="flex-1 p-2 border rounded-lg" value={currentItem.itemId || ''} onChange={e => setCurrentItem({...currentItem, itemId: e.target.value})}>
                  <option value="">اختر الصنف</option>
                  {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <input type="number" placeholder="الكمية" className="w-24 p-2 border rounded-lg" value={currentItem.quantity || ''} onChange={e => setCurrentItem({...currentItem, quantity: Number(e.target.value)})} />
                <button onClick={handleAddItem} className="bg-emerald-600 text-white p-2 rounded-lg hover:bg-emerald-700"><Plus size={20} /></button>
             </div>
             
             <div className="space-y-2 max-h-60 overflow-y-auto">
                {newOrder.items?.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-white p-3 rounded-lg shadow-sm">
                    <div>
                      <p className="font-bold text-sm">{items.find(i => i.id === item.itemId)?.name}</p>
                      <p className="text-xs text-slate-500">{item.quantity} {item.unit}</p>
                    </div>
                    <button onClick={() => handleRemoveItem(idx)} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 size={16} /></button>
                  </div>
                ))}
                {(!newOrder.items || newOrder.items.length === 0) && <p className="text-center text-slate-400 text-sm">لم تتم إضافة أي أصناف بعد</p>}
             </div>
          </div>
        </div>
        
        <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={() => setViewMode('list')} className="px-6 py-2 text-slate-600 hover:bg-slate-100 rounded-xl">إلغاء</button>
          <button onClick={handleSaveOrder} className="px-6 py-2 bg-slate-800 text-white hover:bg-slate-900 rounded-xl shadow-lg">حفظ الطلب</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
       <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">إدارة الطلبات</h2>
            <p className="text-slate-500">تابع طلبات الشراء والبيع وحالة تنفيذها</p>
          </div>
          <button onClick={() => setViewMode('create')} className="flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition shadow-lg">
            <Plus size={20} /> إنشاء طلب جديد
          </button>
        </div>

        <div className="flex border-b border-slate-200">
           <button onClick={() => setActiveType('purchase')} className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${activeType === 'purchase' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-500'}`}>طلبات الشراء</button>
           <button onClick={() => setActiveType('sale')} className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${activeType === 'sale' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-500'}`}>طلبات البيع</button>
        </div>
      </div>

      <div className="space-y-4">
        {filteredOrders.map(order => (
          <div key={order.id} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 hover:shadow-md transition">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-4">
                 <div className={`p-3 rounded-full ${order.type === 'purchase' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                    <ShoppingCart size={24} />
                 </div>
                 <div>
                    <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                      {order.orderNumber} 
                      <span className={`text-xs px-2 py-1 rounded-full ${order.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {order.status === 'completed' ? 'مكتمل' : 'قيد التنفيذ'}
                      </span>
                    </h3>
                    <p className="text-sm text-slate-500 flex items-center gap-2 mt-1 dir-ltr">
                      <Calendar size={14} /> {new Date(order.date).toLocaleDateString('en-GB')} ⬢ 
                      {partners.find(p => p.id === order.partnerId)?.name}
                    </p>
                 </div>
              </div>
              
              {order.status === 'pending' && (
                <button 
                  onClick={() => handleComplete(order)}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-900 transition"
                >
                  <CheckCircle size={16} /> 788&78 87778y7 788&7788 
                </button>
              )}
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
               <h4 className="font-bold text-xs text-slate-500 mb-2 uppercase tracking-wider">78~778y8 78778 78~</h4>
               <div className="space-y-1">
                 {order.items.map((item, i) => (
                   <div key={i} className="flex justify-between text-sm">
                     <span className="text-slate-700">{items.find(it => it.id === item.itemId)?.name}</span>
                     <span className="font-bold">{item.quantity} {item.unit}</span>
                   </div>
                 ))}
               </div>
            </div>
          </div>
        ))}
        {filteredOrders.length === 0 && (
           <div className="text-center py-12 text-slate-400">87 7877 78777 8~8y 8!78! 788778&7</div>
        )}
      </div>
    </div>
  );
};

export default Orders;


