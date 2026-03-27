import {
  type WsPush,
  type WsPushChannel,
  type WsPushMessage,
  WS_METHODS,
  WebSocketResponse,
  type WsResponse as WsResponseMessage,
  WsResponse as WsResponseSchema,
} from "@fatma/contracts";
import { decodeUnknownJsonResult, formatSchemaError } from "@fatma/shared/schemaJson";
import { Result, Schema } from "effect";

import { subscribeToAppResume, type AppResumeReason } from "./appResumeSignals";

type PushListener<C extends WsPushChannel> = (message: WsPushMessage<C>) => void;
type StateListener = (state: TransportState) => void;
type ReconnectListener = () => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
  method: string;
  queued: boolean;
}

interface QueuedOutboundMessage {
  id: string;
  encoded: string;
}

interface SubscribeOptions {
  readonly replayLatest?: boolean;
}

interface StateSubscribeOptions {
  readonly replayCurrent?: boolean;
}

interface RequestOptions {
  readonly timeoutMs?: number | null;
}

export type TransportState = "connecting" | "open" | "reconnecting" | "closed" | "disposed";

const REQUEST_TIMEOUT_MS = 60_000;
const STALE_CONNECTION_IDLE_MS = 45_000;
const STALE_CONNECTION_PROBE_TIMEOUT_MS = 8_000;
const RESUME_PROBE_IDLE_MS = 5_000;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];
const decodeWsResponse = decodeUnknownJsonResult(WsResponseSchema);
const isWebSocketResponseEnvelope = Schema.is(WebSocketResponse);

const isWsPushMessage = (value: WsResponseMessage): value is WsPush =>
  "type" in value && value.type === "push";

interface WsRequestEnvelope {
  id: string;
  body: {
    _tag: string;
    [key: string]: unknown;
  };
}

function isLocalhostHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (normalized.length === 0) return false;
  if (normalized === "localhost") return true;
  if (normalized === "0.0.0.0") return true;
  if (normalized === "::1") return true;
  if (normalized.startsWith("127.")) return true;
  return false;
}

function normalizeWsUrlForPage(input: string): string {
  if (typeof window === "undefined") {
    return input;
  }

  try {
    const parsed = new URL(input, window.location.origin);
    const pageProtocol = window.location.protocol;

    if (pageProtocol === "https:" && parsed.protocol === "ws:") {
      parsed.protocol = "wss:";
    } else if (pageProtocol === "http:" && parsed.protocol === "wss:") {
      parsed.protocol = "ws:";
    }

    if (isLocalhostHostname(parsed.hostname) && !isLocalhostHostname(window.location.hostname)) {
      parsed.hostname = window.location.hostname;
    }

    return parsed.toString();
  } catch {
    return input;
  }
}

function defaultWsUrl(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(fallback);
}

export class WsTransport {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<(message: WsPush) => void>>();
  private readonly latestPushByChannel = new Map<string, WsPush>();
  private readonly outboundQueue: QueuedOutboundMessage[] = [];
  private readonly stateListeners = new Set<StateListener>();
  private readonly reconnectListeners = new Set<ReconnectListener>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private staleConnectionTimer: ReturnType<typeof setTimeout> | null = null;
  private healthCheckPromise: Promise<boolean> | null = null;
  private detachResumeSubscription: (() => void) | null = null;
  private disposed = false;
  private state: TransportState = "connecting";
  private lastServerActivityAt = 0;
  private readonly url: string;
  private reconnectOnClose = false;

  constructor(url?: string) {
    const bridgeUrl = window.desktopBridge?.getWsUrl();
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    const candidate =
      url ??
      (bridgeUrl && bridgeUrl.length > 0
        ? bridgeUrl
        : envUrl && envUrl.length > 0
          ? envUrl
          : defaultWsUrl());
    this.url = normalizeWsUrlForPage(candidate);
    this.detachResumeSubscription = subscribeToAppResume((reason) => {
      this.handleAppResume(reason);
    });
    this.connect();
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.requestInternal<T>(method, params, options);
  }

  subscribe<C extends WsPushChannel>(
    channel: C,
    listener: PushListener<C>,
    options?: SubscribeOptions,
  ): () => void {
    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set<(message: WsPush) => void>();
      this.listeners.set(channel, channelListeners);
    }

    const wrappedListener = (message: WsPush) => {
      listener(message as WsPushMessage<C>);
    };
    channelListeners.add(wrappedListener);

    if (options?.replayLatest) {
      const latest = this.latestPushByChannel.get(channel);
      if (latest) {
        wrappedListener(latest);
      }
    }

    return () => {
      channelListeners?.delete(wrappedListener);
      if (channelListeners?.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  onStateChange(listener: StateListener, options?: StateSubscribeOptions): () => void {
    this.stateListeners.add(listener);
    if (options?.replayCurrent) {
      listener(this.state);
    }
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  onReconnect(listener: ReconnectListener): () => void {
    this.reconnectListeners.add(listener);
    return () => {
      this.reconnectListeners.delete(listener);
    };
  }

  getLatestPush<C extends WsPushChannel>(channel: C): WsPushMessage<C> | null {
    const latest = this.latestPushByChannel.get(channel);
    return latest ? (latest as WsPushMessage<C>) : null;
  }

  getState(): TransportState {
    return this.state;
  }

  dispose() {
    this.disposed = true;
    this.transitionTo("disposed");
    this.detachResumeSubscription?.();
    this.detachResumeSubscription = null;
    this.clearReconnectTimer();
    this.clearStaleConnectionTimer();
    for (const [id, pending] of this.pending) {
      if (pending.timeout !== null) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error("Transport disposed"));
      this.pending.delete(id);
    }
    this.outboundQueue.length = 0;
    const currentSocket = this.ws;
    this.ws = null;
    currentSocket?.close();
  }

  private async requestInternal<T = unknown>(
    method: string,
    params?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    if (typeof method !== "string" || method.length === 0) {
      throw new Error("Request method is required");
    }

    const id = String(this.nextId++);
    const body = params != null ? { ...params, _tag: method } : { _tag: method };
    const message: WsRequestEnvelope = { id, body };
    const encoded = JSON.stringify(message);

    return new Promise<T>((resolve, reject) => {
      const timeoutMs = options?.timeoutMs === undefined ? REQUEST_TIMEOUT_MS : options.timeoutMs;
      const timeout =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              this.removeQueuedRequest(id);
              reject(new Error(`Request timed out: ${method}`));
            }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
        method,
        queued: true,
      });

      this.send(id, encoded);
    });
  }

  private connect() {
    if (this.disposed) {
      return;
    }
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      return;
    }

    this.clearReconnectTimer();
    const openingAsReconnect = this.hasConnectedBefore();
    this.transitionTo(openingAsReconnect ? "reconnecting" : "connecting");

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (this.ws !== ws) {
        return;
      }
      this.reconnectAttempt = 0;
      this.reconnectOnClose = false;
      this.recordServerActivity();
      this.transitionTo("open");
      this.flushQueue();
      if (openingAsReconnect) {
        this.emitReconnect();
      }
    });

    ws.addEventListener("message", (event) => {
      if (this.ws !== ws) {
        return;
      }
      this.recordServerActivity();
      this.handleMessage(event.data);
    });

    ws.addEventListener("close", () => {
      if (this.ws === ws) {
        this.ws = null;
      }
      this.outboundQueue.length = 0;
      this.clearStaleConnectionTimer();
      for (const [id, pending] of this.pending) {
        if (pending.timeout !== null) {
          clearTimeout(pending.timeout);
        }
        this.pending.delete(id);
        pending.reject(new Error("WebSocket connection closed."));
      }

      if (this.disposed) {
        this.transitionTo("disposed");
        return;
      }

      if (this.reconnectOnClose) {
        this.reconnectOnClose = false;
        this.connect();
        return;
      }

      this.scheduleReconnect();
    });

    ws.addEventListener("error", (event) => {
      // Log WebSocket errors for debugging (close event will follow)
      console.warn("WebSocket connection error", { type: event.type, url: this.url });
    });
  }

  private handleMessage(raw: unknown) {
    const result = decodeWsResponse(raw);
    if (Result.isFailure(result)) {
      console.warn("Dropped inbound WebSocket envelope", formatSchemaError(result.failure));
      return;
    }

    const message = result.success;
    if (isWsPushMessage(message)) {
      this.latestPushByChannel.set(message.channel, message);
      const channelListeners = this.listeners.get(message.channel);
      if (channelListeners) {
        for (const listener of channelListeners) {
          try {
            listener(message);
          } catch {
            // Swallow listener errors
          }
        }
      }
      return;
    }

    if (!isWebSocketResponseEnvelope(message)) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    if (pending.timeout !== null) {
      clearTimeout(pending.timeout);
    }
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve(message.result);
  }

  private send(id: string, encodedMessage: string) {
    if (this.disposed) {
      return;
    }

    this.outboundQueue.push({ id, encoded: encodedMessage });
    try {
      this.flushQueue();
    } catch {
      // Swallow: flushQueue has queued the message for retry on reconnect.
    }
  }

  private flushQueue() {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.outboundQueue.length > 0) {
      const nextMessage = this.outboundQueue.shift();
      if (!nextMessage) {
        continue;
      }
      const pending = this.pending.get(nextMessage.id);
      if (!pending) {
        continue;
      }
      try {
        this.ws.send(nextMessage.encoded);
        pending.queued = false;
      } catch (error) {
        this.outboundQueue.unshift(nextMessage);
        throw asError(error, "Failed to send WebSocket request.");
      }
    }
  }

  private scheduleReconnect(options?: { immediate?: boolean }) {
    if (this.disposed) {
      return;
    }

    const immediate = options?.immediate ?? false;
    this.transitionTo("reconnecting");
    if (this.reconnectTimer !== null && !immediate) {
      return;
    }

    this.clearReconnectTimer();
    const delay = immediate
      ? 0
      : (RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ??
        RECONNECT_DELAYS_MS[0]!);

    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleAppResume(reason: AppResumeReason) {
    if (this.disposed) {
      return;
    }
    if (
      typeof navigator !== "undefined" &&
      "onLine" in navigator &&
      navigator.onLine === false &&
      reason !== "online"
    ) {
      return;
    }

    if (this.state === "connecting" || this.state === "reconnecting" || this.state === "closed") {
      this.scheduleReconnect({ immediate: true });
      return;
    }

    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.scheduleReconnect({ immediate: true });
      return;
    }

    const idleMs = Date.now() - this.lastServerActivityAt;
    if (reason === "online" || idleMs >= RESUME_PROBE_IDLE_MS) {
      this.forceReconnect();
      return;
    }

    void this.probeConnection();
  }

  private forceReconnect() {
    if (this.disposed) {
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      this.reconnectOnClose = true;
      this.transitionTo("reconnecting");
      this.clearStaleConnectionTimer();
      try {
        this.ws.close();
      } catch {
        this.reconnectOnClose = false;
        this.scheduleReconnect({ immediate: true });
      }
      return;
    }

    this.scheduleReconnect({ immediate: true });
  }

  private async probeConnection(): Promise<boolean> {
    if (this.disposed) {
      return false;
    }
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (this.healthCheckPromise) {
      return this.healthCheckPromise;
    }

    const probePromise = this.requestInternal(WS_METHODS.serverPing, undefined, {
      timeoutMs: STALE_CONNECTION_PROBE_TIMEOUT_MS,
    })
      .then(() => true)
      .catch(() => {
        this.forceReconnect();
        return false;
      })
      .finally(() => {
        if (this.healthCheckPromise === probePromise) {
          this.healthCheckPromise = null;
        }
      });

    this.healthCheckPromise = probePromise;
    return probePromise;
  }

  private recordServerActivity() {
    this.lastServerActivityAt = Date.now();
    this.scheduleStaleConnectionCheck();
  }

  private scheduleStaleConnectionCheck() {
    this.clearStaleConnectionTimer();
    if (this.disposed || this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    const idleMs = Date.now() - this.lastServerActivityAt;
    const delay = Math.max(0, STALE_CONNECTION_IDLE_MS - idleMs);
    this.staleConnectionTimer = setTimeout(() => {
      this.staleConnectionTimer = null;
      void this.checkForStaleConnection();
    }, delay);
  }

  private async checkForStaleConnection(): Promise<void> {
    if (this.disposed || this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    const idleMs = Date.now() - this.lastServerActivityAt;
    if (idleMs < STALE_CONNECTION_IDLE_MS) {
      this.scheduleStaleConnectionCheck();
      return;
    }

    await this.probeConnection();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.scheduleStaleConnectionCheck();
    }
  }

  private rejectInflightRequests() {
    for (const [id, pending] of this.pending) {
      if (pending.queued) {
        continue;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      pending.reject(new Error(`WebSocket disconnected during request: ${pending.method}`));
    }
  }

  private removeQueuedRequest(id: string) {
    const queueIndex = this.outboundQueue.findIndex((entry) => entry.id === id);
    if (queueIndex >= 0) {
      this.outboundQueue.splice(queueIndex, 1);
    }
  }

  private emitReconnect() {
    for (const listener of this.reconnectListeners) {
      try {
        listener();
      } catch {
        // Swallow listener errors.
      }
    }
  }

  private transitionTo(nextState: TransportState) {
    if (this.state === nextState) {
      return;
    }

    this.state = nextState;
    for (const listener of this.stateListeners) {
      try {
        listener(nextState);
      } catch {
        // Swallow listener errors.
      }
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearStaleConnectionTimer() {
    if (this.staleConnectionTimer !== null) {
      clearTimeout(this.staleConnectionTimer);
      this.staleConnectionTimer = null;
    }
  }

  private hasConnectedBefore(): boolean {
    return this.lastServerActivityAt > 0 || this.reconnectAttempt > 0;
  }
}
