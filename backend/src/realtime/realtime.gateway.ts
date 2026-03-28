// ENTERPRISE FIX: Phase 0 – Critical Security & Encoding Lockdown - 2026-03-13
// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
// SECURITY FIX: 2026-03-28 - Fixed permissive CORS
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { RealtimeService, RealtimeSyncEvent } from './realtime.service';

// Helper functions for CORS validation (matching main.ts logic)
function getAllowedOrigins(): string[] {
  const rawOrigins =
    process.env.CORS_ORIGINS ||
    process.env.ALLOWED_ORIGINS ||
    'http://localhost:5173,http://localhost:5174,http://localhost:3000';
  return rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

function isGithubCodespacesOrigin(origin: string): boolean {
  return /^https:\/\/[a-z0-9-]+\.(app|preview)\.github\.dev$/i.test(origin);
}

function isTrustedLocalOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function matchesConfiguredOrigin(origin: string, allowedOrigins: string[]): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  return allowedOrigins.some((candidate) => {
    const normalizedCandidate = normalizeOrigin(candidate);
    if (normalizedCandidate.startsWith('*.')) {
      const suffix = normalizedCandidate.slice(1);
      return normalizedOrigin.endsWith(suffix);
    }
    return normalizedOrigin === normalizedCandidate;
  });
}

function validateWebSocketOrigin(origin: string): boolean {
  if (!origin) return false;

  const normalizedOrigin = normalizeOrigin(origin);
  const allowedOrigins = getAllowedOrigins();
  const allowCodespacesOrigin = String(process.env.ALLOW_CODESPACES_ORIGINS || '').toLowerCase() === 'true';
  const isProduction = process.env.NODE_ENV === 'production';

  // Check local origins in development
  if (!isProduction && isTrustedLocalOrigin(normalizedOrigin)) {
    return true;
  }

  // Check Codespaces origins
  if (allowCodespacesOrigin && isGithubCodespacesOrigin(normalizedOrigin)) {
    return true;
  }

  // Check configured origins
  if (matchesConfiguredOrigin(normalizedOrigin, allowedOrigins)) {
    return true;
  }

  return false;
}

@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      if (validateWebSocketOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by WebSocket CORS policy'));
      }
    },
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly realtimeService: RealtimeService) {}

  afterInit() {
    this.realtimeService.registerGateway(this);
    this.logger.log('Realtime gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Realtime client connected: ${client.id}`);
    client.emit('realtime:connected', {
      clientId: client.id,
      timestamp: new Date().toISOString(),
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Realtime client disconnected: ${client.id}`);
  }

  @SubscribeMessage('realtime:ping')
  handlePing(@ConnectedSocket() client: Socket, @MessageBody() payload?: Record<string, unknown>) {
    client.emit('realtime:pong', {
      timestamp: new Date().toISOString(),
      echo: payload || {},
      connectedClients: this.getConnectedClientsCount(),
    });
  }

  broadcastSync(event: RealtimeSyncEvent) {
    this.server.emit('inventory:sync', event);
  }

  getConnectedClientsCount() {
    return this.server?.sockets?.sockets?.size ?? 0;
  }
}
