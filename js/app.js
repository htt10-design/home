// Einstieg: Anmeldung, Verbindung, Router, Neuzeichnen, Theme, Service Worker.
import { HAConnection, defaultWsUrl } from "./ha.js";
import { Store } from "./store.js";
import { buildModel } from "./model.js";
import { getSettings, getToken, setToken } from "./settings.js";
import { esc, I } from "./ui.js";
import { hausView } from "./views/haus.js";
import { raumView } from "./views/raum.js";
import { klimaView } from "./views/klima.js";
import { geraeteView } from "./views/geraete.js";
import { hinweiseView } from "./views/hinweise.js";
import { einstellungenView } from "./views/einstellungen.js";
import { blickHtml, blickMount, blickZuruecksetzen } from "./views/blick.js";
import { Waechter } from "./waechter.js";
import { setSettings } from "./settings.js";

const $view = document.getElementById("view");
const $nav = document.getElementById("nav");
const $toast = document.getElementById("toast");
const $sheet = document.getElementById("sheet");
const $panel = $sheet.querySelector(".sheet-panel");

const ROUTES = { haus: hausView, raum: raumView, klima: klimaView, geraete: geraeteView, hinweise: hinweiseView, einstellungen: einstellungenView };
const NAV = [["haus", "home", "Übersicht"], ["klima", "climate", "Klima"], ["geraete", "plug", "Geräte"], ["hinweise", "bell", "Hinweise"]];

const ctx = {
  conn: null, store: null, model: null, settings: getSettings(),
  rerender: () => scheduleRender(),
  refreshModel: () => { ctx.settings = getSettings(); rebuild(); scheduleRender(); },
  applyTheme, toast,
};

// ---------- Theme ----------
function applyTheme() {
  const t = getSettings().theme;
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#131517" : "#f1f1ee");
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
applyTheme();

// ---------- Toast ----------
let toastTimer;
function toast(text, action) {
  $toast.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" class="btn small" id="toastAction">${esc(action.label)}</button>` : ""}`;
  $toast.hidden = false;
  if (action) document.getElementById("toastAction").onclick = action.run;
  clearTimeout(toastTimer);
  if (!action) toastTimer = setTimeout(() => { $toast.hidden = true; }, 4000);
}

// ---------- Router & Zeichnen ----------
function route() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, "").split("/");
  return { name: ROUTES[name] ? name : "haus", arg: rest.length ? decodeURIComponent(rest.join("/")) : null };
}

let renderQueued = false, lastRoute = "";
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(false); });
}

/** Zeichnet die aktuelle Seite. Formular-Seiten (live: false) nur bei Seitenwechsel. */
function render(routeEvent) {
  if (!ctx.model) return;
  const r = route(), view = ROUTES[r.name];
  // Auf der Übersicht ist das Argument die geöffnete Einblendung, nicht eine eigene Seite
  const key = r.name === "haus" ? "haus" : r.name + "/" + r.arg;
  const pageChanged = key !== lastRoute;
  syncSheet(r.name === "haus" ? r.arg : null);
  if (!routeEvent && !pageChanged && !view.live) return;
  lastRoute = key;
  $view.innerHTML = view.render(ctx, r.name === "haus" ? null : r.arg);
  view.mount?.($view, ctx, r.arg);
  if (pageChanged) window.scrollTo(0, 0);
  const navKey = r.name === "raum" ? "haus" : r.name;
  $nav.innerHTML = NAV.map(([k, icon, label]) => `<a href="#${k}" class="${k === navKey ? "on" : ""}" ${k === navKey ? 'aria-current="page"' : ""}>${I[icon]}<span>${label}${k === "hinweise" && ctx.model.alerts.length ? `<i class="badge">${ctx.model.alerts.length}</i>` : ""}</span></a>`).join("");
  document.title = r.name === "haus" ? "Zuhause" : `${$view.querySelector("h1")?.textContent || ""} · Zuhause`;
}

function rebuild() {
  ctx.model = buildModel(ctx.store, ctx.settings);
  ctx.waechter?.ergaenze(ctx.model);
  if (ctx.model.weather?.id !== ctx.store.forecast.entity) ctx.store.watchForecast(ctx.model.weather?.id || null);
}

let lastHash = location.hash, sheetFromApp = false;
window.addEventListener("hashchange", () => {
  const prev = lastHash; lastHash = location.hash;
  // Einblendung aus der Übersicht heraus geöffnet → Schließen = Zurück (passt zur Android-Zurück-Taste)
  if (/^#haus\/./.test(location.hash)) sheetFromApp = sheetFromApp || /^(#haus)?$/.test(prev) || /^#haus\/./.test(prev);
  else sheetFromApp = false;
  render(true);
});

// ---------- Einblendung („Blick“) ----------
let sheetId = null, sheetTimer = null;
function syncSheet(id) {
  if (id) {
    const body = $panel.querySelector(".sh-body");
    const keep = sheetId === id ? body?.scrollTop || 0 : 0;
    $panel.innerHTML = blickHtml(ctx, id);
    blickMount($panel, ctx, id);
    $panel.querySelector(".sh-body").scrollTop = keep;
    if (sheetId !== id && !$sheet.classList.contains("open")) {
      clearTimeout(sheetTimer);
      $sheet.hidden = false;
      document.body.classList.add("sheet-open");
      requestAnimationFrame(() => requestAnimationFrame(() => $sheet.classList.add("open")));
      $panel.querySelector("[data-close]")?.focus({ preventScroll: true });
    }
    sheetId = id;
  } else if (sheetId) {
    sheetId = null;
    blickZuruecksetzen();
    $sheet.classList.remove("open");
    $panel.style.transform = "";
    document.body.classList.remove("sheet-open");
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(() => { if (!sheetId) { $sheet.hidden = true; $panel.innerHTML = ""; } }, 320);
  }
}
function closeSheet() {
  if (sheetFromApp) history.back();
  else location.replace("#haus");
}
$sheet.addEventListener("click", e => {
  if (e.target.closest("[data-close]") || e.target.classList.contains("sheet-backdrop")) closeSheet();
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && sheetId) closeSheet(); });
// Nach unten wischen schließt (nur Handy-Blatt)
(() => {
  let y0 = null, dy = 0;
  const mobil = () => matchMedia("(max-width: 839px)").matches;
  $panel.addEventListener("touchstart", e => {
    if (!mobil() || !e.target.closest(".sh-band")) return;
    y0 = e.touches[0].clientY; dy = 0; $panel.classList.add("dragging");
  }, { passive: true });
  $panel.addEventListener("touchmove", e => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    $panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  $panel.addEventListener("touchend", () => {
    if (y0 == null) return;
    y0 = null; $panel.classList.remove("dragging");
    if (dy > 90) closeSheet(); else $panel.style.transform = "";
  });
})();

// Aktionen aus Hinweisen und Steckdosen-Karten (überall gleich)
document.addEventListener("click", async e => {
  const q = e.target.closest("[data-quitt]");
  if (q) {
    const s = getSettings();
    setSettings({ quittiert: { ...s.quittiert, [q.dataset.quitt]: Date.now() } });
    ctx.refreshModel();
    toast("Als erledigt markiert.");
    return;
  }
  const an = e.target.closest("[data-einschalten]");
  if (an && ctx.conn) {
    an.disabled = true;
    try { await ctx.conn.callService("switch", "turn_on", an.dataset.einschalten); toast("Eingeschaltet."); }
    catch (err) { toast(`Einschalten fehlgeschlagen: ${err.message}`); an.disabled = false; }
  }
});

// ---------- Anmeldung ----------
function loginScreen(message = "") {
  $nav.hidden = true;
  $view.innerHTML = `
  <div class="login">
    <div class="loginhouse" aria-hidden="true"><div class="roof"></div><div class="floor"><span></span><span></span><span></span></div><div class="floor"><span></span><span></span></div></div>
    <h1>Zuhause</h1>
    <p>Verbinde die App mit deinem Home Assistant. Dafür brauchst du einen <b>langlebigen Zugangs-Token</b>.</p>
    <ol>
      <li>Home Assistant öffnen → unten links auf deinen <b>Namen</b> (Profil) tippen.</li>
      <li>Oben den Reiter <b>Sicherheit</b> wählen, ganz nach unten scrollen.</li>
      <li><b>Token erstellen</b>, Namen „Zuhause-App“ eingeben, den Token kopieren.</li>
    </ol>
    <form id="login" autocomplete="off">
      <label class="field" for="token">Token
        <textarea id="token" name="token" rows="4" required spellcheck="false" autocapitalize="off" placeholder="eyJhbGciOi…"></textarea></label>
      ${message ? `<p class="err">${esc(message)}</p>` : ""}
      <button class="btn" type="submit">Verbinden</button>
      <p class="hint">Der Token bleibt nur auf diesem Gerät gespeichert.</p>
    </form>
  </div>`;
  document.getElementById("login").addEventListener("submit", async e => {
    e.preventDefault();
    const token = e.target.token.value.trim();
    const btn = e.target.querySelector("button");
    btn.disabled = true; btn.textContent = "Verbinde …";
    const ok = await start(token);
    if (ok) setToken(token);
    else { btn.disabled = false; btn.textContent = "Verbinden"; }
  });
}

function splash(text) {
  $view.innerHTML = `<div class="splash"><div class="loginhouse pulse" aria-hidden="true"><div class="roof"></div><div class="floor"><span></span><span></span><span></span></div><div class="floor"><span></span><span></span></div></div><p class="mono">${esc(text)}</p></div>`;
}

// ---------- Start ----------
async function start(token) {
  const url = defaultWsUrl(getSettings().server || undefined);
  const conn = new HAConnection({ url, token });
  splash("Verbinde mit Home Assistant …");
  try {
    await conn.connect();
  } catch (e) {
    conn.close();
    if (e.code === "auth_invalid") { setToken(""); loginScreen("Der Token wurde abgelehnt. Bitte prüfen oder neu erstellen."); }
    else loginScreen(`Home Assistant ist nicht erreichbar (${url}). Ist Tailscale an?`);
    return false;
  }
  ctx.conn = conn;
  ctx.store = new Store(conn);
  ctx.waechter = new Waechter(ctx.store, () => { if (ctx.store.loaded) { rebuild(); scheduleRender(); } });
  conn.addEventListener("status", () => { if (ctx.model) scheduleRender(); });
  conn.addEventListener("authinvalid", () => { setToken(""); loginScreen("Der Token ist nicht mehr gültig. Bitte neu eingeben."); });
  ctx.store.addEventListener("change", () => { if (ctx.store.loaded) { rebuild(); scheduleRender(); } });
  splash("Lade Räume und Geräte …");
  try { await ctx.store.start(); }
  catch (e) { loginScreen(`Fehler beim Laden: ${e.message}`); return false; }
  $nav.hidden = false;
  // Uhrzeit und „vor x min“ aktuell halten
  setInterval(() => { if (ctx.model) { rebuild(); scheduleRender(); } }, 60e3);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") conn.reconnectNow(); });
  window.addEventListener("online", () => conn.reconnectNow());
  return true;
}

// ---------- Service Worker / Updates ----------
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
    let wantReload = false; // nur nach „Jetzt laden“ neu laden, nie beim ersten Start
    const offer = w => toast("Neue Version verfügbar.", { label: "Jetzt laden", run: () => { wantReload = true; w.postMessage("skipWaiting"); } });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offer(w); });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (wantReload) { wantReload = false; location.reload(); } });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  } catch { /* z. B. ohne HTTPS */ }
}

registerSW();
const token = getToken();
if (token) start(token); else loginScreen();
