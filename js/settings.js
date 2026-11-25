// Lokale Einstellungen (nur in diesem Gerät, localStorage).

const KEY = "zuhause.einstellungen";
const TOKEN_KEY = "zuhause.token";

export const DEFAULTS = {
  server: "",                 // leer = gleicher Server wie die App
  theme: "system",            // system | light | dark
  aussenBereich: "",          // area_id; leer = automatisch erkennen
  wetter: "",                 // entity_id; leer = erste weather.*-Entität
  nebenraeume: null,          // [area_id] oder null = automatisch (Dachboden, Keller …)
  ausgeblendet: [],           // [area_id]
  feuchteHoch: 60,            // ab hier orange / Lüften prüfen
  feuchteSehrHoch: 70,        // ab hier rot
  feuchteNiedrig: 40,         // darunter „trocken“
  lueftenDiff: 1.5,           // g/m³ Unterschied innen/außen, ab dem Lüften lohnt
  akkuNiedrig: 30,
  akkuKritisch: 15,
  offlineStunden: 6,
  kuehlStunden: 3,            // Kühlschrank: Alarm, wenn so lange keine Kühlleistung
  geraete: {},                // {switch.entity_id: {art: "normal"|"kuehl"|"programm", nurMessen: bool}}
  quittiert: {},              // {switch.entity_id: Zeitpunkt (ms), bis zu dem „fertig“ erledigt ist}
};

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, val) {
  try { val == null ? localStorage.removeItem(key) : localStorage.setItem(key, val); } catch { /* privat/gesperrt */ }
}

let cache = null;
export function getSettings() {
  if (!cache) {
    let stored = {};
    try { stored = JSON.parse(read(KEY) || "{}"); } catch { stored = {}; }
    cache = { ...DEFAULTS, ...stored };
  }
  return cache;
}
export function setSettings(patch) {
  cache = { ...getSettings(), ...patch };
  write(KEY, JSON.stringify(cache));
  return cache;
}

export const getToken = () => read(TOKEN_KEY) || "";
export const setToken = t => write(TOKEN_KEY, t || null);
