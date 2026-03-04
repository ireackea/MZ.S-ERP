// ENTERPRISE FIX: Phase 1.5 - Conflict & Socket Stability - 2026-03-02
// ENTERPRISE FIX: Phase 1 - Dual Mode Implementation - 2026-03-02
// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { Injectable, Logger } from '@nestjs/common';

export type RealtimeScope = 'dashboard' | 'items' | 'operations' | 'transactions' | 'formulation' | 'stocktaking' | 'offline_sync';

export type RealtimeSyncEvent = {
  scopes: RealtimeScope[];
  reason: string;
  timestamp: string;
  actor?: string;
  meta?: Record<string, unknown>;
  conflict?: boolean;
};

type RealtimeGatewayBridge = {
  broadcastSync: (event: RealtimeSyncEvent) => void;
  getConnectedClientsCount: () => number;
};

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private gateway: RealtimeGatewayBridge | null = null;

  registerGateway(gateway: RealtimeGatewayBridge) {
    this.gateway = gateway;
    this.logger.log('Realtime gateway registered');
  }

  emitSync(
    scopes: RealtimeScope[],
    reason: string,
    options?: { actor?: string; meta?: Record<string, unknown>; conflict?: boolean },
  ) {
    if (!this.gateway || !scopes.length) return;
    const event: RealtimeSyncEvent = {
      scopes: Array.from(new Set(scopes)),
      reason,
      timestamp: new Date().toISOString(),
      actor: options?.actor,
      meta: options?.meta,
      conflict: options?.conflict || false,
    };
    this.gateway.broadcastSync(event);
  }

  emitOfflineSyncCompleted(actor?: string, conflictDetected: boolean = false) {
    this.emitSync(['offline_sync'], 'Offline sync payload processed', {
      actor,
      conflict: conflictDetected,
      meta: { resolved: 'Server Wins' }
    });
  }

  getConnectedClientsCount() {
    return this.gateway?.getConnectedClientsCount() ?? 0;
  }
}

