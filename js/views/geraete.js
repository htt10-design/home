// Geräte: Steckdosen schalten, aktuelle Leistung, Verbrauch heute/Monat.
import { esc } from "../ui.js";
import { fmt } from "../model.js";

const energyCache = new Map(); // entity_id -> {ts, today, month}

async function loadEnergy(ctx, id) {
  const c = energyCache.get(id);
  if (c && (c.loading || Date.now() - c.ts < 5 * 60e3)) return;
  energyCache.set(id, { ...(c || {}), loading: true, ts: Date.now() });
  const now = new Date();
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    const [d, mo] = await Promise.all([
      ctx.store.statistics([id], day, null, "day", ["change"]),
      ctx.store.statistics([id], month, null, "month", ["change"]),
    ]);
    const sum = arr => (arr || []).reduce((s, p) => s + (p.change || 0), 0);
    energyCache.set(id, { ts: Date.now(), today: sum(d[id]), month: sum(mo[id]) });
  } catch {
    energyCache.set(id, { ts: Date.now(), today: null, month: null });
  }
  ctx.rerender();
}

export function plugKarte(p, ctx) {
  const e = p.energyEntity ? energyCache.get(p.energyEntity) : null;
  const monat = new Date().toLocaleDateString("de-DE", { month: "short" }).replace(".", "").toUpperCase();
  return `<div class="plug${p.unavailable ? " offline" : ""}">
    <div><div class="pn">${esc(p.name)}${p.room ? `<small>${esc(p.room)}</small>` : ""}</div>
      <div class="w">${p.unavailable ? "offline" : p.power != null ? `${fmt(p.power, p.power < 10 ? 1 : 0)} W` : p.on ? "an" : "aus"}</div></div>
    <button type="button" class="tog" role="switch" data-plug="${esc(p.id)}" aria-checked="${p.on}" aria-label="${esc(p.name)} ${p.on ? "ausschalten" : "einschalten"}" ${p.unavailable ? "disabled" : ""}>
      <span class="on">EIN</span><span class="off">AUS</span></button>
    ${p.energyEntity ? `<div class="meta"><span>HEUTE <b>${e?.today != null ? fmt(e.today, 2) : "…"} ${esc(p.energyUnit)}</b></span><span>${monat} <b>${e?.month != null ? fmt(e.month, 1) : "…"} ${esc(p.energyUnit)}</b></span></div>` : ""}
  </div>`;
}

export function mountPlugs(el, ctx) {
  for (const p of ctx.model.plugs) if (p.energyEntity) loadEnergy(ctx, p.energyEntity);
  el.querySelectorAll("[data-plug]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.plug, on = btn.getAttribute("aria-checked") === "true";
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
    <header class="pagehead"><h1>Geräte</h1><p class="mono dim">${p.length} SCHALTBAR</p></header>
    ${p.length ? p.map(x => plugKarte(x, ctx)).join("") : `<div class="verdict"><b>Noch keine Steckdose gefunden</b>Sobald die NOUS A7Z in ZHA angelernt ist, erscheint sie hier automatisch mit Schalter, Leistung und Verbrauch. Weise sie in HA am besten gleich einem Raum zu.</div>`}
    <h3>Später hier</h3>
    <div class="prose"><p>Heizkörperthermostate, Fenster- und Türkontakte, Wassermelder. Heizung (EMS-ESP) und Energie bekommen eigene Bereiche.</p></div>`;
  },
  mount(el, ctx) { mountPlugs(el, ctx); },
};
