// Einblendung für eine Steckdose: Leistungsverlauf 24 h mit Läufen, Verbrauch pro Tag (7 Tage).
import { esc, uhr } from "../ui.js";
import { fmt } from "../model.js";
import { leistungChart, balkenChart } from "../chart.js";
import { laeufe, takte, dauer } from "../waechter.js";
import { zeitraum } from "../verlauf.js";
import { energie, loadEnergy, status } from "./geraete.js";

const cache = new Map(); // power entity_id -> {ts, pts, loading, error}
let gezeichnet = "";
export const geraetBlickZuruecksetzen = () => { gezeichnet = ""; };

const BAND = { kuehl: "#9cc3e0", programm: "#f3c98a", normal: "#d8d3c4" };
const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

async function ladeLeistung(ctx, id) {
  const c = cache.get(id);
  if (c && (c.loading || Date.now() - c.ts < 2 * 60e3)) return;
  cache.set(id, { ...(c || {}), loading: true, ts: Date.now() });
  try {
    const h = await ctx.store.history([id], 24);
    cache.set(id, { ts: Date.now(), pts: h[id] || [] });
  } catch (e) {
    cache.set(id, { ts: Date.now(), pts: [], error: e.message });
  }
  ctx.rerender();
}

/** Verlauf + aktueller Live-Wert */
function reihe(p) {
  const c = cache.get(p.powerEntity);
  if (!c?.pts) return null;
  const pts = [...c.pts];
  if (p.power != null && (!pts.length || pts.at(-1).v !== p.power)) pts.push({ t: Date.now() - 1, v: p.power });
  return pts;
}

function laufZeile(l, now) {
  const s = new Date(l.start), tag = s.toDateString() === new Date(now).toDateString() ? "" : WT[s.getDay()] + " ";
  return `<li><span>${tag}${uhr(s)}–${l.ende ? uhr(new Date(l.ende)) : "jetzt"}</span><span>${dauer((l.ende ?? now) - l.start)}</span><b>${fmt(l.kwh, 2)} kWh</b></li>`;
}

export function geraetBlickHtml(ctx, id) {
  const p = ctx.model.plugs.find(x => x.id === id);
  const kopfZu = `<button type="button" class="sh-close" data-close aria-label="Schließen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>`;
  if (!p) return `<div class="sh-band"><div class="grip"></div><div class="sh-head"><h2 id="sheet-title">Nicht gefunden</h2>${kopfZu}</div></div>`;
  const days = zeitraum.days, now = Date.now();
  const e = p.energyEntity ? energie(p.energyEntity) : null;
  const pts = p.powerEntity ? reihe(p) : null;
  const art = p.art || "normal";
  const ls = pts ? laeufe(pts, now, art === "kuehl" ? "kuehl" : "programm").filter(l => (l.ende ?? now) > now - 86400e3) : [];

  let inhalt = "";
  if (days === 1) {
    if (!p.powerEntity) inhalt = `<div class="chart-empty sh-chart">Diese Steckdose misst keine Leistung.</div>`;
    else if (!pts) inhalt = `<div class="chart-empty sh-chart">Lädt …</div>`;
    else {
      const key = `${id}|1`;
      inhalt = `<div class="sh-chart${gezeichnet !== key ? " draw" : ""}">${leistungChart({ pts, laeufe: art === "normal" ? [] : ls, start: now - 86400e3, end: now })}</div>`;
      gezeichnet = key;
      const spitze = Math.max(...pts.filter(x => x.t >= now - 86400e3).map(x => x.v), p.power ?? 0);
      if (art === "programm") {
        inhalt += `<h3>Läufe <span>letzte 24 h</span></h3>${ls.length
          ? `<ul class="laeufe mono">${ls.slice().reverse().map(l => laufZeile(l, now)).join("")}</ul>`
          : `<p class="dim">Kein Lauf in den letzten 24 Stunden.</p>`}`;
      } else if (art === "kuehl") {
        const t = takte(pts, now, now - 86400e3);
        inhalt += `<div class="sh-stats mono">
          <div><span>Laufanteil</span><b>${fmt(t.anteil * 100, 0)} %</b><small>24 h</small></div>
          <div><span>Takte</span><b>${t.anzahl}</b><small>Ø ${dauer(t.dauerSchnitt)}</small></div>
          <div><span>Spitze</span><b>${fmt(spitze, 0)} W</b><small>24 h</small></div>
        </div>
        <p class="dim sh-note">Der Laufanteil ist der Teil der Zeit, in der der Kompressor läuft. Steigt er über Tage deutlich an, lohnt ein Blick auf Türdichtung, Temperaturregler oder Vereisung.</p>`;
      } else {
        const mittel = (() => { // zeitgewichteter Mittelwert
          let s = 0; const von = now - 86400e3;
          for (let i = 0; i < pts.length; i++) { const a = Math.max(pts[i].t, von), b = i === pts.length - 1 ? now : pts[i + 1].t; if (b > a) s += pts[i].v * (b - a); }
          return s / 86400e3;
        })();
        inhalt += `<div class="sh-stats mono">
          <div><span>Ø Leistung</span><b>${fmt(mittel, 0)} W</b><small>24 h</small></div>
          <div><span>Spitze</span><b>${fmt(spitze, 0)} W</b><small>24 h</small></div>
          <div><span>Heute</span><b>${e?.today != null ? fmt(e.today, 2) : "…"}</b><small>kWh</small></div>
        </div>`;
      }
    }
  } else {
    if (!p.energyEntity) inhalt = `<div class="chart-empty sh-chart">Diese Steckdose misst keinen Verbrauch (kWh).</div>`;
    else if (!e?.proTag) inhalt = `<div class="chart-empty sh-chart">Lädt …</div>`;
    else {
      const key = `${id}|7`;
      inhalt = `<div class="sh-chart${gezeichnet !== key ? " draw" : ""}">${balkenChart({ tage: e.proTag, einheit: p.energyUnit })}</div>`;
      gezeichnet = key;
      const woche = e.proTag.filter(d => !d.heute).reduce((s, d) => s + d.v, 0);
      inhalt += `<div class="sh-stats mono">
        <div><span>Ø pro Tag</span><b>${e.schnitt != null ? fmt(e.schnitt, 2) : "–"}</b><small>kWh · ${e.tage} Tage</small></div>
        <div><span>Woche</span><b>${fmt(woche, 1)}</b><small>kWh</small></div>
        <div><span>Hochrechnung</span><b>${e.schnitt != null && e.tage >= 2 ? fmt(e.schnitt * 365, 0) : "–"}</b><small>kWh / Jahr</small></div>
      </div>`;
    }
  }

  return `
  <div class="sh-band" style="--tc:${BAND[art] || BAND.normal}">
    <div class="grip" aria-hidden="true"></div>
    <div class="sh-head">
      <div><span class="mono sh-eyebrow">${esc(p.room ? p.room.toUpperCase() : "STECKDOSE")}${art === "kuehl" ? " · KÜHLGERÄT" : art === "programm" ? " · PROGRAMMGERÄT" : ""}</span><h2 id="sheet-title">${esc(p.name)}</h2></div>
      ${kopfZu}
    </div>
    <div class="sh-vals">
      <div class="sh-temp">${p.unavailable ? "–" : p.power != null ? fmt(p.power, p.power < 10 ? 1 : 0) : p.on ? "an" : "aus"}<sup>${p.power != null && !p.unavailable ? "W" : ""}</sup></div>
      <div class="sh-side mono">
        <span>heute <b>${e?.today != null ? fmt(e.today, 2) : "…"}</b> kWh</span>
        <span>Monat <b>${e?.month != null ? fmt(e.month, 1) : "…"}</b> kWh</span>
      </div>
    </div>
  </div>
  <div class="sh-body">
    ${status(p, e) ? `<div class="plug sh-plugstat">${status(p, e)}</div>` : ""}
    <div class="sh-tools">
      <div class="tabs" role="group" aria-label="Zeitraum"><button type="button" data-days="1" aria-pressed="${days === 1}">24 h</button><button type="button" data-days="7" aria-pressed="${days === 7}">7 T</button></div>
      <div class="legend mono">${days === 1 ? `<span>━ Leistung</span>${art !== "normal" ? `<span>▒ ${art === "kuehl" ? "Kompressor an" : "Lauf"}</span>` : ""}` : "<span>▮ kWh pro Tag</span>"}</div>
    </div>
    ${inhalt}
    ${cache.get(p.powerEntity)?.error ? `<p class="dim">Verlauf konnte nicht geladen werden: ${esc(cache.get(p.powerEntity).error)}</p>` : ""}
  </div>`;
}

export function geraetBlickMount(panel, ctx, id) {
  const p = ctx.model.plugs.find(x => x.id === id);
  if (!p) return;
  if (p.powerEntity) ladeLeistung(ctx, p.powerEntity);
  if (p.energyEntity) loadEnergy(ctx, p.energyEntity);
}
