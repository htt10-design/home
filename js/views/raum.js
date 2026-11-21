// Raumdetail: aktuelle Werte, Bewertung, Verlauf 24 h / 7 Tage, Spanne, Geräte im Raum.
import { esc, tempColor, I, relZeit, uhr } from "../ui.js";
import { fmt } from "../model.js";
import { chart, spanne } from "../chart.js";
import { mountPlugs, plugKarte } from "./geraete.js";

const cache = new Map(); // `${id}|${days}` -> {ts, temp, hum, loading, error}
let days = 1;

async function load(ctx, room) {
  const key = `${room.id}|${days}`;
  const c = cache.get(key);
  if (c && (c.loading || Date.now() - c.ts < 5 * 60e3)) return;
  cache.set(key, { ...(c || {}), loading: true, ts: Date.now() });
  const ids = [room.tempEntity, room.humEntity].filter(Boolean);
  const end = new Date(), start = new Date(end - days * 86400e3);
  let res = { temp: [], hum: [] };
  try {
    if (days === 1) {
      const h = await ctx.store.history(ids, 24);
      res = { temp: h[room.tempEntity] || [], hum: h[room.humEntity] || [] };
    } else {
      const s = await ctx.store.statistics(ids, start, end, "hour", ["mean", "min", "max"]);
      const conv = id => (s[id] || []).filter(p => p.mean != null).map(p => ({ t: p.start + 1800e3, v: p.mean, min: p.min, max: p.max }));
      res = { temp: conv(room.tempEntity), hum: conv(room.humEntity) };
      if (!res.temp.length && !res.hum.length) { // keine Langzeitstatistik → Rohdaten
        const h = await ctx.store.history(ids, days * 24);
        res = { temp: h[room.tempEntity] || [], hum: h[room.humEntity] || [] };
      }
    }
    cache.set(key, { ts: Date.now(), ...res });
  } catch (e) {
    cache.set(key, { ts: Date.now(), temp: [], hum: [], error: e.message });
  }
  ctx.rerender();
}

function findRoom(m, id) {
  if (m.roomById[id]) return m.roomById[id];
  const o = m.outside;
  if (o?.areaId === id) return {
    id, name: o.name, outside: true, temp: o.temp, hum: o.hum, ah: o.ah, tempEntity: o.tempEntity, humEntity: o.humEntity,
    status: { lvl: "none", text: "" }, batteries: [], openings: [], moisture: [], switches: [], hasSensor: true,
  };
  return null;
}

function rail(lo, hi, now, d, u) {
  const a = lo - (hi - lo) * 0.25 - 0.5, b = hi + (hi - lo) * 0.25 + 0.5;
  const pc = v => ((v - a) / (b - a) * 100).toFixed(1);
  return `<div class="rail"><span class="seg2" style="left:${pc(lo)}%;width:${pc(hi) - pc(lo)}%"></span>
    ${now != null ? `<span class="now" style="left:${pc(Math.min(Math.max(now, a), b))}%"></span>` : ""}
    <span class="lo" style="left:${pc(lo)}%">${fmt(lo, d)}${u}</span><span class="hi" style="left:${pc(hi)}%">${fmt(hi, d)}${u}</span></div>`;
}

export const raumView = {
  live: true,
  render(ctx, id) {
    const m = ctx.model, r = findRoom(m, id);
    if (!r) return `<header class="pagehead"><a class="back" href="#haus">${I.back} Haus</a><h1>Raum nicht gefunden</h1></header><p class="dim">Der Bereich wurde in Home Assistant vielleicht umbenannt oder gelöscht.</p>`;
    const floor = m.groups.find(g => g.rooms.includes(r)) || (m.roof?.room === r ? m.roof : null);
    const c = cache.get(`${r.id}|${days}`);
    const now = Date.now();
    const st = r.status, o = m.outside;
    const bat = r.batteries[0];
    const dev = r.device;
    const sub = [dev?.model, bat?.value != null ? `Akku ${Math.round(bat.value)} %` : null, r.lastSeen ? relZeit(r.lastSeen) : null].filter(Boolean).join(" · ");
    const tSp = c?.temp?.length ? spanne(c.temp) : null, hSp = c?.hum?.length ? spanne(c.hum) : null;
    const when = p => days === 1 ? uhr(new Date(p.t)) : new Date(p.t).toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "") + " " + uhr(new Date(p.t)).slice(0, 2) + " h";
    const plugs = m.plugs.filter(p => r.switches.some(s => s.id === p.id));
    let verdict = "";
    if (!r.outside && r.hasSensor && r.ah != null && o?.ah != null) {
      verdict = `<div class="verdict ${st.lvl === "ok" ? "ok" : "warn"}"><b>${esc(st.text)}</b>Innen ${fmt(r.ah)} g/m³, außen ${fmt(o.ah)} g/m³. ${st.vent ? "Die Außenluft ist deutlich trockener – 5–10 Minuten Stoßlüften." : r.ah < o.ah ? "Draußen ist die Luft feuchter." : "Kein Handlungsbedarf."}</div>`;
    } else if (!r.hasSensor) {
      verdict = `<div class="verdict"><b>Kein Sensor in diesem Raum</b>Weise in HA einem Gerät diesen Bereich zu, dann erscheinen hier seine Werte.</div>`;
    }
    const legend = `<div class="legend mono"><span>━ °C</span><span>┅ % rF</span>${days === 1 ? "<span>▒ Nacht</span>" : ""}</div>`;
    return `
    <div class="rtop" style="--tc:${tempColor(r.offline ? null : r.temp)}">
      <a class="back mono" href="#haus">← HAUS${floor?.label ? " / " + esc(floor.label) : ""}</a>
      <div><h1>${esc(r.name)}</h1>${sub ? `<div class="sub mono">${esc(sub)}</div>` : ""}</div>
      ${r.hasSensor ? `<div class="rvals"><div>Temp<b>${fmt(r.temp)}°</b></div><div>rF<b>${fmt(r.hum, 0)}%</b></div><div>abs. g/m³<b>${fmt(r.ah)}</b></div></div>` : ""}
    </div>
    ${verdict}
    ${r.tempEntity || r.humEntity ? `
    <h3>Verlauf <span class="tabs" role="group" aria-label="Zeitraum"><button type="button" data-days="1" aria-pressed="${days === 1}">24 h</button><button type="button" data-days="7" aria-pressed="${days === 7}">7 T</button></span></h3>
    ${c && !c.loading || c?.temp ? chart({ temp: c.temp || [], hum: c.hum || [], start: now - days * 86400e3, end: now, days }) + legend : `<div class="chart-empty">Lädt …</div>`}
    ${c?.error ? `<p class="dim">Verlauf konnte nicht geladen werden: ${esc(c.error)}</p>` : ""}
    ${tSp || hSp ? `<h3>Spanne <span>${days === 1 ? "24 h" : "7 Tage"}</span></h3>
    <div class="range">
      ${tSp ? `<div class="row"><span>TEMP</span>${rail(tSp.lo.v, tSp.hi.v, r.temp, 1, "°")}</div><p class="when mono">min ${when(tSp.lo)} · max ${when(tSp.hi)}</p>` : ""}
      ${hSp ? `<div class="row"><span>rF</span>${rail(hSp.lo.v, hSp.hi.v, r.hum, 0, "%")}</div><p class="when mono">min ${when(hSp.lo)} · max ${when(hSp.hi)}</p>` : ""}
    </div>` : ""}` : ""}
    ${plugs.length ? `<h3>Geräte</h3>${plugs.map(p => plugKarte(p, ctx)).join("")}` : ""}
    <h3>Im Raum</h3>
    <table class="ents">
      ${r.dew != null ? `<tr><td>Taupunkt</td><td>${fmt(r.dew)} °C</td></tr>` : ""}
      ${r.tempEntity ? `<tr><td>Temperatur<small>${esc(r.tempEntity)}</small></td><td>${fmt(r.temp)} °C</td></tr>` : ""}
      ${r.humEntity ? `<tr><td>Luftfeuchte<small>${esc(r.humEntity)}</small></td><td>${fmt(r.hum, 0)} %</td></tr>` : ""}
      ${r.batteries.map(b => `<tr><td>Akku<small>${esc(b.id)}</small></td><td class="${b.value != null && b.value < ctx.settings.akkuKritisch ? "bad" : ""}">${b.value != null ? Math.round(b.value) + " %" : "–"}</td></tr>`).join("")}
      ${r.openings.map(i => `<tr><td>${esc(i.name)}</td><td>${i.st.state === "on" ? "offen" : "zu"}</td></tr>`).join("")}
      ${r.moisture.map(i => `<tr><td>${esc(i.name)}</td><td class="${i.st.state === "on" ? "bad" : ""}">${i.st.state === "on" ? "WASSER" : "trocken"}</td></tr>`).join("")}
    </table>`;
  },
  mount(el, ctx, id) {
    const r = findRoom(ctx.model, id);
    if (!r) return;
    if (r.tempEntity || r.humEntity) load(ctx, r);
    el.querySelectorAll("[data-days]").forEach(b => b.addEventListener("click", () => { days = +b.dataset.days; ctx.rerender(); }));
    mountPlugs(el, ctx);
  },
};

