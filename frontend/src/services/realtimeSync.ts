// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { io, type Socket } from 'socket.io-client';
import { getAuthToken } from '@services/authService';
import { useRealtimeSyncStore, type RealtimeSyncEvent } from '@/shared/store/realtimeSync.store';

let socket: Socket | null = null;

const getRealtimeBaseUrl = () => {
  const configured = String((import.meta as any)?.env?.VITE_REALTIME_URL || '').trim();
  if (configured) return configured;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:5173';
};

const attachListeners = (client: Socket) => {
  client.on('connect', () => {
    useRealtimeSyncStore.getState().setConnected(true);
  });

  client.on('disconnect', () => {
    useRealtimeSyncStore.getState().setConnected(false);
  });

  client.on('inventory:sync', (event: RealtimeSyncEvent) => {
    useRealtimeSyncStore.getState().applyEvent(event);
  });
};

export const startRealtimeSync = () => {
  if (socket) return socket;

  const token = getAuthToken();
  socket = io(`${getRealtimeBaseUrl()}/realtime`, {
    path: '/socket.io',
    withCredentials: true,
    transports: ['websocket', 'polling'],
    auth: token ? { token } : undefined,
  });

  attachListeners(socket);
  return socket;
};

export const stopRealtimeSync = () => {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
  useRealtimeSyncStore.getState().reset();
};

