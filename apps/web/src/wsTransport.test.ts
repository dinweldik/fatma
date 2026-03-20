import { WS_CHANNELS, WS_METHODS } from "@fatma/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WsTransport } from "./wsTransport";

type WsEventType = "open" | "message" | "close" | "error";
type WsListener = (event?: { data?: unknown; type?: string }) => void;
type EventListener = (event?: { type: string }) => void;

const sockets: MockWebSocket[] = [];

class MockEventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type);
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      this.listeners.delete(type);
    }
  }

  dispatch(type: string) {
    const listeners = this.listeners.get(type);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener({ type });
    }
  }

  reset() {
    this.listeners.clear();
  }
}

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly url: string;
  private readonly listeners = new Map<WsEventType, Set<WsListener>>();

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  addEventListener(type: WsEventType, listener: WsListener) {
    const listeners = this.listeners.get(type) ?? new Set<WsListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  serverMessage(data: unknown) {
    this.emit("message", { data });
  }

  private emit(type: WsEventType, event?: { data?: unknown; type?: string }) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(event);
    }
  }
}

const originalWebSocket = globalThis.WebSocket;
const windowTarget = new MockEventTarget();
const documentTarget = new MockEventTarget();

function getSocket(index = -1): MockWebSocket {
  const socket = sockets.at(index);
  if (!socket) {
    throw new Error("Expected a websocket instance");
  }
  return socket;
}

function emitWindowEvent(type: "focus" | "online") {
  windowTarget.dispatch(type);
}

function emitVisibilityChange(visibilityState: "visible" | "hidden") {
  Object.defineProperty(globalThis.document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
  documentTarget.dispatch("visibilitychange");
}

beforeEach(() => {
  sockets.length = 0;
  vi.useRealTimers();
  windowTarget.reset();
  documentTarget.reset();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { protocol: "http:", host: "localhost:3020", hostname: "localhost", port: "3020" },
      desktopBridge: undefined,
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      visibilityState: "visible",
      addEventListener: documentTarget.addEventListener.bind(documentTarget),
      removeEventListener: documentTarget.removeEventListener.bind(documentTarget),
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      onLine: true,
    },
  });

  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("WsTransport", () => {
  it("routes valid push envelopes to channel listeners", () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const listener = vi.fn();
    transport.subscribe(WS_CHANNELS.serverConfigUpdated, listener);

    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 1,
        channel: WS_CHANNELS.serverConfigUpdated,
        data: { issues: [], providers: [] },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "push",
      sequence: 1,
      channel: WS_CHANNELS.serverConfigUpdated,
      data: { issues: [], providers: [] },
    });

    transport.dispose();
  });

  it("resolves pending requests for valid response envelopes", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const requestPromise = transport.request("projects.list");
    const sent = socket.sent.at(-1);
    if (!sent) {
      throw new Error("Expected request envelope to be sent");
    }

    const requestEnvelope = JSON.parse(sent) as { id: string };
    socket.serverMessage(
      JSON.stringify({
        id: requestEnvelope.id,
        result: { projects: [] },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ projects: [] });

    transport.dispose();
  });

  it("drops malformed envelopes without crashing transport", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const listener = vi.fn();
    transport.subscribe(WS_CHANNELS.serverConfigUpdated, listener);

    socket.serverMessage("{ invalid-json");
    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 2,
        channel: 42,
        data: { bad: true },
      }),
    );
    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 3,
        channel: WS_CHANNELS.serverConfigUpdated,
        data: { issues: [], providers: [] },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "push",
      sequence: 3,
      channel: WS_CHANNELS.serverConfigUpdated,
      data: { issues: [], providers: [] },
    });
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenNthCalledWith(
      1,
      "Dropped inbound WebSocket envelope",
      "SyntaxError: Expected property name or '}' in JSON at position 2 (line 1 column 3)",
    );
    expect(warnSpy).toHaveBeenNthCalledWith(
      2,
      "Dropped inbound WebSocket envelope",
      expect.stringContaining('Expected "server.configUpdated"'),
    );

    transport.dispose();
  });

  it("upgrades insecure ws URL fallback to wss when page is HTTPS", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          protocol: "https:",
          host: "example.ts.net",
          hostname: "example.ts.net",
          port: "",
        },
        desktopBridge: undefined,
        addEventListener: windowTarget.addEventListener.bind(windowTarget),
        removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
      },
    });

    const transport = new WsTransport();
    const socket = getSocket();

    expect(socket.url).toBe("wss://example.ts.net/");
    transport.dispose();
  });

  it("rewrites localhost hosts to the current origin when the browser is remote over HTTP", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          protocol: "http:",
          host: "100.88.10.4:5733",
          hostname: "100.88.10.4",
          port: "5733",
        },
        desktopBridge: undefined,
        addEventListener: windowTarget.addEventListener.bind(windowTarget),
        removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
      },
    });

    const transport = new WsTransport("ws://localhost:3773");
    const socket = getSocket();

    expect(socket.url).toBe("ws://100.88.10.4:3773/");
    transport.dispose();
  });

  it("rewrites localhost hosts to the current origin when the browser is remote over HTTPS", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          protocol: "https:",
          host: "example.ts.net:5000",
          hostname: "example.ts.net",
          port: "5000",
        },
        desktopBridge: undefined,
        addEventListener: windowTarget.addEventListener.bind(windowTarget),
        removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
      },
    });

    const transport = new WsTransport("ws://localhost:3773");
    const socket = getSocket();

    expect(socket.url).toBe("wss://example.ts.net:3773/");
    transport.dispose();
  });

  it("queues requests until the websocket opens", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();

    const requestPromise = transport.request("projects.list");
    expect(socket.sent).toHaveLength(0);

    socket.open();
    expect(socket.sent).toHaveLength(1);
    const requestEnvelope = JSON.parse(socket.sent[0] ?? "{}") as { id: string };
    socket.serverMessage(
      JSON.stringify({
        id: requestEnvelope.id,
        result: { projects: [] },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ projects: [] });
    transport.dispose();
  });

  it("emits reconnect state and listeners when a closed socket reconnects", async () => {
    vi.useFakeTimers();

    const transport = new WsTransport("ws://localhost:3020");
    const states: string[] = [];
    const onReconnect = vi.fn();

    transport.onStateChange((state) => states.push(state), { replayCurrent: true });
    transport.onReconnect(onReconnect);

    const socket = getSocket();
    socket.open();
    socket.close();

    expect(states).toContain("reconnecting");

    await vi.advanceTimersByTimeAsync(500);
    const nextSocket = getSocket();
    expect(nextSocket).not.toBe(socket);

    nextSocket.open();

    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("open");

    transport.dispose();
  });

  it("forces a reconnect on app resume after the connection has gone idle", async () => {
    vi.useFakeTimers();

    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    await vi.advanceTimersByTimeAsync(5_001);
    emitWindowEvent("focus");

    const nextSocket = getSocket();
    expect(nextSocket).not.toBe(socket);

    transport.dispose();
  });

  it("probes stale open sockets and reconnects when the probe times out", async () => {
    vi.useFakeTimers();

    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    await vi.advanceTimersByTimeAsync(45_000);
    const pingEnvelope = JSON.parse(socket.sent.at(-1) ?? "{}") as {
      body?: { _tag?: string };
    };
    expect(pingEnvelope.body?._tag).toBe(WS_METHODS.serverPing);

    await vi.advanceTimersByTimeAsync(8_000);
    const nextSocket = getSocket();
    expect(nextSocket).not.toBe(socket);

    transport.dispose();
  });

  it("reconnects immediately when the app becomes visible after being backgrounded", async () => {
    vi.useFakeTimers();

    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    emitVisibilityChange("hidden");
    await vi.advanceTimersByTimeAsync(5_001);
    emitVisibilityChange("visible");

    const nextSocket = getSocket();
    expect(nextSocket).not.toBe(socket);

    transport.dispose();
  });
});
