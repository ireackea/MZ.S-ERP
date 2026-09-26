import apiClient from '../api/client';
import type { Partner } from '../types';

const unwrap = <T>(payload: any): T => (payload?.data ?? payload) as T;

export const partnersApi = {
  async list(): Promise<Partner[]> {
    const response = await apiClient.get('/partners');
    return unwrap<Partner[]>(response.data) || [];
  },
  async create(partner: Omit<Partner, 'id'>, idempotencyKey = `partner-create-${crypto.randomUUID()}`): Promise<Partner> {
    const response = await apiClient.post('/partners', partner, { headers: { 'Idempotency-Key': idempotencyKey } });
    return unwrap<Partner>(response.data);
  },
  async update(id: string, partner: Partial<Omit<Partner, 'id'>>): Promise<Partner> {
    const response = await apiClient.put(`/partners/${encodeURIComponent(id)}`, partner, { headers: { 'Idempotency-Key': `partner-update-${crypto.randomUUID()}` } });
    return unwrap<Partner>(response.data);
  },
  async remove(id: string): Promise<void> {
    await apiClient.delete(`/partners/${encodeURIComponent(id)}`, { headers: { 'Idempotency-Key': `partner-delete-${crypto.randomUUID()}` } });
  },
};
