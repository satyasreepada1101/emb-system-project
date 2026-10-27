import type { IncomingMessage, SetSystemEnabledCommand } from '../types/protocol';
import { parseIncoming } from './protocolParser';

export type LinkStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface LinkInfo {
  status: LinkStatus;
  /** Connection attempt number since the last successful open. */
  attempt: number;
  /** Epoch ms of the next automatic reconnect, when reconnecting. */
  retryAt: number | null;
  error: string | null;
}

export interface Esp32SocketHandlers {
  onLink(info: LinkInfo): void;
  onMessage(message: IncomingMessage): void;
  onProtocolError(error: string): void;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000];
const CONNECT_TIMEOUT_MS = 5000;

/**
 * Thin WebSocket client for the ESP32 with automatic reconnect.
 * It never queues outgoing commands: send() fails immediately when the
 * socket is not open, so nothing stale is replayed after reconnecting.
 */
export class Esp32Socket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = true;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: Esp32SocketHandlers,
  ) {}

  start(): void {
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close(1000, 'Dashboard closed connection');
      } catch {
        /* already closed */
      }
    }
    this.handlers.onLink({ status: 'closed', attempt: 0, retryAt: null, error: null });
  }

  send(command: SetSystemEnabledCommand): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(command));
      return true;
    } catch {
      return false;
    }
  }

  private open(): void {
    this.attempt++;
    this.lastError = null;
    this.handlers.onLink({ status: 'connecting', attempt: this.attempt, retryAt: null, error: null });

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      // Invalid URL: retrying will not help.
      this.handlers.onLink({
        status: 'closed',
        attempt: this.attempt,
        retryAt: null,
        error: `Invalid WebSocket URL: ${(err as Error).message}`,
      });
      return;
    }
    this.ws = ws;

    this.connectTimer = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        this.lastError = `No response from ${this.url} within ${CONNECT_TIMEOUT_MS / 1000} s`;
        ws.close();
      }
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      this.clearConnectTimer();
      this.attempt = 0;
      this.handlers.onLink({ status: 'open', attempt: 0, retryAt: null, error: null });
    };

    ws.onmessage = (event: MessageEvent) => {
      const result = parseIncoming(event.data);
      if (result.ok) this.handlers.onMessage(result.message);
      else this.handlers.onProtocolError(result.error);
    };

    ws.onerror = () => {
      this.lastError ??= 'Connection error (is the ESP32 reachable on this network?)';
    };

    ws.onclose = (event: CloseEvent) => {
      this.clearConnectTimer();
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      const reason = this.lastError ?? (event.reason || `Connection closed (code ${event.code})`);
      this.scheduleReconnect(reason);
    };
  }

  private scheduleReconnect(error: string): void {
    const delay = BACKOFF_MS[Math.min(this.attempt - 1, BACKOFF_MS.length - 1)] ?? 1000;
    this.handlers.onLink({
      status: 'reconnecting',
      attempt: this.attempt,
      retryAt: Date.now() + delay,
      error,
    });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.open();
    }, delay);
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private clearTimers(): void {
    this.clearConnectTimer();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
