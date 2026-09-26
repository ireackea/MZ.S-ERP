import apiClient from '../api/client';
import type { Order } from '../types';

const unwrap = <T>(payload: any): T => (payload?.data ?? payload) as T;

const toCreatePayload = (order: Partial<Order>) => ({
  orderNumber: order.orderNumber,
  type: order.type,
  status: order.status,
  partnerId: order.partnerId,
  date: order.date,
  warehouseId: order.warehouseId,
  notes: order.notes,
  totalAmount: order.totalAmount,
  items: order.items,
});

const toUpdatePayload = (order: Partial<Order>) => ({
  orderNumber: order.orderNumber,
  type: order.type,
  status: order.status,
  partnerId: order.partnerId,
  date: order.date,
  warehouseId: order.warehouseId,
  notes: order.notes,
  totalAmount: order.totalAmount,
  items: order.items,
});

export const ordersApi = {
  async list(warehouseId?: string): Promise<Order[]> {
    const response = await apiClient.get('/orders', { params: warehouseId ? { warehouseId } : undefined });
    return unwrap<Order[]>(response.data) || [];
  },
  async create(order: Omit<Order, 'id'>, idempotencyKey = `order-create-${crypto.randomUUID()}`): Promise<Order> {
    const response = await apiClient.post('/orders', toCreatePayload(order), { headers: { 'Idempotency-Key': idempotencyKey } });
    return unwrap<Order>(response.data);
  },
  async update(id: string, order: Partial<Omit<Order, 'id'>>): Promise<Order> {
    const response = await apiClient.put(`/orders/${encodeURIComponent(id)}`, toUpdatePayload(order), { headers: { 'Idempotency-Key': `order-update-${crypto.randomUUID()}` } });
    return unwrap<Order>(response.data);
  },
  async complete(id: string, warehouseId?: string): Promise<Order> {
    const response = await apiClient.post(`/orders/${encodeURIComponent(id)}/complete`, { warehouseId }, { headers: { 'Idempotency-Key': `order-complete-${crypto.randomUUID()}` } });
    return unwrap<Order>(response.data);
  },
  async remove(id: string): Promise<void> {
    await apiClient.delete(`/orders/${encodeURIComponent(id)}`, { headers: { 'Idempotency-Key': `order-delete-${crypto.randomUUID()}` } });
  },
};
