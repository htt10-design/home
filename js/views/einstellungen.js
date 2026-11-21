// Einstellungen: Darstellung, Rollen (Außen, Wetter), Räume, Grenzwerte, Verbindung, App.
import { esc } from "../ui.js";
import { getSettings, setSettings, setToken, DEFAULTS } from "../settings.js";

const GRENZEN = [
  ["feuchteNiedrig", "Trocken unter", "%"],
  ["feuchteHoch", "Feucht ab (Lüften prüfen)", "%"],
  ["feuchteSehrHoch", "Sehr feucht ab", "%"],
  ["lueftenDiff", "Lüften lohnt ab Unterschied", "g/m³"],
  ["akkuNiedrig", "Akku-Hinweis unter", "%"],
  ["akkuKritisch", "Akku rot unter", "%"],
  ["offlineStunden", "Sensor offline nach", "h"],
];

export const einstellungenView = {
  live: false, // nicht bei jeder Live-Änderung neu zeichnen (Formular)
  render(ctx) {
    const s = getSettings(), m = ctx.model;
    const autoNeben = s.nebenraeume == null;
    const areas = [...m.areas].sort((a, b) => a.name.localeCompare(b.name, "de"));
    const rooms = m.rooms;
    return `
    <header class="pagehead"><a class="back mono" href="#haus">← HAUS</a><h1>Einstellungen</h1></header>
    <form id="set" class="form" autocomplete="off">
      <fieldset><legend>Darstellung</legend>
        <div class="tabs big" role="radiogroup" aria-label="Darstellung">
          ${[["system", "System"], ["light", "Hell"], ["dark", "Dunkel"]].map(([v, l]) => `<label><input type="radio" name="theme" id="theme-${v}" value="${v}" ${s.theme === v ? "checked" : ""}><span>${l}</span></label>`).join("")}
        </div>
      </fieldset>

      <fieldset><legend>Außen &amp; Wetter</legend>
        <label class="field" for="aussenBereich">Außenbereich (Sensor für draußen)
          <select id="aussenBereich" name="aussenBereich"><option value="">Automatisch${m.outside?.name ? ` (${esc(m.outside.name)})` : ""}</option>
          ${areas.map(a => `<option value="${esc(a.area_id)}" ${s.aussenBereich === a.area_id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
        <label class="field" for="wetter">Wetter-Entität
          <select id="wetter" name="wetter"><option value="">Automatisch${m.weather ? ` (${esc(m.weather.id)})` : ""}</option>
          ${m.wetterIds.map(w => `<option value="${esc(w)}" ${s.wetter === w ? "selected" : ""}>${esc(w)}</option>`).join("")}</select></label>
        ${m.wetterIds.length ? "" : `<p class="hint">In Home Assistant gibt es noch keine Wetter-Entität. So richtest du eine ein: <b>Einstellungen → Geräte &amp; Dienste → Integration hinzufügen → „Meteorologisk institutt (Met.no)“</b>. Danach erscheint das Wetter hier automatisch.</p>`}
      </fieldset>

      <fieldset><legend>Räume</legend>
        <p class="hint">Nebenräume (z. B. Dachboden) bekommen keine Lüften-Markierung im Haus. Ausgeblendete Räume verschwinden aus Haus und Listen.</p>
        <label class="check"><input type="checkbox" id="nebenAuto" name="nebenAuto" ${autoNeben ? "checked" : ""}> Nebenräume automatisch erkennen (Dachboden, Keller, Garage …)</label>
        <table class="roomset"><thead><tr><th>Raum</th><th>Nebenraum</th><th>Ausblenden</th></tr></thead><tbody>
        ${rooms.map(r => `<tr><td>${esc(r.name)}</td>
          <td><input type="checkbox" aria-label="${esc(r.name)} ist Nebenraum" id="neben-${esc(r.id)}" data-neben="${esc(r.id)}" ${r.neben ? "checked" : ""} ${autoNeben ? "disabled" : ""}></td>
          <td><input type="checkbox" aria-label="${esc(r.name)} ausblenden" id="hide-${esc(r.id)}" data-hide="${esc(r.id)}" ${r.hidden ? "checked" : ""}></td></tr>`).join("")}
        </tbody></table>
      </fieldset>

      <fieldset><legend>Grenzwerte</legend>
        <div class="grid2">${GRENZEN.map(([k, l, u]) => `<label class="field" for="${k}">${l}
          <span class="unit"><input type="number" inputmode="decimal" step="${k === "lueftenDiff" ? "0.1" : "1"}" id="${k}" name="${k}" value="${s[k]}"><span>${u}</span></span></label>`).join("")}</div>
        <button type="button" class="btn ghost" id="resetGrenzen">Standardwerte</button>
      </fieldset>

      <fieldset><legend>Verbindung</legend>
        <label class="field" for="server">Server-Adresse <small>(leer lassen = dieser Server)</small>
          <input type="url" id="server" name="server" placeholder="${esc(location.origin)}" value="${esc(s.server)}"></label>
        <p class="hint">Verbunden mit Home Assistant ${esc(ctx.conn.haVersion || "–")}. Der Token ist nur auf diesem Gerät gespeichert.</p>
        <button type="button" class="btn ghost" id="logout">Token entfernen und abmelden</button>
      </fieldset>

      <fieldset><legend>App</legend>
        <p class="hint">Version <b>${esc(self.ZUHAUSE_VERSION || "?")}</b></p>
        <button type="button" class="btn ghost" id="hardreload">App-Dateien neu laden</button>
      </fieldset>
    </form>`;
  },
  mount(el, ctx) {
    const f = el.querySelector("#set");
    const save = () => {
      const fd = new FormData(f);
      const patch = {
        theme: fd.get("theme") || "system",
        aussenBereich: fd.get("aussenBereich") || "",
        wetter: fd.get("wetter") || "",
        server: (fd.get("server") || "").trim().replace(/\/+$/, ""),
        ausgeblendet: [...f.querySelectorAll("[data-hide]:checked")].map(i => i.dataset.hide),
        nebenraeume: f.nebenAuto.checked ? null : [...f.querySelectorAll("[data-neben]:checked")].map(i => i.dataset.neben),
      };
      for (const [k] of GRENZEN) { const v = parseFloat(String(fd.get(k)).replace(",", ".")); if (Number.isFinite(v)) patch[k] = v; }
      const serverChanged = patch.server !== getSettings().server;
      setSettings(patch);
      ctx.applyTheme();
      ctx.refreshModel();
      if (serverChanged) ctx.toast("Server-Adresse gilt nach dem nächsten Neustart der App.");
    };
    f.addEventListener("change", e => {
      if (e.target.id === "nebenAuto") {
        // beim Umschalten die aktuell erkannten Nebenräume als Startwert übernehmen
        f.querySelectorAll("[data-neben]").forEach(i => { i.disabled = e.target.checked; });
      }
      save();
    });
    f.addEventListener("submit", e => e.preventDefault());
    el.querySelector("#resetGrenzen").addEventListener("click", () => {
      for (const [k] of GRENZEN) f.elements[k].value = DEFAULTS[k];
      save(); ctx.toast("Standardwerte gesetzt.");
    });
    el.querySelector("#logout").addEventListener("click", () => { setToken(""); ctx.conn.close(); location.hash = ""; location.reload(); });
    el.querySelector("#hardreload").addEventListener("click", async () => {
      try {
        for (const k of await caches.keys()) await caches.delete(k);
        const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
        for (const r of regs) await r.unregister();
      } catch { /* egal */ }
      location.reload();
    });
  },
};

