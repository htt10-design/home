// Verläufe laden und zwischenspeichern (gemeinsam für Raumseite und Einblendung).

const cache = new Map(); // `${id}|${days}` -> {ts, temp, hum, loading, error}
const MAX_ALTER = 5 * 60e3;

/** Gewählter Zeitraum (1 = 24 h, 7 = 7 Tage), gilt für Raumseite und Einblendung. */
export const zeitraum = { days: 1 };

/** Raum oder Außenbereich anhand der Bereichs-ID finden. */
export function findRoom(m, id) {
  if (m.roomById[id]) return m.roomById[id];
  const o = m.outside;
  if (o?.areaId === id) return {
    id, name: o.name, outside: true, temp: o.temp, hum: o.hum, ah: o.ah, tempEntity: o.tempEntity, humEntity: o.humEntity,
    status: { lvl: "none", text: "" }, batteries: [], openings: [], moisture: [], switches: [], hasSensor: true,
  };
  return null;
}

/** Zwischengespeicherte Daten (oder undefined). */
export const verlauf = (room, days) => cache.get(`${room.id}|${days}`);

/** Lädt bei Bedarf nach und ruft danach onDone auf. */
export async function ladeVerlauf(store, room, days, onDone) {
  const key = `${room.id}|${days}`;
  const c = cache.get(key);
  if (c && (c.loading || Date.now() - c.ts < MAX_ALTER)) return;
  cache.set(key, { ...(c || {}), loading: true, ts: Date.now() });
  const ids = [room.tempEntity, room.humEntity].filter(Boolean);
  const end = new Date(), start = new Date(end - days * 86400e3);
  let res = { temp: [], hum: [] };
  try {
    if (days === 1) {
      const h = await store.history(ids, 24);
      res = { temp: h[room.tempEntity] || [], hum: h[room.humEntity] || [] };
    } else {
      const s = await store.statistics(ids, start, end, "hour", ["mean", "min", "max"]);
      const conv = id => (s[id] || []).filter(p => p.mean != null).map(p => ({ t: p.start + 1800e3, v: p.mean }));
      res = { temp: conv(room.tempEntity), hum: conv(room.humEntity) };
      if (!res.temp.length && !res.hum.length) { // keine Langzeitstatistik → Rohdaten
        const h = await store.history(ids, days * 24);
        res = { temp: h[room.tempEntity] || [], hum: h[room.humEntity] || [] };
      }
    }
    cache.set(key, { ts: Date.now(), ...res });
  } catch (e) {
    cache.set(key, { ts: Date.now(), temp: [], hum: [], error: e.message });
  }
  onDone?.();
}

/** Letzten Live-Wert an die Reihe hängen, damit die Linie bis „jetzt“ reicht. */
export function bisJetzt(pts, v) {
  if (v == null || !pts.length) return pts;
  return [...pts, { t: Date.now(), v }];
}
