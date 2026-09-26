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
import { AuthService } from '../auth/auth.service';
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

function parseCookieHeader(rawCookieHeader: string | string[] | undefined): Record<string, string> {
  const headerValue = Array.isArray(rawCookieHeader)
    ? rawCookieHeader.join('; ')
    : String(rawCookieHeader || '');

  return headerValue
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((cookies, segment) => {
      const separatorIndex = segment.indexOf('=');
      if (separatorIndex <= 0) return cookies;

      const name = segment.slice(0, separatorIndex).trim();
      const value = segment.slice(separatorIndex + 1).trim();
      if (!name) return cookies;

      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
      return cookies;
    }, {});
}

function shouldUseSecureSocketCookie(client: Socket): boolean {
  const explicitSetting = String(process.env.AUTH_COOKIE_SECURE || '').trim().toLowerCase();
  if (explicitSetting === 'true') return true;
  if (explicitSetting === 'false') return false;

  const forwardedProto = String(client.handshake.headers['x-forwarded-proto'] || '').toLowerCase();
  const requestSocket = (client.request as { socket?: { encrypted?: boolean } } | undefined)?.socket;
  return Boolean(requestSocket?.encrypted) || forwardedProto === 'https';
}

function extractSocketCookieToken(client: Socket): string {
  const cookies = parseCookieHeader(client.handshake.headers.cookie);
  const token = String(cookies.feed_factory_jwt || '').trim();
  if (!token) return '';

  if (shouldUseSecureSocketCookie(client)) {
    const forwardedProto = String(client.handshake.headers['x-forwarded-proto'] || '').toLowerCase();
    const requestSocket = (client.request as { socket?: { encrypted?: boolean } } | undefined)?.socket;
    const secureTransport = Boolean(requestSocket?.encrypted) || forwardedProto === 'https';
    if (!secureTransport) return '';
  }

  return token;
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

  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly authService: AuthService,
  ) {}

  afterInit() {
    this.realtimeService.registerGateway(this);
    this.server.use(async (client, next) => {
      const cookieToken = extractSocketCookieToken(client);

      if (!cookieToken) {
        this.logger.warn(`Rejected realtime client without authenticated session: ${client.id}`);
        next(new Error('Unauthorized'));
        return;
      }

      try {
        client.data.user = await this.authService.verifyToken(cookieToken);
        next();
      } catch (error) {
        this.logger.warn(
          `Rejected realtime client with invalid session: ${client.id} (${String((error as Error)?.message || error)})`,
        );
        next(new Error('Unauthorized'));
      }
    });
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
    if (!event.scope || event.scope === 'all' || event.scope === 'default') {
      this.server.emit('inventory:sync', event);
      return;
    }

    for (const client of this.server?.sockets?.sockets?.values?.() || []) {
      const user = client?.data?.user;
      if (user?.role === 'SuperAdmin') {
        client.emit('inventory:sync', event);
      }
    }
  }

  getConnectedClientsCount() {
    return this.server?.sockets?.sockets?.size ?? 0;
  }
}
