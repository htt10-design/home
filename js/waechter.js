// Geräte-Wächter: wertet den Leistungsverlauf überwachter Steckdosen aus.
//  - Dauerläufer (Kühlschrank, Gefriertruhe): Alarm bei „aus“, „nicht erreichbar“ oder zu lange ohne Kühlleistung
//  - Programmgeräte (Waschmaschine, Trockner, Spülmaschine): „läuft seit …“ und „fertig“
import { getSettings } from "./settings.js";

export const ARTEN = {
  normal: "Keine Überwachung",
  kuehl: "Kühlschrank / Gefriertruhe",
  programm: "Waschmaschine / Trockner / Spülmaschine",
};

// Schwellen in Watt (bewusst großzügig, passen für übliche Geräte)
const KUEHL_AKTIV_W = 15;        // Kompressor läuft
const PROG_START_W = 10;         // Programm läuft
const PROG_RUHE_W = 5;           // darunter gilt als Pause/Ende
const PROG_ENDE_MS = 5 * 60e3;   // so lange unter PROG_RUHE_W → fertig
const FERTIG_ANZEIGE_MS = 12 * 3600e3;

/**
 * Reine Auswertung einer Leistungsreihe. pts: [{t, v}] als Stufen (Wert gilt bis zum nächsten Punkt).
 * von: Beginn des betrachteten Zeitraums (für „seit mindestens …“).
 */
export function analysiere(pts, now, art, von = pts[0]?.t ?? now) {
  if (art === "kuehl") {
    let lastActive = null;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].v >= KUEHL_AKTIV_W) lastActive = i === pts.length - 1 ? now : pts[i + 1].t;
    }
    return { lastActive, bekanntSeit: von };
  }
  if (art === "programm") {
    let phase = "aus", start = null, ende = null, ruheSeit = null;
    for (let i = 0; i < pts.length; i++) {
      const t0 = pts[i].t, t1 = i === pts.length - 1 ? now : pts[i + 1].t, v = pts[i].v;
      if (v >= PROG_START_W) {
        if (phase !== "laeuft") { phase = "laeuft"; start = t0; ende = null; }
        ruheSeit = null;
      } else if (v < PROG_RUHE_W) {
        if (phase === "laeuft") {
          ruheSeit ??= t0;
          if (t1 - ruheSeit >= PROG_ENDE_MS) { phase = "fertig"; ende = ruheSeit; }
        }
      } else ruheSeit = null; // 5–10 W: Pause im Programm, läuft weiter
    }
    return { phase, start, ende };
  }
  return null;
}

/** Verwaltet Verlauf (24 h aus HA + Live-Werte) je überwachter Steckdose. */
export class Waechter {
  constructor(store, onUpdate) {
    this.store = store;
    this.onUpdate = onUpdate;
    this.reihen = new Map(); // power entity_id -> {pts, von, laden}
  }

  /** Ergänzt Steckdosen im Modell um .wache und hängt Hinweise an. */
  ergaenze(model) {
    const set = getSettings();
    const now = Date.now();
    const zuLaden = [];
    for (const p of model.plugs) {
      const cfg = set.geraete?.[p.id] || {};
      p.art = ARTEN[cfg.art] ? cfg.art : "normal";
      p.nurMessen = !!cfg.nurMessen;
      if (p.art === "normal" || !p.powerEntity) continue;

      let r = this.reihen.get(p.powerEntity);
      if (!r) { r = { pts: [], von: now, laden: false, geladen: false }; this.reihen.set(p.powerEntity, r); }
      if (!r.geladen && !r.laden) zuLaden.push(p.powerEntity);
      // Live-Wert anhängen, wenn neu
      const st = this.store.states[p.powerEntity];
      if (p.power != null && st) {
        const last = r.pts.at(-1);
        if (!last || (st.last_updated > last.t && last.v !== p.power)) r.pts.push({ t: st.last_updated, v: p.power });
      }
      // alte Punkte (älter als 24 h) entfernen, einen davor behalten
      const grenze = now - 24 * 3600e3;
      while (r.pts.length > 2 && r.pts[1].t < grenze) r.pts.shift();

      p.wache = r.geladen ? analysiere(r.pts, now, p.art, r.von) : null;
      this.hinweise(model, p, set, now);
    }
    if (zuLaden.length) this.lade(zuLaden);
  }

  hinweise(model, p, set, now) {
    const name = p.name;
    if (p.art === "kuehl") {
      if (p.unavailable) {
        model.alerts.push({ lvl: "crit", kind: "OFF", title: `${name}: Steckdose nicht erreichbar`, sub: "Prüfen, ob der Kühlschrank Strom hat", since: null, plug: p.id });
      } else if (!p.on) {
        model.alerts.push({ lvl: "crit", kind: "AUS", title: `${name} ist ausgeschaltet!`, sub: "Steckdose ist aus – Kühlschrank bekommt keinen Strom", since: null, plug: p.id, einschalten: true });
      } else if (p.wache) {
        const seit = p.wache.lastActive ?? p.wache.bekanntSeit;
        const grenzeMs = (set.kuehlStunden || 3) * 3600e3;
        if (now - seit > grenzeMs) model.alerts.push({
          lvl: "crit", kind: "KÜHL", title: `${name}: keine Kühlleistung`,
          sub: `Kompressor ${p.wache.lastActive ? "zuletzt aktiv" : "nicht aktiv"} ${p.wache.lastActive ? "vor " + dauer(now - seit) : "seit mindestens " + dauer(now - seit)}`, since: seit, plug: p.id,
        });
      }
    }
    if (p.art === "programm" && p.wache?.phase === "fertig") {
      const quitt = set.quittiert?.[p.id] || 0;
      if (p.wache.ende > quitt && now - p.wache.ende < FERTIG_ANZEIGE_MS) {
        model.alerts.push({
          lvl: "info", kind: "FERTIG", title: `${name} ist fertig`,
          sub: `Laufzeit ${dauer(p.wache.ende - p.wache.start)}`, since: p.wache.ende, plug: p.id, quittieren: true,
        });
      }
    }
    const order = { crit: 0, warn: 1, info: 2 };
    model.alerts.sort((a, b) => order[a.lvl] - order[b.lvl] || (b.since || 0) - (a.since || 0));
  }

  async lade(ids) {
    for (const id of ids) this.reihen.get(id).laden = true;
    try {
      const h = await this.store.history(ids, 24);
      const von = Date.now() - 24 * 3600e3;
      for (const id of ids) {
        const r = this.reihen.get(id);
        const live = r.pts.filter(p => p.t > (h[id]?.at(-1)?.t ?? 0));
        r.pts = [...(h[id] || []), ...live];
        r.von = von; r.geladen = true; r.laden = false;
      }
    } catch {
      for (const id of ids) { const r = this.reihen.get(id); r.laden = false; r.geladen = true; } // ohne Verlauf weiter, nur live
    }
    this.onUpdate();
  }
}

export function dauer(ms) {
  const min = Math.round(ms / 60e3);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return h < 24 ? `${h}:${String(m).padStart(2, "0")} h` : `${Math.round(h / 24 * 10) / 10} Tage`.replace(".", ",");
}
