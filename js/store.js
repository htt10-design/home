// Datenspeicher: Live-Zustände + Registries aus Home Assistant.

export class Store extends EventTarget {
  constructor(conn) {
    super();
    this.conn = conn;
    this.states = {};      // entity_id -> {entity_id, state, attributes, last_changed, last_updated} (Zeiten in ms)
    this.areas = [];
    this.floors = [];
    this.devices = {};     // id -> device
    this.entities = {};    // entity_id -> registry entry
    this.config = null;
    this.forecast = { hourly: null, daily: null, entity: null };
    this.loaded = false;
    this._timer = null;
    this._unsubForecast = [];
  }

  /** Änderungen sammeln und höchstens alle 300 ms melden. */
  changed() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.dispatchEvent(new Event("change")); }, 300);
  }

  async start() {
    const c = this.conn;
    await this.loadRegistries();
    // Live-Zustände (erste Nachricht enthält alle Entitäten)
    await c.subscribe({ type: "subscribe_entities" }, ev => this.applyEntityEvent(ev));
    for (const t of ["area_registry_updated", "floor_registry_updated", "device_registry_updated", "entity_registry_updated"]) {
      await c.subscribe({ type: "subscribe_events", event_type: t }, () => this.debouncedRegistryReload());
    }
    // Nach Reconnect: Registries neu laden (Abos erneuert ha.js selbst)
    c.addEventListener("ready", () => this.loadRegistries().catch(() => {}));
  }

  debouncedRegistryReload() {
    clearTimeout(this._regTimer);
    this._regTimer = setTimeout(() => this.loadRegistries().catch(() => {}), 1000);
  }

  async loadRegistries() {
    const c = this.conn;
    const [config, areas, floors, devices, entities] = await Promise.all([
      c.send({ type: "get_config" }),
      c.send({ type: "config/area_registry/list" }),
      c.send({ type: "config/floor_registry/list" }).catch(() => []),   // ältere HA-Versionen
      c.send({ type: "config/device_registry/list" }),
      c.send({ type: "config/entity_registry/list" }),
    ]);
    this.config = config;
    this.areas = areas;
    this.floors = floors;
    this.devices = Object.fromEntries(devices.map(d => [d.id, d]));
    this.entities = Object.fromEntries(entities.map(e => [e.entity_id, e]));
    this.changed();
  }

  applyEntityEvent(ev) {
    if (ev.a) {
      for (const [id, s] of Object.entries(ev.a)) {
        const lc = s.lc * 1000;
        this.states[id] = { entity_id: id, state: s.s, attributes: s.a || {}, last_changed: lc, last_updated: s.lu ? s.lu * 1000 : lc };
      }
    }
    if (ev.c) {
      for (const [id, diff] of Object.entries(ev.c)) {
        const st = this.states[id];
        if (!st) continue;
        const add = diff["+"];
        if (add) {
          if (add.s !== undefined) st.state = add.s;
          if (add.lc) { st.last_changed = st.last_updated = add.lc * 1000; }
          else if (add.lu) st.last_updated = add.lu * 1000;
          if (add.a) st.attributes = { ...st.attributes, ...add.a };
        }
        const rem = diff["-"];
        if (rem?.a) { st.attributes = { ...st.attributes }; for (const k of rem.a) delete st.attributes[k]; }
      }
    }
    if (ev.r) for (const id of ev.r) delete this.states[id];
    if (!this.loaded) { this.loaded = true; this.dispatchEvent(new Event("loaded")); }
    this.changed();
  }

  /** Wettervorhersage abonnieren (stündlich + täglich). */
  async watchForecast(entityId) {
    if (this.forecast.entity === entityId) return;
    for (const u of this._unsubForecast) u();
    this._unsubForecast = [];
    this.forecast = { hourly: null, daily: null, entity: entityId };
    if (!entityId) return;
    for (const type of ["hourly", "daily"]) {
      try {
        const u = await this.conn.subscribe(
          { type: "weather/subscribe_forecast", entity_id: entityId, forecast_type: type },
          ev => { this.forecast[type] = ev.forecast || []; this.changed(); });
        this._unsubForecast.push(u);
      } catch { /* Wetterdienst kann diesen Typ nicht */ }
    }
  }

  // ---- Verläufe ----

  /** Rohverlauf (z. B. 24 h). Ergebnis: {entity_id: [{t: ms, v: number}]} */
  async history(entityIds, hours) {
    const end = new Date(), start = new Date(end - hours * 3600e3);
    const res = await this.conn.send({
      type: "history/history_during_period",
      start_time: start.toISOString(), end_time: end.toISOString(),
      entity_ids: entityIds, minimal_response: true, no_attributes: true, significant_changes_only: false,
    });
    const out = {};
    for (const id of entityIds) {
      out[id] = (res[id] || [])
        .map(p => ({ t: (p.lu ?? p.lc) * 1000, v: parseFloat(p.s) }))
        .filter(p => Number.isFinite(p.v));
    }
    return out;
  }

  /** Statistik (Langzeit). period: 5minute | hour | day | week | month */
  async statistics(ids, start, end, period, types) {
    return this.conn.send({
      type: "recorder/statistics_during_period",
      start_time: start.toISOString(), end_time: end?.toISOString(),
      statistic_ids: ids, period, types,
    });
  }
}
