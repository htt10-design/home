// Home-Assistant-WebSocket-Client: Anmeldung, Anfragen mit Promise, Abos, Reconnect, Ping.

export class HAError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export class HAConnection extends EventTarget {
  constructor({ url, token }) {
    super();
    this.url = url;
    this.token = token;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();      // id -> {resolve, reject}
    this.subs = new Map();         // id -> {msg, cb}
    this.status = "getrennt";      // getrennt | verbinde | live | fehler
    this.retry = 0;
    this.closedByUser = false;
    this.pingTimer = null;
    this.haVersion = null;
  }

  setStatus(s, detail) {
    this.status = s;
    this.dispatchEvent(new CustomEvent("status", { detail: { status: s, detail } }));
  }

  connect() {
    this.closedByUser = false;
    return new Promise((resolve, reject) => {
      this.setStatus("verbinde");
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { this.setStatus("fehler", e.message); reject(e); return; }
      this.ws = ws;
      let authed = false;

      ws.onmessage = ev => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (!authed) {
          if (msg.type === "auth_required") {
            ws.send(JSON.stringify({ type: "auth", access_token: this.token }));
          } else if (msg.type === "auth_ok") {
            authed = true;
            this.haVersion = msg.ha_version;
            this.retry = 0;
            this.setStatus("live");
            this.startPing();
            this.resubscribe();
            resolve();
            this.dispatchEvent(new Event("ready"));
          } else if (msg.type === "auth_invalid") {
            this.closedByUser = true; // kein Reconnect mit falschem Token
            ws.close();
            const err = new HAError("auth_invalid", msg.message || "Token ungültig");
            this.setStatus("fehler", err.message);
            this.dispatchEvent(new CustomEvent("authinvalid", { detail: err }));
            reject(err);
          }
          return;
        }
        this.handle(msg);
      };

      ws.onerror = () => { /* onclose folgt */ };
      ws.onclose = () => {
        this.stopPing();
        for (const [, p] of this.pending) p.reject(new HAError("closed", "Verbindung getrennt"));
        this.pending.clear();
        if (!authed && !this.closedByUser) reject(new HAError("connect", "Server nicht erreichbar"));
        if (this.closedByUser) { this.setStatus("getrennt"); return; }
        this.setStatus("verbinde");
        this.scheduleReconnect();
      };
    });
  }

  scheduleReconnect() {
    const delays = [1000, 2000, 5000, 10000, 20000, 30000];
    const d = delays[Math.min(this.retry++, delays.length - 1)];
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect().catch(() => {}), d);
  }

  /** Sofort neu verbinden, z. B. wenn die App wieder sichtbar wird. */
  reconnectNow() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) { this.ping(); return; }
    if (this.closedByUser) return;
    clearTimeout(this.reconnectTimer);
    this.retry = 0;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) this.connect().catch(() => {});
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => this.ping(), 30000);
  }
  stopPing() { clearInterval(this.pingTimer); }
  ping() {
    const timeout = setTimeout(() => this.ws?.close(), 10000); // keine Antwort → neu verbinden
    this.send({ type: "ping" }).then(() => clearTimeout(timeout), () => {});
  }

  handle(msg) {
    if (msg.type === "result" || msg.type === "pong") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.type === "pong" || msg.success) p.resolve(msg.result);
      else p.reject(new HAError(msg.error?.code, msg.error?.message || "Fehler"));
    } else if (msg.type === "event") {
      this.subs.get(msg.id)?.cb(msg.event);
    }
  }

  /** Nachricht senden, Antwort als Promise. */
  send(payload) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { reject(new HAError("closed", "Nicht verbunden")); return; }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ ...payload, id }));
    });
  }

  /** Abo anlegen; wird nach einem Reconnect automatisch erneuert. Gibt eine Abmeldefunktion zurück. */
  async subscribe(payload, cb) {
    const entry = { msg: payload, cb, id: null };
    const key = Symbol();
    this.subKeys ??= new Map();
    this.subKeys.set(key, entry);
    if (this.status === "live") await this.activate(entry);
    return async () => {
      this.subKeys.delete(key);
      if (entry.id != null) {
        this.subs.delete(entry.id);
        try { await this.send({ type: "unsubscribe_events", subscription: entry.id }); } catch { /* egal */ }
      }
    };
  }

  async activate(entry) {
    const id = this.nextId;          // send() vergibt genau diese ID
    this.subs.set(id, entry);
    entry.id = id;
    try { await this.send(entry.msg); }
    catch (e) { this.subs.delete(id); entry.id = null; throw e; }
  }

  resubscribe() {
    this.subs.clear();
    for (const entry of this.subKeys?.values() ?? []) this.activate(entry).catch(() => {});
  }

  // ---- Komfort ----
  callService(domain, service, entity_id, data = {}) {
    return this.send({ type: "call_service", domain, service, target: { entity_id }, service_data: data });
  }
}

/** Standard-Adresse: gleicher Server wie die App. */
export function defaultWsUrl(base) {
  const u = new URL(base || location.origin);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/api/websocket";
  u.search = ""; u.hash = "";
  return u.toString();
}
