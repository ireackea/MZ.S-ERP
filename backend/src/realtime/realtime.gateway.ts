// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
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

@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
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

