import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UseFilters } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import type { Server, WebSocket } from 'ws';
import { RealtimeAuthService } from './realtime-auth.service';

type GatewayClient = WebSocket & {
  id?: string;
  principalSub?: string;
};

type SessionRealtimeEnvelope = {
  kind: 'session.event' | 'session.ack' | 'session.error' | 'session.joined';
  sessionId: string;
  sequence: number;
  actorId?: string;
  sentAt: string;
  payload: Record<string, unknown>;
};

type JoinPayload = {
  sessionId?: string;
};

type ActionPayload = {
  sessionId?: string;
  actionType?: string;
  clientSequence?: number;
  data?: Record<string, unknown>;
};

@WebSocketGateway({
  path: '/realtime/sessions',
  cors: { origin: true, credentials: true },
})
@UseFilters(new BaseWsExceptionFilter())
export class SessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(SessionGateway.name);
  private readonly sessions = new Map<string, Set<GatewayClient>>();
  private readonly clientToSession = new Map<string, string>();
  private readonly sessionSequence = new Map<string, number>();

  constructor(private readonly auth: RealtimeAuthService) {}

  async handleConnection(client: GatewayClient, request: Request & { headers: Record<string, string | string[] | undefined> }) {
    const token = this.extractBearerToken(request.headers);
    const principal = await this.auth.verifyBearerToken(token);
    client.id = crypto.randomUUID();
    client.principalSub = principal.sub;
    this.safeSend(client, {
      kind: 'session.ack',
      sessionId: 'none',
      sequence: 0,
      actorId: principal.sub,
      sentAt: new Date().toISOString(),
      payload: { type: 'connected' },
    });
    this.logger.debug(`Realtime client connected: ${client.id} (${principal.sub})`);
  }

  handleDisconnect(client: GatewayClient) {
    const clientId = client.id;
    if (!clientId) return;
    const sessionId = this.clientToSession.get(clientId);
    if (!sessionId) return;

    const members = this.sessions.get(sessionId);
    members?.delete(client);
    if (members && members.size === 0) this.sessions.delete(sessionId);
    this.clientToSession.delete(clientId);
    this.logger.debug(`Realtime client disconnected: ${client.id} from ${sessionId}`);
  }

  @SubscribeMessage('session.join')
  onJoin(
    @ConnectedSocket() client: GatewayClient,
    @MessageBody() body: JoinPayload,
  ) {
    const sessionId = String(body?.sessionId || '').trim();
    if (!sessionId) throw new WsException('sessionId is required.');
    if (!client.id || !client.principalSub) throw new WsException('Unauthenticated client.');

    const previousSessionId = this.clientToSession.get(client.id);
    if (previousSessionId && previousSessionId !== sessionId) {
      this.sessions.get(previousSessionId)?.delete(client);
    }

    const members = this.sessions.get(sessionId) ?? new Set<GatewayClient>();
    members.add(client);
    this.sessions.set(sessionId, members);
    this.clientToSession.set(client.id, sessionId);

    this.safeSend(client, {
      kind: 'session.joined',
      sessionId,
      sequence: this.currentSequence(sessionId),
      actorId: client.principalSub,
      sentAt: new Date().toISOString(),
      payload: {
        sessionId,
        memberCount: members.size,
      },
    });
  }

  @SubscribeMessage('session.action')
  onAction(
    @ConnectedSocket() client: GatewayClient,
    @MessageBody() body: ActionPayload,
  ) {
    const sessionId = String(body?.sessionId || '').trim();
    const actionType = String(body?.actionType || '').trim();
    if (!sessionId) throw new WsException('sessionId is required.');
    if (!actionType) throw new WsException('actionType is required.');
    if (!client.id || !client.principalSub) throw new WsException('Unauthenticated client.');

    const activeSession = this.clientToSession.get(client.id);
    if (activeSession !== sessionId) throw new WsException('Client is not joined to this session.');

    const sequence = this.bumpSequence(sessionId);
    const envelope: SessionRealtimeEnvelope = {
      kind: 'session.event',
      sessionId,
      sequence,
      actorId: client.principalSub,
      sentAt: new Date().toISOString(),
      payload: {
        actionType,
        clientSequence: body.clientSequence,
        data: body.data ?? {},
      },
    };

    this.broadcast(sessionId, envelope);
    this.safeSend(client, {
      kind: 'session.ack',
      sessionId,
      sequence,
      actorId: client.principalSub,
      sentAt: envelope.sentAt,
      payload: {
        actionType,
        clientSequence: body.clientSequence,
      },
    });
  }

  @SubscribeMessage('session.ping')
  onPing(@ConnectedSocket() client: GatewayClient, @MessageBody() body: { sessionId?: string }) {
    const sessionId = String(body?.sessionId || '').trim() || this.clientToSession.get(client.id || '') || 'none';
    this.safeSend(client, {
      kind: 'session.ack',
      sessionId,
      sequence: this.currentSequence(sessionId),
      actorId: client.principalSub,
      sentAt: new Date().toISOString(),
      payload: { type: 'pong' },
    });
  }

  private extractBearerToken(headers: Record<string, string | string[] | undefined>): string {
    const rawAuth = headers.authorization;
    const header = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
    if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
    const protocol = headers['sec-websocket-protocol'];
    const value = Array.isArray(protocol) ? protocol[0] : protocol;
    if (!value) throw new WsException('Missing authorization token.');
    const token = value.split(',').map((part) => part.trim()).find((part) => part.startsWith('bearer.'));
    if (!token) throw new WsException('Missing authorization token.');
    return token.slice('bearer.'.length);
  }

  private currentSequence(sessionId: string): number {
    return this.sessionSequence.get(sessionId) ?? 0;
  }

  private bumpSequence(sessionId: string): number {
    const next = this.currentSequence(sessionId) + 1;
    this.sessionSequence.set(sessionId, next);
    return next;
  }

  private broadcast(sessionId: string, envelope: SessionRealtimeEnvelope) {
    const members = this.sessions.get(sessionId);
    if (!members?.size) return;
    const encoded = JSON.stringify(envelope);
    for (const member of members) {
      if (member.readyState === member.OPEN) member.send(encoded);
    }
  }

  private safeSend(client: GatewayClient, envelope: SessionRealtimeEnvelope) {
    if (client.readyState !== client.OPEN) return;
    client.send(JSON.stringify(envelope));
  }
}