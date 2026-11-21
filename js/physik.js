// Feuchte-Berechnungen (Magnus-Formel, Koeffizienten nach Sonntag 1990, über Wasser).

const A = 17.62, B = 243.12;

/** Sättigungsdampfdruck in hPa */
export const saettigung = t => 6.112 * Math.exp(A * t / (B + t));

/** Absolute Feuchte in g/m³ aus Temperatur (°C) und relativer Feuchte (%) */
export const absoluteFeuchte = (t, rh) => 216.7 * (rh / 100 * saettigung(t)) / (273.15 + t);

/** Taupunkt in °C */
export function taupunkt(t, rh) {
  const g = Math.log(Math.max(rh, 0.1) / 100) + A * t / (B + t);
  return B * g / (A - g);
}
