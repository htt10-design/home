// Geräte: Steckdosen schalten, aktuelle Leistung, Verbrauch heute/Monat.
import { esc, relZeit, uhr } from "../ui.js";
import { getSettings } from "../settings.js";
import { dauer } from "../waechter.js";
import { fmt } from "../model.js";

const energyCache = new Map(); // entity_id -> {ts, today, month, schnitt, tage}

export const energie = id => energyCache.get(id);

export async function loadEnergy(ctx, id) {
  const c = energyCache.get(id);
  if (c && (c.loading || Date.now() - c.ts < 5 * 60e3)) return;
  energyCache.set(id, { ...(c || {}), loading: true, ts: Date.now() });
  const now = new Date();
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const woche = new Date(day - 7 * 86400e3);
  try {
    const [d, mo, w] = await Promise.all([
      ctx.store.statistics([id], day, null, "day", ["change"]),
      ctx.store.statistics([id], month, null, "month", ["change"]),
      ctx.store.statistics([id], woche, day, "day", ["change"]),
    ]);
    const sum = arr => (arr || []).reduce((s, p) => s + (p.change || 0), 0);
    // Tagesschnitt nur aus vollen Tagen mit Daten (für die Jahres-Hochrechnung)
    const volle = (w[id] || []).filter(p => p.change != null);
    energyCache.set(id, {
      ts: Date.now(), today: sum(d[id]), month: sum(mo[id]),
      schnitt: volle.length ? sum(volle) / volle.length : null, tage: volle.length,
      proTag: [...volle.map(p => ({ t: p.start, v: p.change })), { t: day.getTime(), v: sum(d[id]), heute: true }],
    });
  } catch {
    energyCache.set(id, { ts: Date.now(), today: null, month: null, schnitt: null, tage: 0 });
  }
  ctx.rerender();
}

/** Statuszeile je nach Geräteart */
export function status(p, e) {
  const w = p.wache;
  if (p.unavailable) return `<div class="pstat crit">Steckdose nicht erreichbar</div>`;
  if (p.art === "kuehl") {
    if (!p.on) return `<div class="pstat crit">AUSGESCHALTET – bekommt keinen Strom <button type="button" class="btn small" data-einschalten="${esc(p.id)}">Einschalten</button></div>`;
    const laeuft = (p.power ?? 0) >= 15;
    const zuletzt = w?.lastActive && !laeuft ? ` · zuletzt aktiv ${relZeit(w.lastActive)}` : "";
    const jahr = e?.schnitt != null && e.tage >= 2 ? `<span>≈ <b>${fmt(e.schnitt * 365, 0)} kWh</b>/Jahr <small>(Ø ${e.tage} Tage)</small></span>` : e?.tage < 2 ? `<span class="dim">Jahreswert ab 2 vollen Messtagen</span>` : "";
    return `<div class="pstat ${laeuft ? "go" : ""}"><span>${laeuft ? "● Kühlt gerade" : "○ Pause"}${zuletzt}</span>${jahr}</div>`;
  }
  if (p.art === "programm") {
    if (!w) return `<div class="pstat dim">Werte werden geladen …</div>`;
    const quitt = getSettings().quittiert?.[p.id] || 0;
    if (w.phase === "laeuft") return `<div class="pstat go">● LÄUFT seit ${dauer(Date.now() - w.start)} <span class="dim">(Start ${uhr(new Date(w.start))})</span></div>`;
    if (w.phase === "fertig" && w.ende > quitt && Date.now() - w.ende < 12 * 3600e3) return `<div class="pstat fertig">✓ FERTIG um ${uhr(new Date(w.ende))} · Laufzeit ${dauer(w.ende - w.start)} <button type="button" class="btn small" data-quitt="${esc(p.id)}">Erledigt</button></div>`;
    return `<div class="pstat dim">Bereit</div>`;
  }
  return "";
}

/** basis: Seite, über der die Einblendung öffnet (haus oder geraete) */
export function plugKarte(p, ctx, basis = "geraete") {
  const e = p.energyEntity ? energyCache.get(p.energyEntity) : null;
  const monat = new Date().toLocaleDateString("de-DE", { month: "short" }).replace(".", "").toUpperCase();
  const schalter = p.nurMessen
    ? `<span class="lockbadge mono" title="In den Einstellungen auf „Nur messen“ gestellt">NUR<br>MESSEN</span>`
    : `<button type="button" class="tog" role="switch" data-plug="${esc(p.id)}" aria-checked="${p.on}" aria-label="${esc(p.name)} ${p.on ? "ausschalten" : "einschalten"}" ${p.unavailable ? "disabled" : ""}>
      <span class="on">EIN</span><span class="off">AUS</span></button>`;
  const art = p.art && p.art !== "normal" ? `<small>${p.art === "kuehl" ? "Kühlgerät" : "Programmgerät"}</small>` : "";
  return `<div class="plug${p.unavailable ? " offline" : ""}${p.art === "kuehl" && (!p.on || p.unavailable) ? " alarm" : ""}">
    <a class="plink" href="#${basis}/${encodeURIComponent(p.id)}" aria-label="Verlauf ${esc(p.name)} anzeigen"><div class="pn">${esc(p.name)}${p.room ? `<small>${esc(p.room)}</small>` : ""}${art}</div>
      <div class="w">${p.unavailable ? "offline" : p.power != null ? `${fmt(p.power, p.power < 10 ? 1 : 0)} W` : p.on ? "an" : "aus"}<span class="more-ico" aria-hidden="true">›</span></div></a>
    ${schalter}
    ${status(p, e)}
    ${p.energyEntity ? `<div class="meta"><span>HEUTE <b>${e?.today != null ? fmt(e.today, 2) : "…"} ${esc(p.energyUnit)}</b></span><span>${monat} <b>${e?.month != null ? fmt(e.month, 1) : "…"} ${esc(p.energyUnit)}</b></span></div>` : ""}
  </div>`;
}

export function mountPlugs(el, ctx) {
  for (const p of ctx.model.plugs) if (p.energyEntity) loadEnergy(ctx, p.energyEntity);
  el.querySelectorAll("[data-plug]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.plug, on = btn.getAttribute("aria-checked") === "true";
    const plug = ctx.model.plugs.find(p => p.id === id);
    // Kühlgeräte nur mit Bestätigung ausschalten
    if (on && plug?.art === "kuehl" && btn.dataset.sicher !== "1") {
      btn.dataset.sicher = "1";
      ctx.toast(`${plug.name} wirklich ausschalten? Zum Bestätigen noch einmal tippen.`);
      setTimeout(() => { delete btn.dataset.sicher; }, 4000);
      return;
    }
    btn.setAttribute("aria-checked", String(!on)); // sofort zeigen, Live-Update bestätigt
    btn.disabled = true;
    try { await ctx.conn.callService("switch", on ? "turn_off" : "turn_on", id); }
    catch (e) { btn.setAttribute("aria-checked", String(on)); ctx.toast(`Schalten fehlgeschlagen: ${e.message}`); }
    finally { btn.disabled = false; }
  }));
}

export const geraeteView = {
  live: true,
  render(ctx) {
    const p = ctx.model.plugs;
    return `
    <header class="pagehead"><h1>Geräte</h1><p class="mono dim">${p.length} ${p.length === 1 ? "STECKDOSE" : "STECKDOSEN"}</p></header>
    ${p.length ? p.map(x => plugKarte(x, ctx)).join("") : `<div class="verdict"><b>Noch keine Steckdose gefunden</b>Sobald die NOUS A7Z in ZHA angelernt ist, erscheint sie hier automatisch mit Schalter, Leistung und Verbrauch. Weise sie in HA am besten gleich einem Raum zu.</div>`}
    <h3>Einstellen &amp; später</h3>
    <div class="prose"><p>Ob eine Steckdose schaltbar ist und ob sie einen Kühlschrank oder eine Waschmaschine überwacht, stellst du unter <a href="#einstellungen">Einstellungen → Steckdosen</a> ein.</p><p>Heizkörperthermostate, Fenster- und Türkontakte, Wassermelder. Heizung (EMS-ESP) und Energie bekommen eigene Bereiche.</p></div>`;
  },
  mount(el, ctx) { mountPlugs(el, ctx); },
};
