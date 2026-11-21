// Kleine UI-Helfer: Escaping, Icons, Farben, Zeitangaben.

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Temperatur → Farbe (kalt blau … warm orange/rot) */
export function tempColor(t) {
  if (t == null) return "var(--leer)";
  const st = [[8, [79, 127, 209]], [16, [156, 195, 224]], [20, [243, 227, 168]], [23, [243, 163, 91]], [26, [226, 85, 63]]];
  if (t <= st[0][0]) return `rgb(${st[0][1]})`;
  for (let i = 1; i < st.length; i++) if (t <= st[i][0]) {
    const [t0, c0] = st[i - 1], [t1, c1] = st[i], k = (t - t0) / (t1 - t0);
    return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k))})`;
  }
  return `rgb(${st.at(-1)[1]})`;
}

export function relZeit(ms) {
  if (!ms) return "";
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return "gerade eben";
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? "seit 1 Tag" : `seit ${d} Tagen`;
}

export const uhr = d => d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";

export function datumKopf(d = new Date()) {
  const wd = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"][d.getDay()];
  return `${wd} ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}. · ${uhr(d)}`;
}

export const I = {
  drop: `<svg viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M6 1C4 4 2.5 5.8 2.5 7.6a3.5 3.5 0 0 0 7 0C9.5 5.8 8 4 6 1Z"/></svg>`,
  home: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/></svg>`,
  climate: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0Z"/></svg>`,
  plug: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>`,
  back: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>`,
};

/** Wetter-Symbol (vereinfachte Linien-Icons) */
export function wetterIcon(cond) {
  const cloud = `<path d="M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6-.8A4.4 4.4 0 0 0 7 18Z"/>`;
  const sun = `<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>`;
  const rain = `<path d="M9 20l-1 2M13 20l-1 2M17 20l-1 2"/>`;
  const map = {
    sunny: sun, "clear-night": `<path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10Z"/>`,
    partlycloudy: `<path d="M8 6.5A4 4 0 0 1 15 8"/><path d="M8 19h9a3.5 3.5 0 0 0 0-7 4.8 4.8 0 0 0-9.3-.7A3.9 3.9 0 0 0 8 19Z"/>`,
    cloudy: cloud, fog: `<path d="M4 9h16M4 13h16M6 17h12"/>`,
    rainy: `<path d="M7 16h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6-.8A4.4 4.4 0 0 0 7 16Z"/>${rain}`,
    pouring: `<path d="M7 16h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6-.8A4.4 4.4 0 0 0 7 16Z"/><path d="M8 18l-2 4M12 18l-2 4M16 18l-2 4"/>`,
    snowy: `<path d="M7 16h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6-.8A4.4 4.4 0 0 0 7 16Z"/><path d="M9 20h.01M13 21h.01M16 19.5h.01"/>`,
    lightning: `<path d="M7 15h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6-.8A4.4 4.4 0 0 0 7 15Z"/><path d="M12 15l-2 4h3l-2 4"/>`,
    windy: `<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>`,
  };
  map["snowy-rainy"] = map.snowy; map.hail = map.snowy; map["lightning-rainy"] = map.lightning;
  map["windy-variant"] = map.windy; map.exceptional = map.lightning;
  return `<svg class="wx" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${map[cond] || cloud}</svg>`;
}
