// Aus Rohdaten (Store) + Einstellungen das App-Modell ableiten: Räume, Etagen, Außen, Geräte, Hinweise.
import { absoluteFeuchte, taupunkt } from "./physik.js";

const AUSSEN_RE = /terr?asse|garten|balkon|au(ß|ss)en|drau(ß|ss)en|hof|outdoor/i;
const NEBEN_RE = /dachboden|speicher|keller|garage|abstell|schuppen|heizungsraum/i;
const DACH_RE = /dach|speicher|^dg$/i;
const OFFEN_KLASSEN = ["window", "door", "opening", "garage_door"];

export const num = s => {
  if (!s || s.state === "unavailable" || s.state === "unknown") return null;
  const v = parseFloat(s.state);
  return Number.isFinite(v) ? v : null;
};
const unavailable = s => !s || s.state === "unavailable" || s.state === "unknown";

/** Kurzlabel für die Etagenanzeige am Haus */
export function etagenLabel(name) {
  const n = (name || "").trim();
  const map = [[/^erdgescho/i, "EG"], [/^obergescho/i, "OG"], [/^dach/i, "DG"], [/^keller|^untergescho/i, "KG"], [/^souterrain/i, "UG"]];
  for (const [re, l] of map) if (re.test(n)) return l;
  return n.length <= 4 ? n.toUpperCase() : n;
}

export const WETTER = {
  "clear-night": "Klar", cloudy: "Bedeckt", exceptional: "Unwetter", fog: "Nebel", hail: "Hagel",
  lightning: "Gewitter", "lightning-rainy": "Gewitter mit Regen", partlycloudy: "Teilweise bewölkt",
  pouring: "Starkregen", rainy: "Regen", snowy: "Schnee", "snowy-rainy": "Schneeregen",
  sunny: "Sonnig", windy: "Windig", "windy-variant": "Windig, bewölkt",
};
const NASS = new Set(["rainy", "pouring", "snowy", "snowy-rainy", "hail", "lightning-rainy"]);

export function buildModel(store, set) {
  const { states, entities, devices } = store;
  const now = Date.now();
  const areaName = Object.fromEntries(store.areas.map(a => [a.area_id, a.name]));

  // --- Entitäten nach Raum gruppieren ---
  const byArea = {};
  const all = [];
  for (const e of Object.values(entities)) {
    if (e.disabled_by || e.hidden_by) continue;
    const st = states[e.entity_id];
    if (!st) continue;
    const dev = e.device_id ? devices[e.device_id] : null;
    if (dev?.disabled_by) continue;
    const area = e.area_id ?? dev?.area_id ?? null;
    const item = {
      id: e.entity_id, domain: e.entity_id.split(".")[0], reg: e, dev, area, st,
      dc: st.attributes.device_class, cat: e.entity_category, platform: e.platform,
      name: e.name || st.attributes.friendly_name || e.original_name || e.entity_id,
    };
    all.push(item);
    if (area) (byArea[area] ??= []).push(item);
  }
  const pick = (list, domain, dc) => list
    .filter(i => i.domain === domain && i.dc === dc && !i.cat)
    .sort((a, b) => (unavailable(a.st) - unavailable(b.st)) || a.id.localeCompare(b.id))[0] || null;

  // --- Außenbereich ---
  let aussenId = set.aussenBereich && areaName[set.aussenBereich] ? set.aussenBereich : null;
  if (!aussenId) aussenId = store.areas.find(a => AUSSEN_RE.test(a.name) && byArea[a.area_id]?.some(i => i.dc === "temperature"))?.area_id ?? null;
  if (!aussenId) aussenId = Object.keys(byArea).find(id => byArea[id].some(i => i.dc === "temperature" && /draussen|aussen|outdoor/.test(i.id))) ?? null;

  // --- Wetter ---
  const wetterIds = Object.keys(states).filter(id => id.startsWith("weather."));
  const wetterId = set.wetter && states[set.wetter] ? set.wetter : wetterIds[0] || null;
  const wst = wetterId ? states[wetterId] : null;
  const weather = wst ? {
    id: wetterId, condition: wst.state, text: WETTER[wst.state] || wst.state,
    temp: wst.attributes.temperature, hum: wst.attributes.humidity,
    hourly: store.forecast.entity === wetterId ? store.forecast.hourly : null,
    daily: store.forecast.entity === wetterId ? store.forecast.daily : null,
  } : null;
  if (weather) {
    const h = weather.hourly || [];
    const nass = h.slice(0, 24).find(f => NASS.has(f.condition) || (f.precipitation ?? 0) >= 0.2);
    weather.regenAb = nass ? new Date(nass.datetime) : null;
    const today = (weather.daily || [])[0];
    weather.min = today?.templow ?? null;
    weather.max = today?.temperature ?? null;
  }

  // --- Außenwerte ---
  let outside = null;
  if (aussenId) {
    const list = byArea[aussenId] || [];
    const te = pick(list, "sensor", "temperature"), he = pick(list, "sensor", "humidity");
    outside = { areaId: aussenId, name: areaName[aussenId], temp: num(te?.st), hum: num(he?.st), tempEntity: te?.id, humEntity: he?.id, source: "sensor" };
  }
  if ((!outside || outside.temp == null) && weather?.temp != null) {
    outside = { ...(outside || {}), temp: weather.temp, hum: outside?.hum ?? weather.hum, source: "wetter" };
  }
  if (outside && outside.temp != null && outside.hum != null) outside.ah = absoluteFeuchte(outside.temp, outside.hum);

  // --- Räume ---
  const nebenSet = new Set(set.nebenraeume ?? store.areas.filter(a => NEBEN_RE.test(a.name)).map(a => a.area_id));
  const hiddenSet = new Set(set.ausgeblendet || []);
  const rooms = [];
  for (const a of store.areas) {
    if (a.area_id === aussenId) continue;
    const list = byArea[a.area_id] || [];
    const te = pick(list, "sensor", "temperature"), he = pick(list, "sensor", "humidity");
    const temp = num(te?.st), hum = num(he?.st);
    const primary = [te, he].filter(Boolean);
    const lastSeen = primary.length ? Math.max(...primary.map(i => i.st.last_updated)) : null;
    const offline = primary.length > 0 && (primary.every(i => unavailable(i.st)) || now - lastSeen > set.offlineStunden * 3600e3);
    const room = {
      id: a.area_id, name: a.name, floorId: a.floor_id || null, icon: a.icon,
      neben: nebenSet.has(a.area_id), hidden: hiddenSet.has(a.area_id),
      temp, hum, tempEntity: te?.id || null, humEntity: he?.id || null,
      ah: temp != null && hum != null ? absoluteFeuchte(temp, hum) : null,
      dew: temp != null && hum != null ? taupunkt(temp, hum) : null,
      batteries: list.filter(i => i.dc === "battery" && i.domain === "sensor").map(i => ({ id: i.id, value: num(i.st), dev: i.dev })),
      openings: list.filter(i => i.domain === "binary_sensor" && OFFEN_KLASSEN.includes(i.dc)),
      moisture: list.filter(i => i.domain === "binary_sensor" && i.dc === "moisture"),
      switches: list.filter(i => i.domain === "switch" && !i.cat),
      device: (te || he)?.dev || null,
      hasSensor: primary.length > 0, lastSeen, offline,
    };
    room.status = roomStatus(room, outside, set);
    rooms.push(room);
  }

  // --- Etagen (oben → unten) ---
  const visible = rooms.filter(r => !r.hidden);
  const floorsSorted = [...store.floors].sort((a, b) => (b.level ?? -99) - (a.level ?? -99));
  const groups = [];
  for (const f of floorsSorted) {
    const fr = visible.filter(r => r.floorId === f.floor_id);
    if (fr.length) groups.push({ id: f.floor_id, name: f.name, label: etagenLabel(f.name), rooms: fr });
  }
  const noFloor = visible.filter(r => !r.floorId || !store.floors.some(f => f.floor_id === r.floorId));
  if (noFloor.length) groups.push({ id: null, name: groups.length ? "Ohne Etage" : "", label: groups.length ? "–" : "", rooms: noFloor, unassigned: true });
  let roof = null;
  const top = groups[0];
  if (top && groups.length > 1 && top.rooms.length === 1 && (DACH_RE.test(top.name) || DACH_RE.test(top.label) || /dachboden|speicher/i.test(top.rooms[0].name))) {
    roof = { ...top, room: top.rooms[0] };
    groups.shift();
  }

  // --- Geräte (Steckdosen/Schalter) ---
  const plugs = all.filter(i => i.domain === "switch" && !i.cat && i.platform !== "mobile_app").map(i => {
    const siblings = i.dev ? all.filter(o => o.dev?.id === i.dev.id && o.domain === "sensor") : [];
    const pw = siblings.find(o => o.dc === "power"), en = siblings.find(o => o.dc === "energy");
    return {
      id: i.id, name: i.dev?.name_by_user || i.name, on: i.st.state === "on", unavailable: unavailable(i.st),
      room: i.area ? areaName[i.area] : null, power: num(pw?.st), powerEntity: pw?.id, energyEntity: en?.id, energyTotal: num(en?.st),
      energyUnit: en?.st.attributes.unit_of_measurement || "kWh",
    };
  });

  // --- Hinweise ---
  const alerts = [];
  const deviceName = (dev, fallback) => dev?.name_by_user || dev?.name || fallback;
  for (const i of all) {
    if (i.platform === "mobile_app") continue;
    const where = i.area ? areaName[i.area] : "ohne Raum";
    if (i.domain === "sensor" && i.dc === "battery") {
      const v = num(i.st);
      if (v != null && v < set.akkuNiedrig) alerts.push({
        lvl: v < set.akkuKritisch ? "crit" : "warn", kind: "BAT", area: i.area,
        title: `${where}: Akku ${Math.round(v)} %`, sub: deviceName(i.dev, i.name), since: i.st.last_changed,
      });
    }
    if (i.domain === "binary_sensor" && i.dc === "moisture" && i.st.state === "on") {
      alerts.push({ lvl: "crit", kind: "H₂O", area: i.area, title: `${where}: Wasser erkannt!`, sub: i.name, since: i.st.last_changed });
    }
    if (i.domain === "binary_sensor" && OFFEN_KLASSEN.includes(i.dc) && i.st.state === "on") {
      alerts.push({ lvl: "info", kind: "AUF", area: i.area, title: `${where}: ${i.name} offen`, sub: "", since: i.st.last_changed });
    }
  }
  for (const r of rooms) {
    if (r.hidden) continue;
    if (r.offline) alerts.push({ lvl: "warn", kind: "OFF", area: r.id, title: `${r.name}: Sensor meldet sich nicht`, sub: deviceName(r.device, ""), since: r.lastSeen });
    else if (r.hum != null && r.hum > set.feuchteSehrHoch) alerts.push({ lvl: "warn", kind: "rF", area: r.id, title: `${r.name}: ${fmt(r.hum, 0)} % Luftfeuchte`, sub: r.status.vent ? "Lüften hilft" : "Lüften bringt gerade wenig", since: store.states[r.humEntity]?.last_changed });
  }
  if (outside?.areaId) {
    const ar = byArea[outside.areaId] || [];
    const primary = ar.filter(i => ["temperature", "humidity"].includes(i.dc) && i.domain === "sensor" && !i.cat);
    if (primary.length && primary.every(i => unavailable(i.st))) alerts.push({ lvl: "warn", kind: "OFF", area: outside.areaId, title: `${outside.name}: Außensensor meldet sich nicht`, sub: "", since: null });
  }
  const order = { crit: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => order[a.lvl] - order[b.lvl] || (b.since || 0) - (a.since || 0));

  return {
    rooms, roomById: Object.fromEntries(rooms.map(r => [r.id, r])), groups, roof,
    hasFloors: store.floors.length > 0, unassignedCount: noFloor.length,
    outside, weather, wetterIds, plugs, alerts, areas: store.areas,
  };
}

/** Raumklima bewerten: Ampelstufe, Text, Lüftungsempfehlung. */
export function roomStatus(r, outside, set) {
  if (!r.hasSensor) return { lvl: "none", text: "Kein Sensor", vent: false };
  if (r.offline) return { lvl: "warn", text: "Sensor offline", vent: false };
  if (r.hum == null) return { lvl: "ok", text: "", vent: false };
  const diff = outside?.ah != null && r.ah != null ? r.ah - outside.ah : null;
  const helps = diff != null && diff >= set.lueftenDiff;
  const worse = diff != null && diff < 0;
  if (r.hum > set.feuchteSehrHoch) return { lvl: "alert", text: helps ? "Sehr feucht – lüften" : worse ? "Sehr feucht, draußen noch feuchter" : "Sehr feucht, Lüften bringt wenig", vent: helps, diff };
  if (r.hum > set.feuchteHoch) return helps
    ? { lvl: "orange", text: "Lüften empfohlen", vent: true, diff }
    : { lvl: "warn", text: worse ? "Feucht, draußen feuchter – nicht lüften" : diff == null ? "Feucht" : "Feucht, Lüften bringt wenig", vent: false, diff };
  if (r.hum < set.feuchteNiedrig) return { lvl: "warn", text: "Trocken", vent: false, diff };
  return { lvl: "ok", text: "Gutes Raumklima", vent: false, diff };
}

export const fmt = (v, d = 1) => v == null || !Number.isFinite(v) ? "–" : v.toFixed(d).replace(".", ",");
