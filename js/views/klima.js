// Klima: Innen/Außen-Vergleich über die absolute Feuchte, Lüftungsempfehlung je Raum.
import { esc } from "../ui.js";
import { fmt } from "../model.js";

export function lueftenListe(m, set, ausfuehrlich = false) {
  const o = m.outside;
  const rooms = m.rooms.filter(r => !r.hidden && r.ah != null && !r.offline).sort((a, b) => b.ah - a.ah);
  if (!rooms.length) return `<p class="dim">Noch keine Räume mit Temperatur und Feuchte.</p>`;
  if (o?.ah == null) return `<p class="dim">Für die Lüftungsempfehlung fehlt ein Außensensor mit Temperatur und Feuchte (Einstellungen → Außenbereich).</p>`;
  const max = Math.max(o.ah, ...rooms.map(r => r.ah)) * 1.1;
  return `<div class="ah">${rooms.map(r => {
    const go = r.status.vent;
    const wenig = !go && r.hum > set.feuchteHoch;
    const label = go ? "LÜFTEN" : r.ah < o.ah ? "drinnen trockener" : wenig ? "bringt wenig" : "ok";
    return `<a class="ahrow" href="#raum/${encodeURIComponent(r.id)}">
      <span class="nm">${esc(r.name)}${ausfuehrlich ? `<small>${fmt(r.temp)}° · ${fmt(r.hum, 0)} %</small>` : ""}</span>
      <span class="track"><span style="width:${(r.ah / max * 100).toFixed(1)}%"></span><span class="ref" style="left:${(o.ah / max * 100).toFixed(1)}%"></span></span>
      <span class="r ${go ? "go" : ""}">${fmt(r.ah)} ${label}</span></a>`;
  }).join("")}
  <div class="ahrow out"><span class="nm">Außen${ausfuehrlich ? `<small>${fmt(o.temp)}° · ${fmt(o.hum, 0)} %</small>` : ""}</span><span class="track"><span class="refbar" style="width:${(o.ah / max * 100).toFixed(1)}%"></span></span><span class="r">${fmt(o.ah)} g/m³</span></div>
  </div>`;
}

export const klimaView = {
  live: true,
  render(ctx) {
    const m = ctx.model, s = ctx.settings;
    const go = m.rooms.filter(r => !r.hidden && r.status.vent);
    return `
    <header class="pagehead"><h1>Klima</h1><p class="mono dim">INNEN ↔ AUSSEN</p></header>
    <div class="verdict ${go.length ? "warn" : ""}">
      <b>${go.length ? `Lüften lohnt sich: ${go.map(r => esc(r.name)).join(", ")}` : "Gerade muss nirgends gelüftet werden"}</b>
      ${go.length ? `5–10 Minuten Stoßlüften (Fenster ganz auf), danach wieder schließen.` : `Keiner der Räume liegt über ${s.feuchteHoch} % mit deutlich feuchterer Luft als draußen.`}
    </div>
    <h3>Absolute Feuchte <span>g/m³</span></h3>
    ${lueftenListe(m, s, true)}
    <h3>So wird gerechnet</h3>
    <div class="prose">
      <p>Die relative Feuchte allein sagt nicht, ob Lüften hilft: Kalte Außenluft mit 90 % enthält oft viel weniger Wasser als warme Raumluft mit 60 %. Die App rechnet deshalb beide Werte in Gramm Wasser pro Kubikmeter Luft um.</p>
      <p><b>Lüften empfohlen</b>, wenn ein Raum über ${s.feuchteHoch} % liegt und mindestens ${fmt(s.lueftenDiff)} g/m³ mehr Wasser enthält als die Außenluft. Ist der Unterschied kleiner, bringt Lüften wenig. Ist es draußen absolut feuchter (Sommer), besser geschlossen lassen.</p>
    </div>`;
  },
};
