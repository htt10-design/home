// Kleines SVG-Liniendiagramm: Temperatur (linke Achse, Fläche) + Luftfeuchte (rechte Achse, gestrichelt).
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export function chart({ temp = [], hum = [], start, end, days }) {
  const W = 340, H = 180, L = 30, R = 32, T = 10, B = 22, iw = W - L - R, ih = H - T - B;
  if (!temp.length && !hum.length) return `<div class="chart-empty">Noch keine Verlaufsdaten.</div>`;
  const x = t => L + (t - start) / (end - start) * iw;

  const tv = temp.map(p => p.v), hv = hum.map(p => p.v);
  let tlo = Math.floor(Math.min(...tv)) - 1, thi = Math.ceil(Math.max(...tv)) + 1;
  if (!tv.length) { tlo = 0; thi = 1; }
  let hlo = Math.floor(Math.min(...hv) / 10) * 10, hhi = Math.ceil(Math.max(...hv) / 10) * 10;
  if (!hv.length) { hlo = 0; hhi = 100; }
  if (hhi - hlo < 20) { hlo = Math.max(0, hlo - 10); hhi = Math.min(100, hhi + 10); }
  const yt = v => T + ih - (v - tlo) / (thi - tlo) * ih;
  const yh = v => T + ih - (v - hlo) / (hhi - hlo) * ih;
  const path = (pts, y) => pts.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1)).join("");

  let g = "";
  // Nachtbereiche (22–6 Uhr) bei 24 h
  if (days === 1) {
    const d = new Date(start); d.setHours(22, 0, 0, 0);
    for (let n = d.getTime() - 86400e3; n < end; n += 86400e3) {
      const a = Math.max(n, start), b = Math.min(n + 8 * 3600e3, end);
      if (b > a) g += `<rect class="c-night" x="${x(a).toFixed(1)}" y="${T}" width="${(x(b) - x(a)).toFixed(1)}" height="${ih}"/>`;
    }
  }
  const span = thi - tlo, step = span > 12 ? 4 : span > 6 ? 2 : 1;
  for (let v = Math.ceil(tlo / step) * step; v <= thi; v += step) {
    g += `<line class="c-grid" x1="${L}" x2="${W - R}" y1="${yt(v).toFixed(1)}" y2="${yt(v).toFixed(1)}"/><text class="c-lab" x="${L - 6}" y="${(yt(v) + 3.5).toFixed(1)}" text-anchor="end">${v}°</text>`;
  }
  for (let v = hlo; v <= hhi; v += 10) g += `<text class="c-lab" x="${W - R + 6}" y="${(yh(v) + 3.5).toFixed(1)}">${v}%</text>`;
  // Zeitachse
  if (days === 1) {
    const d = new Date(start); d.setMinutes(0, 0, 0); d.setHours(Math.ceil((d.getHours() + 1) / 6) * 6);
    for (let t = d.getTime(); t < end - 2 * 3600e3; t += 6 * 3600e3) {
      g += `<text class="c-lab" x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="middle">${String(new Date(t).getHours()).padStart(2, "0")}:00</text>`;
    }
  } else {
    const d = new Date(start); d.setHours(24, 0, 0, 0);
    for (let t = d.getTime(); t < end; t += 86400e3) {
      g += `<line class="c-grid" x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${T}" y2="${T + ih}"/>`;
      const mid = (x(t) + x(Math.min(t + 86400e3, end))) / 2;
      if (mid < W - R - 34 && t + 86400e3 - end < 12 * 3600e3) g += `<text class="c-lab" x="${mid.toFixed(1)}" y="${H - 6}" text-anchor="middle">${WD[new Date(t).getDay()]}</text>`;
    }
  }
  g += `<text class="c-lab" x="${W - R}" y="${H - 6}" text-anchor="end">jetzt</text>`;

  let body = "";
  if (temp.length) {
    const area = path(temp, yt) + `L${x(temp.at(-1).t).toFixed(1)} ${T + ih}L${x(temp[0].t).toFixed(1)} ${T + ih}Z`;
    body += `<path class="c-area" d="${area}"/>`;
  }
  if (hum.length) body += `<path class="c-hum" d="${path(hum, yh)}"/>`;
  if (temp.length) {
    const l = temp.at(-1);
    body += `<path class="c-temp" d="${path(temp, yt)}"/><circle class="c-dot" cx="${x(l.t).toFixed(1)}" cy="${yt(l.v).toFixed(1)}" r="4"/>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf Temperatur und Luftfeuchte">${g}${body}</svg>`;
}

/** Spanne (min/max) einer Reihe inkl. Zeitpunkt */
export function spanne(pts) {
  if (!pts.length) return null;
  let lo = pts[0], hi = pts[0];
  for (const p of pts) { if (p.v < lo.v) lo = p; if (p.v > hi.v) hi = p; }
  return { lo, hi };
}
