import { describe, it, expect, beforeEach } from "vitest";
import { createHubWS, type HubWSHandle } from "@/api/hubWS";
import type { Transport, TransportStatus } from "@/api/transport";
import { HUB_EVENTS } from "@shared/hubEvents";

interface MockTransport extends Transport {
  _setStatus(s: TransportStatus): void;
  _deliverMessage(data: unknown): void;
  _sent: unknown[];
  _closed: boolean;
}

function mockTransport(): MockTransport {
  const statusListeners = new Set<(s: TransportStatus) => void>();
  const msgListeners = new Set<(data: unknown) => void>();
  const sent: unknown[] = [];
  let closed = false;
  let status: TransportStatus = "disconnected";

  const t: MockTransport = {
    _sent: sent,
    get _closed() { return closed; },
    set _closed(v) { closed = v; },

    connect() {
      sent.length = 0;
      status = "connecting";
      for (const h of statusListeners) h("connecting");
      status = "connected";
      for (const h of statusListeners) h("connected");
    },

    send(data: unknown) { sent.push(data); },

    close() {
      closed = true;
      status = "disconnected";
      for (const h of statusListeners) h("disconnected");
    },

    getStatus() { return status; },

    on(evt: string, handler: (d: unknown) => void): () => void {
      if (evt === "status") {
        const wrapped = handler as (s: TransportStatus) => void;
        statusListeners.add(wrapped);
        return () => { statusListeners.delete(wrapped); };
      }
      msgListeners.add(handler);
      return () => { msgListeners.delete(handler); };
    },

    _setStatus(s: TransportStatus) {
      status = s;
      for (const h of statusListeners) h(s);
    },

    _deliverMessage(data: unknown) {
      for (const h of msgListeners) h(data);
    },
  };
  return t;
}

function token(valid = true): () => string | null {
  return valid ? () => "test-token" : () => null;
}

describe("createHubWS", () => {
  let t: MockTransport;
  let h: HubWSHandle;

  function init(validToken = true) {
    t = mockTransport();
    h = createHubWS({ transport: t as unknown as Transport, getToken: token(validToken) });
    h.connect();
  }

  it("sends auth frame on connect with valid token", () => {
    init();
    const auth = t._sent.find(
      (m) => (m as Record<string, unknown>).type === HUB_EVENTS.AUTH,
    );
    expect(auth).toBeDefined();
    expect((auth as Record<string, unknown>).payload).toEqual({ access_token: "test-token" });
  });

  it("skips auth when token is null", () => {
    init(false);
    const authFrames = t._sent.filter(
      (m) => (m as Record<string, unknown>).type === HUB_EVENTS.AUTH,
    );
    expect(authFrames.length).toBe(0);
  });

  it("calls onAuthSuccess on auth.ok", () => {
    let ok = false;
    t = mockTransport();
    h = createHubWS({
      transport: t as unknown as Transport,
      getToken: token(),
      onAuthSuccess: () => { ok = true; },
    });
    h.connect();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    expect(ok).toBe(true);
  });

  it("calls onAuthFail on auth.fail", () => {
    let reason = "";
    t = mockTransport();
    h = createHubWS({
      transport: t as unknown as Transport,
      getToken: token(),
      onAuthFail: (r) => { reason = r; },
    });
    h.connect();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_FAIL, payload: { reason: "expired" } });
    expect(reason).toBe("expired");
  });

  it("routes typed events to on() handlers", () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    let payload: unknown = null;
    h.on(HUB_EVENTS.MESSAGE_NEW, (p) => { payload = p; });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: { content: "hi" } });
    expect(payload).toEqual({ content: "hi" });
  });

  it("routes events to onAny()", () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    const events: string[] = [];
    h.onAny((type) => { events.push(type); });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(events).toEqual([HUB_EVENTS.MESSAGE_NEW]);
  });

  it("drops app events before auth.ok", () => {
    init();
    let called = false;
    h.on(HUB_EVENTS.MESSAGE_NEW, () => { called = true; });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(called).toBe(false);
  });

  it("delivers after auth.ok", () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    let called = false;
    h.on(HUB_EVENTS.MESSAGE_NEW, () => { called = true; });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(called).toBe(true);
  });

  it("skips non-object and null messages", () => {
    init();
    let called = false;
    h.onAny(() => { called = true; });
    t._deliverMessage("string");
    t._deliverMessage(null);
    t._deliverMessage(42);
    expect(called).toBe(false);
  });

  it("send wraps in {type, payload}", () => {
    init();
    h.send("typing", { session_id: "x" });
    const last = t._sent[t._sent.length - 1];
    expect(last).toEqual({ type: "typing", payload: { session_id: "x" } });
  });

  it("sendTyping dispatches typing frame", () => {
    init();
    h.sendTyping("s1");
    const last = t._sent[t._sent.length - 1];
    expect(last).toEqual({ type: "typing", payload: { session_id: "s1" } });
  });

  it("close shuts down transport", () => {
    init();
    h.close();
    expect(t._closed).toBe(true);
  });

  it("reconnect sends new auth", () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    h.reconnect();
    const last = t._sent[t._sent.length - 1];
    expect((last as Record<string, unknown>).type).toBe(HUB_EVENTS.AUTH);
  });

  it("on() unsub stops delivery", () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    let n = 0;
    const unsub = h.on(HUB_EVENTS.MESSAGE_NEW, () => { n++; });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(n).toBe(1);
    unsub();
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(n).toBe(1);
  });

  it("onAny() unsub stops delivery", () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    let n = 0;
    const unsub = h.onAny(() => { n++; });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(n).toBe(1);
    unsub();
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(n).toBe(1);
  });

  it("drops events after transport disconnect", () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    t._setStatus("disconnected");
    let called = false;
    h.on(HUB_EVENTS.MESSAGE_NEW, () => { called = true; });
    t._deliverMessage({ type: HUB_EVENTS.MESSAGE_NEW, payload: {} });
    expect(called).toBe(false);
  });

  it("sends auth on transport reconnect", () => {
    init();
    t._deliverMessage({ type: HUB_EVENTS.AUTH_OK });
    t._setStatus("disconnected");
    const before = t._sent.filter(
      (m) => (m as Record<string, unknown>).type === HUB_EVENTS.AUTH,
    ).length;
    t._setStatus("connected");
    const after = t._sent.filter(
      (m) => (m as Record<string, unknown>).type === HUB_EVENTS.AUTH,
    ).length;
    expect(after).toBeGreaterThan(before);
  });

  it("onStatus forwards transport status", () => {
    init();
    const statuses: TransportStatus[] = [];
    h.onStatus((s) => statuses.push(s));
    t._setStatus("reconnecting");
    expect(statuses).toContain("reconnecting");
  });

  it("onStatus unsub stops notifications", () => {
    init();
    let n = 0;
    const unsub = h.onStatus(() => { n++; });
    t._setStatus("reconnecting");
    expect(n).toBe(1);
    unsub();
    t._setStatus("connected");
    expect(n).toBe(1);
  });

  it("getStatus reflects transport", () => {
    init();
    t._setStatus("connecting");
    expect(h.getStatus()).toBe("connecting");
  });
});