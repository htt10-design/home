// Hinweise: schwache Akkus, Sensoren offline, Feuchte, offene Fenster, Wasser.
import { esc, relZeit } from "../ui.js";

export function hinweisListe(alerts) {
  return `<div class="alerts">${alerts.map(a => `
    <a class="alert ${a.lvl}" href="${a.area ? `#raum/${encodeURIComponent(a.area)}` : "#hinweise"}">
      <span class="k">${esc(a.kind)}</span>
      <span>${esc(a.title)}${a.sub ? `<br><span class="s">${esc(a.sub)}</span>` : ""}</span>
      <span class="s">${a.since ? relZeit(a.since) : ""}</span>
    </a>`).join("")}</div>`;
}

export const hinweiseView = {
  live: true,
  render(ctx) {
    const a = ctx.model.alerts;
    return `
    <header class="pagehead"><h1>Hinweise</h1><p class="mono dim">${a.length ? `${a.length} OFFEN` : "ALLES IN ORDNUNG"}</p></header>
    ${a.length ? hinweisListe(a) : `<div class="verdict ok"><b>Keine Hinweise</b>Alle Akkus sind voll genug, alle Sensoren melden sich und kein Raum ist zu feucht.</div>`}
    <h3>Was hier erscheint</h3>
    <div class="prose"><p>Akku unter ${ctx.settings.akkuNiedrig} % (rot unter ${ctx.settings.akkuKritisch} %), Sensoren ohne Meldung seit ${ctx.settings.offlineStunden} Stunden, Räume über ${ctx.settings.feuchteSehrHoch} % Luftfeuchte, offene Fenster und Türen sowie Wassermelder. Handy und Tablet mit der HA-App zählen nicht mit. Die Grenzen lassen sich in den Einstellungen ändern.</p></div>`;
  },
};
