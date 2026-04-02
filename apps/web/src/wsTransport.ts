import { Duration, Effect, Exit, ManagedRuntime, Scope, Stream } from "effect";

import {
  createWsRpcProtocolLayer,
  makeWsRpcProtocolClient,
  type WsRpcProtocolClient,
} from "./rpc/protocol";
import { subscribeToAppResume, type AppResumeReason } from "./appResumeSignals";
import { WS_METHODS } from "@fatma/contracts";

const DEFAULT_SUBSCRIPTION_RETRY_DELAY_MS = Duration.millis(250);
const DEFAULT_RECONNECT_PROBE_DELAY_MS = 1_000;

export type TransportState = "connecting" | "open" | "reconnecting" | "closed" | "disposed";

type StateListener = (state: TransportState) => void;
type ReconnectListener = () => void;

interface SubscribeOptions {
  readonly retryDelay?: Duration.Input;
}

interface StateSubscribeOptions {
  readonly replayCurrent?: boolean;
}

interface RequestOptions {
  readonly timeout?: unknown;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

export class WsTransport {
  private readonly runtime: ManagedRuntime.ManagedRuntime<any, never>;
  private readonly clientScope: Scope.Closeable;
  private readonly clientPromise: Promise<WsRpcProtocolClient>;
  private readonly stateListeners = new Set<StateListener>();
  private readonly reconnectListeners = new Set<ReconnectListener>();

  private disposed = false;
  private state: TransportState = "connecting";
  private pendingReconnect = false;
  private reconnectProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private detachResumeSubscription: (() => void) | null = null;

  constructor(url?: string) {
    this.runtime = ManagedRuntime.make(createWsRpcProtocolLayer(url));
    this.clientScope = this.runtime.runSync(Scope.make());
    this.clientPromise = this.runtime.runPromise(
      Scope.provide(this.clientScope)(makeWsRpcProtocolClient),
    );
    this.detachResumeSubscription = subscribeToAppResume((reason) => {
      this.handleAppResume(reason);
    });
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

  getState(): TransportState {
    return this.state;
  }

  async request<TSuccess>(
    execute: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, Error, never>,
    _options?: RequestOptions,
  ): Promise<TSuccess> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    try {
      const client = await this.clientPromise;
      const result = await this.runtime.runPromise(Effect.suspend(() => execute(client)));
      this.markConnected();
      return result;
    } catch (error) {
      this.markDisconnected();
      throw error;
    }
  }

  async requestStream<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
  ): Promise<void> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    try {
      const client = await this.clientPromise;
      await this.runtime.runPromise(
        Stream.runForEach(connect(client), (value) =>
          Effect.sync(() => {
            this.markConnected();
            try {
              listener(value);
            } catch {
              // Swallow listener errors so the stream can finish cleanly.
            }
          }),
        ),
      );
    } catch (error) {
      this.markDisconnected();
      throw error;
    }
  }

  subscribe<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    options?: SubscribeOptions,
  ): () => void {
    if (this.disposed) {
      return () => undefined;
    }

    let active = true;
    const retryDelayMs = options?.retryDelay ?? DEFAULT_SUBSCRIPTION_RETRY_DELAY_MS;
    const cancel = this.runtime.runCallback(
      Effect.promise(() => this.clientPromise).pipe(
        Effect.flatMap((client) =>
          Stream.runForEach(connect(client), (value) =>
            Effect.sync(() => {
              if (!active) {
                return;
              }
              this.markConnected();
              try {
                listener(value);
              } catch {
                // Swallow listener errors so the stream stays live.
              }
            }),
          ),
        ),
        Effect.catch((error) => {
          if (!active || this.disposed) {
            return Effect.interrupt;
          }
          return Effect.sync(() => {
            this.markDisconnected();
            console.warn("WebSocket RPC subscription disconnected", {
              error: formatErrorMessage(error),
            });
          }).pipe(Effect.andThen(Effect.sleep(retryDelayMs)));
        }),
        Effect.forever,
      ),
    );

    return () => {
      active = false;
      cancel();
    };
  }

  async dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearReconnectProbeTimer();
    this.detachResumeSubscription?.();
    this.detachResumeSubscription = null;
    this.transitionTo("disposed");
    await this.runtime.runPromise(Scope.close(this.clientScope, Exit.void)).finally(() => {
      this.runtime.dispose();
    });
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
    this.markDisconnected();
  }

  private async probeConnection(): Promise<boolean> {
    if (this.disposed) {
      return false;
    }

    try {
      await this.request((client) => client[WS_METHODS.serverGetSettings]({}));
      return true;
    } catch {
      this.scheduleReconnectProbe();
      return false;
    }
  }

  private scheduleReconnectProbe() {
    if (this.disposed) {
      return;
    }
    this.transitionTo("reconnecting");
    if (this.reconnectProbeTimer !== null) {
      return;
    }
    this.reconnectProbeTimer = setTimeout(() => {
      this.reconnectProbeTimer = null;
      void this.probeConnection();
    }, DEFAULT_RECONNECT_PROBE_DELAY_MS);
  }

  private clearReconnectProbeTimer() {
    if (this.reconnectProbeTimer !== null) {
      clearTimeout(this.reconnectProbeTimer);
      this.reconnectProbeTimer = null;
    }
  }

  private markConnected() {
    if (this.disposed) {
      return;
    }
    this.clearReconnectProbeTimer();
    const shouldEmitReconnect = this.pendingReconnect || this.state === "reconnecting";
    this.pendingReconnect = false;
    this.transitionTo("open");
    if (shouldEmitReconnect) {
      for (const listener of this.reconnectListeners) {
        try {
          listener();
        } catch {
          // Swallow listener errors.
        }
      }
    }
  }

  private markDisconnected() {
    if (this.disposed) {
      return;
    }
    if (this.state === "open") {
      this.pendingReconnect = true;
    }
    this.scheduleReconnectProbe();
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
}
