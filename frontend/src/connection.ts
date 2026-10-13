// One Connection per preview iframe: handshake, request/response with timeouts,
// and filtering out messages from a page load that has since been replaced.
import type { Mode, PageMessage } from "./protocol";

/** A request dropped because the user moved on or the page went away. Never a failure. */
export class Cancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "Cancelled";
  }
}

export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} didn't answer within ${ms / 1000}s`);
    this.name = "TimeoutError";
  }
}

export class ConnectError extends Error {
  constructor() {
    super("The page didn't load, or its script didn't respond within 10s");
    this.name = "ConnectError";
  }
}

// How long a page gets to answer. Past these, it's a failure of that region.
/** Page load until the bridge says "ready" (and again after a navigation). */
export const CONNECT_TIMEOUT = 10_000;
/** Hit tests and keyboard steps: the user is waiting on these. */
export const HIT_TIMEOUT = 1_000;
/** A layers row's children, the top level, and search. */
export const ROW_TIMEOUT = 3_000;

export interface Request<T> {
  promise: Promise<T>;
  cancel(): void;
}

export interface ConnectionHooks {
  getMode(): Mode;
  onReady(c: Connection): void;
  onLeave(c: Connection): void;
  onMessage(c: Connection, m: PageMessage): void;
  /** Any error while handling this preview's messages, or a failed connect. */
  onError(error: unknown): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: number;
}

let nextReqId = 0;

export class Connection {
  readonly screenId: string;
  readonly origin: string;
  /** The current page load, or null while connecting / navigating. */
  docId: string | null = null;
  /** Dev fault: the next message from the page throws in its handler. */
  throwNext = false;

  private hooks: ConnectionHooks;
  private iframe: HTMLIFrameElement | null = null;
  private pending = new Map<number, Pending>();
  private connectTimer = 0;

  constructor(screenId: string, origin: string, hooks: ConnectionHooks) {
    this.screenId = screenId;
    this.origin = origin;
    this.hooks = hooks;
  }

  attach(iframe: HTMLIFrameElement) {
    this.iframe = iframe;
    this.armConnectTimer();
  }

  /** Sent on iframe load, and in answer to "hello". */
  greet() {
    this.send({ type: "init", mode: this.hooks.getMode() });
  }

  owns(e: MessageEvent) {
    return !!this.iframe && e.source === this.iframe.contentWindow && e.origin === this.origin;
  }

  send(msg: Record<string, unknown>) {
    this.iframe?.contentWindow?.postMessage({ figr: 1, ...msg }, this.origin);
  }

  request<T>(type: string, payload: Record<string, unknown>, timeoutMs: number): Request<T> {
    const reqId = ++nextReqId;
    const promise = new Promise<T>((resolve, reject) => {
      if (!this.docId) return reject(new Cancelled());
      const timer = window.setTimeout(() => {
        this.pending.delete(reqId);
        reject(new TimeoutError(`The page (${type})`, timeoutMs));
      }, timeoutMs);
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send({ type, reqId, ...payload });
    });
    return { promise, cancel: () => this.settle(reqId, new Cancelled()) };
  }

  receive(data: unknown) {
    try {
      if (this.throwNext) {
        this.throwNext = false;
        throw new Error("Dev fault: thrown while handling a message from the preview");
      }
      this.dispatch(data as PageMessage);
    } catch (error) {
      this.hooks.onError(error);
    }
  }

  /** Raises an error in this preview's region (cancellations are ignored there). */
  fail(error: unknown) {
    this.hooks.onError(error);
  }

  destroy() {
    clearTimeout(this.connectTimer);
    this.cancelAll();
    this.iframe = null;
  }

  private dispatch(m: PageMessage) {
    if (!m || m.figr !== 1 || typeof m.type !== "string" || typeof m.docId !== "string") return;
    switch (m.type) {
      case "hello":
        this.greet();
        return;
      case "ready":
        if (m.docId === this.docId) return;
        this.cancelAll();
        this.docId = m.docId;
        clearTimeout(this.connectTimer);
        this.hooks.onReady(this);
        return;
    }
    if (m.docId !== this.docId) return; // from a page load that's gone
    if (m.type === "bye") {
      this.docId = null;
      this.cancelAll();
      this.hooks.onLeave(this);
      this.armConnectTimer();
      return;
    }
    if (m.type === "res") {
      const p = this.pending.get(m.reqId);
      if (!p) return; // timed out or cancelled already
      clearTimeout(p.timer);
      this.pending.delete(m.reqId);
      if (m.error === "gone") p.reject(new Cancelled());
      else if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.data);
      return;
    }
    this.hooks.onMessage(this, m);
  }

  private settle(reqId: number, error: unknown) {
    const p = this.pending.get(reqId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(reqId);
    p.reject(error);
  }

  private cancelAll() {
    for (const reqId of [...this.pending.keys()]) this.settle(reqId, new Cancelled());
  }

  private armConnectTimer() {
    clearTimeout(this.connectTimer);
    this.connectTimer = window.setTimeout(() => this.hooks.onError(new ConnectError()), CONNECT_TIMEOUT);
  }
}
