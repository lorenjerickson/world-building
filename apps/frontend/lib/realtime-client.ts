export type RealtimeEnvelope = {
  kind: 'session.event' | 'session.ack' | 'session.error' | 'session.joined';
  sessionId: string;
  sequence: number;
  actorId?: string;
  sentAt: string;
  payload: Record<string, unknown>;
};

export type RealtimeState = {
  connected: boolean;
  sessionId?: string;
  lastServerSequence: number;
  nextClientSequence: number;
  inflight: Array<{ clientSequence: number; actionType: string; payload: Record<string, unknown> }>;
  lastError?: string;
};

type RealtimeSubscriber = (state: RealtimeState, event?: RealtimeEnvelope) => void;

type ConnectOptions = {
  baseUrl: string;
  sessionId: string;
  accessToken: string;
};

export class RealtimeClientStore {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByClient = false;
  private reconnectAttempts = 0;
  private readonly subscribers = new Set<RealtimeSubscriber>();

  private readonly state: RealtimeState = {
    connected: false,
    lastServerSequence: 0,
    nextClientSequence: 1,
    inflight: [],
  };

  subscribe(subscriber: RealtimeSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber({ ...this.state });
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  connect(options: ConnectOptions) {
    this.closedByClient = false;
    this.state.sessionId = options.sessionId;
    this.openSocket(options);
  }

  disconnect() {
    this.closedByClient = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.state.connected = false;
    this.emit();
  }

  sendAction(actionType: string, payload: Record<string, unknown>) {
    if (!this.state.sessionId) throw new Error('No realtime session is active.');
    const clientSequence = this.state.nextClientSequence;
    this.state.nextClientSequence += 1;
    const optimistic = { clientSequence, actionType, payload };
    this.state.inflight.push(optimistic);
    this.emit();

    this.sendRaw({
      type: 'session.action',
      sessionId: this.state.sessionId,
      actionType,
      clientSequence,
      data: payload,
    });
    return clientSequence;
  }

  private emit(event?: RealtimeEnvelope) {
    const snapshot: RealtimeState = {
      connected: this.state.connected,
      sessionId: this.state.sessionId,
      lastServerSequence: this.state.lastServerSequence,
      nextClientSequence: this.state.nextClientSequence,
      inflight: [...this.state.inflight],
      ...(this.state.lastError ? { lastError: this.state.lastError } : {}),
    };
    for (const subscriber of this.subscribers) subscriber(snapshot, event);
  }

  private openSocket(options: ConnectOptions) {
    const socketUrl = this.toSocketUrl(options.baseUrl);
    const socket = new WebSocket(socketUrl, [`bearer.${options.accessToken}`]);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.state.connected = true;
      this.state.lastError = undefined;
      this.emit();
      this.sendRaw({ type: 'session.join', sessionId: options.sessionId });
      this.flushInflight();
    };

    socket.onmessage = (event) => {
      try {
        const envelope = JSON.parse(String(event.data)) as RealtimeEnvelope;
        this.handleEnvelope(envelope);
      } catch {
        this.state.lastError = 'Received malformed realtime payload.';
        this.emit();
      }
    };

    socket.onerror = () => {
      this.state.lastError = 'Realtime transport error.';
      this.emit();
    };

    socket.onclose = () => {
      this.state.connected = false;
      this.emit();
      if (this.closedByClient) return;
      this.scheduleReconnect(options);
    };
  }

  private toSocketUrl(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/$/, '');
    if (trimmed.startsWith('https://')) return `${trimmed.replace('https://', 'wss://')}/realtime/sessions`;
    if (trimmed.startsWith('http://')) return `${trimmed.replace('http://', 'ws://')}/realtime/sessions`;
    return `${trimmed}/realtime/sessions`;
  }

  private scheduleReconnect(options: ConnectOptions) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delayMs = Math.min(10_000, 500 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.openSocket(options), delayMs);
  }

  private sendRaw(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }

  private flushInflight() {
    for (const entry of this.state.inflight) {
      this.sendRaw({
        type: 'session.action',
        sessionId: this.state.sessionId,
        actionType: entry.actionType,
        clientSequence: entry.clientSequence,
        data: entry.payload,
      });
    }
  }

  private handleEnvelope(envelope: RealtimeEnvelope) {
    if (envelope.sequence > this.state.lastServerSequence) {
      this.state.lastServerSequence = envelope.sequence;
    }
    if (envelope.kind === 'session.ack') {
      const ackClientSequence = typeof envelope.payload.clientSequence === 'number'
        ? envelope.payload.clientSequence
        : null;
      if (ackClientSequence !== null) {
        this.state.inflight = this.state.inflight.filter((entry) => entry.clientSequence !== ackClientSequence);
      }
    }
    if (envelope.kind === 'session.error') {
      this.state.lastError = typeof envelope.payload.message === 'string'
        ? envelope.payload.message
        : 'Realtime session error.';
    }
    this.emit(envelope);
  }
}
