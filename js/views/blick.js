// „Blick“: Einblendung über dem Haus mit Temperaturverlauf eines Raums oder von draußen.
// Handy: Blatt fährt von unten hoch (nach unten wischen schließt). Tablet: Leiste von rechts.
import { esc, tempColor, uhr, wetterIcon } from "../ui.js";
import { fmt } from "../model.js";
import { chart, spanne } from "../chart.js";
import { findRoom, verlauf, ladeVerlauf, zeitraum, bisJetzt } from "../verlauf.js";

const VORHERSAGE_H = 12;
let gezeichnet = ""; // Diagramm nur beim ersten Erscheinen animieren
export const blickZuruecksetzen = () => { gezeichnet = ""; };

function etage(m, r) {
  if (r.outside) return "DRAUSSEN";
  if (m.roof?.room === r) return m.roof.label || "DACH";
  const g = m.groups.find(g => g.rooms.includes(r));
  return g?.label && g.label !== "–" ? g.label : "RAUM";
}

/** Stündliche Vorhersage als Reihe für die nächsten Stunden */
function vorhersage(m) {
  const h = m.weather?.hourly;
  if (!h?.length) return [];
  const now = Date.now();
  return h.map(f => ({ t: Date.parse(f.datetime), v: f.temperature }))
    .filter(p => p.t > now - 1800e3 && p.t <= now + VORHERSAGE_H * 3600e3 && Number.isFinite(p.v));
}

function zeit(p, days) {
  const d = new Date(p.t);
  return days === 1 ? uhr(d) : d.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "") + " " + String(d.getHours()).padStart(2, "0") + " h";
}

export function blickHtml(ctx, id) {
  const m = ctx.model, r = findRoom(m, id);
  if (!r) return `<div class="sh-band"><div class="grip"></div><div class="sh-head"><h2 id="sheet-title">Nicht gefunden</h2><button type="button" class="sh-close" data-close aria-label="Schließen">✕</button></div></div>`;
  const days = zeitraum.days, c = verlauf(r, days), now = Date.now();
  const fc = r.outside && days === 1 ? vorhersage(m) : [];
  const end = fc.length ? fc.at(-1).t : now;
  const temp = c?.temp ? bisJetzt(c.temp, r.temp) : [], hum = c?.hum ? bisJetzt(c.hum, r.hum) : [];
  const tSp = temp.length ? spanne(temp) : null, hSp = hum.length ? spanne(hum) : null;
  const wx = r.outside ? m.weather : null;

  let fuss = "";
  if (r.outside) {
    const teile = [];
    if (wx) teile.push(`${wetterIcon(wx.condition)}<span><b>${esc(wx.text)}</b>${wx.min != null ? ` · heute ${fmt(wx.min)}° bis ${fmt(wx.max)}°` : ""}${wx.regenAb ? ` · Regen ab ${String(wx.regenAb.getHours()).padStart(2, "0")} Uhr` : ""}</span>`);
    if (fc.length) {
      const in6 = fc.find(p => p.t >= now + 6 * 3600e3) || fc.at(-1);
      const diff = in6.v - (r.temp ?? in6.v);
      teile.push(`<span class="dim">In ${Math.round((in6.t - now) / 3600e3)} Stunden ${fmt(in6.v)}° (${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff))}°).</span>`);
    }
    fuss = teile.length ? `<div class="sh-wx">${teile.join("")}</div>` : "";
  } else if (r.hasSensor && r.status.text) {
    fuss = `<div class="sh-status ${r.status.lvl}"><b>${esc(r.status.text)}</b>${r.dew != null ? `<span class="mono">Taupunkt ${fmt(r.dew)}°</span>` : ""}</div>`;
  }

  return `
  <div class="sh-band" style="--tc:${tempColor(r.offline ? null : r.temp)}">
    <div class="grip" aria-hidden="true"></div>
    <div class="sh-head">
      <div><span class="mono sh-eyebrow">${esc(etage(m, r))}</span><h2 id="sheet-title">${esc(r.name)}</h2></div>
      <button type="button" class="sh-close" data-close aria-label="Schließen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
    </div>
    <div class="sh-vals">
      <div class="sh-temp">${r.temp != null && !r.offline ? fmt(r.temp) : "–"}<sup>°C</sup></div>
      <div class="sh-side mono">
        <span>rF <b>${fmt(r.hum, 0)} %</b></span>
        <span>abs. <b>${fmt(r.ah)}</b> g/m³</span>
      </div>
    </div>
  </div>
  <div class="sh-body">
    <div class="sh-tools">
      <div class="tabs" role="group" aria-label="Zeitraum"><button type="button" data-days="1" aria-pressed="${days === 1}">24 h</button><button type="button" data-days="7" aria-pressed="${days === 7}">7 T</button></div>
      <div class="legend mono"><span>━ °C</span><span>┅ % rF</span>${fc.length ? "<span>╍ Vorhersage</span>" : ""}</div>
    </div>
    ${!c || (c.loading && !c.temp) ? `<div class="chart-empty sh-chart">Lädt …</div>`
      : `<div class="sh-chart${gezeichnet !== `${r.id}|${days}` ? " draw" : ""}">${(gezeichnet = `${r.id}|${days}`, "")}${chart({ temp, hum, forecast: fc, start: now - days * 86400e3, end, now, days, marks: true })}</div>`}
    ${c?.error ? `<p class="dim">Verlauf konnte nicht geladen werden: ${esc(c.error)}</p>` : ""}
    ${tSp ? `<div class="sh-stats mono">
      <div><span>Tiefst</span><b>${fmt(tSp.lo.v)}°</b><small>${zeit(tSp.lo, days)}</small></div>
      <div><span>Höchst</span><b>${fmt(tSp.hi.v)}°</b><small>${zeit(tSp.hi, days)}</small></div>
      ${hSp ? `<div><span>Feuchte</span><b>${fmt(hSp.lo.v, 0)}–${fmt(hSp.hi.v, 0)}%</b><small>${days === 1 ? "24 h" : "7 Tage"}</small></div>` : ""}
    </div>` : ""}
    ${fuss}
    <a class="btn ghost sh-more" href="#raum/${encodeURIComponent(r.id)}">Alle Details →</a>
  </div>`;
}

export function blickMount(panel, ctx, id) {
  const r = findRoom(ctx.model, id);
  if (r && (r.tempEntity || r.humEntity)) ladeVerlauf(ctx.store, r, zeitraum.days, ctx.rerender);
  panel.querySelectorAll("[data-days]").forEach(b => b.addEventListener("click", () => {
    zeitraum.days = +b.dataset.days;
    ctx.rerender();
  }));
}
