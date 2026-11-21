// Übersicht: Himmel mit Außenwerten, Haus im Querschnitt, Lüften, Hinweise, Geräte.
import { esc, tempColor, I, datumKopf, uhr, wetterIcon } from "../ui.js";
import { fmt } from "../model.js";
import { lueftenListe } from "./klima.js";
import { hinweisListe } from "./hinweise.js";
import { plugKarte, mountPlugs } from "./geraete.js";

export function roomCell(r, roof = false) {
  const flag = r.status.vent && !r.neben;
  const cls = ["room", r.hasSensor ? "" : "leer", r.offline ? "offline" : "", flag ? "flag" : ""].join(" ");
  return `<a class="${cls}" href="#raum/${encodeURIComponent(r.id)}" style="--tc:${tempColor(r.offline ? null : r.temp)}" aria-label="${esc(r.name)} öffnen">
    <span class="n">${esc(r.name)}</span>
    ${r.hasSensor
      ? `<span class="v">${r.offline ? "offline" : fmt(r.temp) + "°"}</span><span class="h"${roof ? ' style="justify-content:center"' : ""}>${r.hum != null && !r.offline ? I.drop + fmt(r.hum, 0) + "%" : "&nbsp;"}</span>`
      : `<span class="v kein">kein Sensor</span><span class="h">&nbsp;</span>`}
  </a>`;
}

function haus(m) {
  if (!m.groups.length && !m.roof) return `<div class="empty">In Home Assistant sind noch keine Räume angelegt.</div>`;
  const cols = n => n <= 3 ? n : 3;
  return `<div class="house">
    <div class="roof">${m.roof ? roomCell(m.roof.room, true) + `<span class="lvl">${esc(m.roof.label)}</span>` : ""}</div>
    ${m.groups.map(g => `<div class="floor" style="grid-template-columns:repeat(${cols(g.rooms.length)},1fr)">
      ${g.label ? `<span class="lvl">${esc(g.label)}</span>` : ""}${g.rooms.map(r => roomCell(r)).join("")}</div>`).join("")}
    <div class="ground"></div>
  </div>`;
}

function aussen(m) {
  const o = m.outside, w = m.weather;
  const meta = [];
  if (o?.hum != null) meta.push(`<b>${fmt(o.hum, 0)} %</b> rF${o.ah != null ? ` · <b>${fmt(o.ah)}</b> g/m³` : ""}`);
  if (w) {
    const parts = [w.text];
    if (w.min != null && w.max != null) parts.push(`${fmt(w.min)}° / ${fmt(w.max)}°`);
    meta.push(parts.join(" · "));
    if (w.regenAb) meta.push(w.regenAb - Date.now() < 30 * 60e3 ? "Niederschlag jetzt" : `Regen ab ${uhr(w.regenAb).slice(0, 2)} Uhr`);
  } else meta.push(`<span class="dim">kein Wetter in HA</span>`);
  return `<div class="out">
    <div><div class="lbl">${o?.source === "wetter" ? "Außen (Wetterdienst)" : esc(o?.name || "Außen")}</div>
      <div class="t">${o?.temp != null ? fmt(o.temp) : "–"}<sup>°C</sup></div></div>
    <div class="meta">${w ? wetterIcon(w.condition) : ""}${meta.join("<br>")}</div>
  </div>
  ${w?.hourly?.length ? `<div class="hours">${w.hourly.slice(1, 7).map(f => `<div><span>${String(new Date(f.datetime).getHours()).padStart(2, "0")}</span>${wetterIcon(f.condition)}<b>${Math.round(f.temperature)}°</b></div>`).join("")}</div>` : ""}`;
}

export const hausView = {
  live: true,
  render(ctx) {
    const m = ctx.model;
    const vent = lueftenListe(m, ctx.settings);
    return `
    <div class="sky">
      <header class="bar1"><b>Zuhause</b><span class="mono">${datumKopf()} · <span class="conn ${ctx.conn.status}">${ctx.conn.status === "live" ? "● LIVE" : ctx.conn.status === "verbinde" ? "◌ VERBINDE" : "○ OFFLINE"}</span></span>
        <a class="iconbtn" href="#einstellungen" aria-label="Einstellungen">${I.gear}</a></header>
      ${aussen(m)}
      ${haus(m)}
    </div>
    <div class="scale" aria-hidden="true"><span>8°</span><div></div><span>26°</span></div>
    ${m.hasFloors && m.unassignedCount ? `<p class="tip">Tipp: ${m.unassignedCount} ${m.unassignedCount === 1 ? "Raum hat" : "Räume haben"} in HA noch keine Etage („–“). In HA unter Einstellungen → Bereiche &amp; Zonen kannst du sie zuordnen, dann steht das Haus richtig.</p>` : ""}
    <div class="cols">
      <div>
        ${m.alerts.length ? `<h3>Hinweise <span>${m.alerts.length} offen</span></h3>${hinweisListe(m.alerts.slice(0, 3))}${m.alerts.length > 3 ? `<a class="more" href="#hinweise">Alle ${m.alerts.length} Hinweise →</a>` : ""}` : ""}
        <h3>Lüften? <span>absolute Feuchte, Linie = außen</span></h3>
        ${vent}
      </div>
      <div>
        ${m.plugs.length ? `<h3>Geräte <span>${m.plugs.length}</span></h3>${m.plugs.map(p => plugKarte(p, ctx)).join("")}` : ""}
      </div>
    </div>`;
  },
  mount(el, ctx) { mountPlugs(el, ctx); },
};
