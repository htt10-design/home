# Konzept: eigene Smart-Home-App („Zuhause“, Arbeitstitel)

Stand: 21.11.2026 · Status: Design B „Hausschnitt“ gewählt, Stufe 1–2 gebaut (v0.1.0)

## 1. Ziel in einem Satz

Eine schnelle, übersichtliche PWA für Handy und Tablet, die Home Assistant als
Datenquelle nutzt, Räume automatisch aus HA übernimmt und Klima, Geräte und
Hinweise so zeigt, dass man in zwei Sekunden weiß, ob etwas zu tun ist.

## 2. Technik-Rahmen

| Thema | Entscheidung |
|---|---|
| Sprache/Stack | Vanilla HTML/CSS/JS, native ES-Module (`<script type="module">`), kein Build, keine Frameworks |
| Diagramme | eigene kleine SVG-Diagrammfunktion (≈150 Zeilen), keine Bibliothek |
| UI | Deutsch, Hell/Dunkel/System, mobil zuerst, Tablet mit Zwei-Spalten-Layout |
| Hosting | `~/server/homeassistant/config/www/<app>/` → `https://heimserver.tail8f2780.ts.net:8124/local/<app>/` |
| Verbindung | HA-WebSocket `wss://…:8124/api/websocket`, gleiche Origin, kein CORS |
| Anmeldung | Long-Lived Access Token, beim ersten Start eingegeben, nur in `localStorage` des Geräts |
| Updates | `git pull` im Ordner auf dem Server, Service Worker mit Versionsnummer |

**Wichtig zur Sicherheit:** Dateien unter `/local/` liefert HA **ohne Anmeldung** aus.
Jeder im Tailnet kann die App-Dateien laden. Das ist in Ordnung, solange im Code
nichts Geheimes steht. Ohne Token sieht man nur den Anmeldebildschirm.

## 3. Dateistruktur

```
<app>/
├── index.html              App-Hülle, lädt js/app.js
├── manifest.webmanifest    PWA: Name, Icons, start_url, scope = /local/<app>/
├── sw.js                   Service Worker (Cache mit Versionsnummer)
├── version.js              export const VERSION = "0.1.0"  ← einzige Stelle zum Hochzählen
├── css/
│   ├── tokens.css          Farben, Schriften, Abstände (Hell + Dunkel)
│   └── app.css             Layout und Komponenten
├── js/
│   ├── app.js              Start, Router (#start, #raum-<id>, #geraete …)
│   ├── ha.js               WebSocket-Client: Auth, Nachrichten-IDs, Reconnect, Promises
│   ├── store.js            Zustand: States + Registries → Raum-Modell, Events an Views
│   ├── model.js            Klassifizierung (Temperatur, Feuchte, Akku, Steckdose …)
│   ├── regeln.js           Ampel, Lüftungsempfehlung, Hinweise
│   ├── physik.js           absolute Feuchte, Taupunkt
│   ├── chart.js            SVG-Liniendiagramm
│   └── views/              start.js, raum.js, klima.js, geraete.js, hinweise.js, einstellungen.js
├── icons/                  App-Icons (192/512, maskable)
└── README.md               inkl. Server-Anleitung für git pull
```

## 4. Datenfluss

```
 Start
  │
  ├─ Token in localStorage?  nein → Anmeldebildschirm (Token einfügen, Test-Verbindung)
  │
  ▼
 WebSocket öffnen  ──►  auth_required  ──►  {type:"auth", access_token}  ──►  auth_ok
  │
  ├─ parallel laden (einmalig):
  │    get_config                       Ort, Einheiten, HA-Version
  │    get_states                       alle aktuellen Zustände
  │    config/floor_registry/list       Etagen (für die Hausansicht, falls genutzt)
  │    config/area_registry/list        Räume
  │    config/device_registry/list      Geräte → Raum
  │    config/entity_registry/list      Entitäten → Gerät/Raum, ausgeblendet/deaktiviert
  │
  ├─ abonnieren (dauerhaft):
  │    subscribe_entities               Live-Zustände (kompakte Diffs, nutzt auch das HA-Frontend)
  │                                     Fallback: subscribe_events / state_changed
  │    subscribe_events: area_registry_updated, device_registry_updated,
  │                      entity_registry_updated, floor_registry_updated
  │                                     → neues Gerät erscheint sofort im richtigen Raum
  │
  ├─ bei Bedarf (Raumdetail, Energie):
  │    history/history_during_period    24 h Rohdaten (minimal_response, no_attributes)
  │    recorder/statistics_during_period  7 Tage stündlich (mean/min/max),
  │                                     Energie täglich/monatlich (change)
  │    weather/subscribe_forecast       Stunden-/Tagesvorhersage der Wetter-Entität
  │
  └─ Aktionen:
       call_service switch.turn_on / turn_off       Steckdose
       später climate.set_temperature, number.set_value (EMS-ESP), …
```

### Raumzuordnung

`Raum einer Entität = entity.area_id ?? device.area_id`. Entitäten, die in HA
deaktiviert oder ausgeblendet sind, sowie Diagnose-Entitäten (`entity_category`)
erscheinen nicht als Hauptwert, Akku wird aber ausgewertet.

### Klassifizierung (ohne feste Entity-IDs)

Die App erkennt Geräte über `domain` + `device_class` + `state_class`:

| Erkennung | Bedeutung in der App |
|---|---|
| `sensor` · `temperature` | Raumtemperatur (Hauptwert der Kachel) |
| `sensor` · `humidity` | Luftfeuchte |
| `sensor` · `battery` | Akkustand → Hinweis unter Schwelle |
| `switch` + `sensor` · `power` / `energy` am selben Gerät | Steckdose mit Messung |
| `binary_sensor` · `window` / `door` / `opening` | Fenster-/Türkontakt (geplant) |
| `binary_sensor` · `moisture` | Wassermelder (geplant) |
| `weather.*` | Wetter |
| `climate.*`, EMS-ESP-Sensoren | Heizung (später) |

Feste Entity-IDs braucht die App nur für Sonderrollen: **Außensensor**, **Wetter-Entität**
und ggf. Heizungswerte. Die werden in den Einstellungen ausgewählt (mit Vorschlag).

### Offline-Erkennung

Sensor gilt als offline bei Zustand `unavailable`/`unknown` oder wenn `last_reported`
älter als einstellbar (Vorschlag 3 h; SNZB-02P melden sonst alle paar Minuten).

## 5. Regeln (Ampel, Lüften, Hinweise)

Alle Schwellen in den Einstellungen änderbar, pro Raum abschaltbar
(z. B. Dachboden als „Nebenraum“).

| Wert | grün | gelb | orange | rot |
|---|---|---|---|---|
| rel. Feuchte | 40–60 % | < 40 % (trocken) | 60–70 % (lüften) | > 70 % (Schimmelgefahr) |
| Temperatur Wohnraum | 19–23 °C | 17–19 / 23–25 | < 17 / > 25 | – |
| Akku | > 30 % | 15–30 % | – | < 15 % |

**Lüftungsempfehlung** über die absolute Feuchte (g/m³), nicht die relative:

```
Sättigungsdampfdruck  E(T) = 6,112 · e^(17,62·T / (243,12 + T))      [hPa]
Absolute Feuchte      AF   = 216,7 · (rF/100 · E(T)) / (273,15 + T)  [g/m³]
Taupunkt              über Magnus-Formel rückwärts
```

- „Lüften lohnt sich“, wenn `AF_innen − AF_außen ≥ 1,5 g/m³` und rF innen ≥ 60 %.
- „Lüften bringt wenig“, wenn die Differenz klein ist (typisch Dachboden im Herbst:
  68 % rF, aber draußen kaum trockener).
- „Nicht lüften“, wenn draußen absolut feuchter ist als drinnen (Sommer).

**Hinweise** (Startseite oben, nur wenn vorhanden): schwacher Akku, Sensor offline,
Fenster offen (später auch „Fenster offen + Heizung an“), Wasser erkannt (später, rot, ganz oben).

## 6. Screens

Navigation Handy: untere Leiste mit 4 Punkten. Tablet (≥ 840 px): Seitenleiste,
Übersicht links, Detail rechts.

1. **Übersicht**
   Außentemperatur groß + Wetter (jetzt, nächste Stunden, heute min/max) ·
   Hinweisleiste · Lüftungs-Karte · Räume als Kacheln (Temperatur, Feuchte, Ampel) ·
   Schnellzugriff Steckdose(n).
2. **Raum** (Tipp auf Kachel)
   Aktuelle Werte, Status in Worten, Diagramm 24 h / 7 Tage (Temperatur + Feuchte),
   Min/Max mit Uhrzeit, absolute Feuchte + Taupunkt, alle Geräte im Raum, Akku, „zuletzt gemeldet“.
3. **Klima**
   Innen/Außen-Vergleich aller Räume nach absoluter Feuchte sortiert, Lüftungsempfehlung je Raum.
4. **Geräte**
   Steckdosen: Schalter, Watt live, kWh heute/Monat (aus Statistik), kleiner Verlauf.
   Später Thermostate, Kontakte.
5. **Hinweise** (über Glocke oder Leiste): Liste mit Datum, Sprung zum Gerät.
6. **Einstellungen** (Zahnrad): Token, Theme, Außensensor, Wetter-Entität,
   Schwellen, Raumreihenfolge, Räume ausblenden/als Nebenraum markieren, Version + „Neu laden“.

Später: **Heizung** (EMS-ESP: Vorlauf, Warmwasser, Brenner, Modulation, Sollwerte) und
**Energie** (Zähler, Balkonkraftwerk, Eigenverbrauch).

## 7. Caching und Updates

HA liefert `/local/` mit langen Cache-Zeiten aus. Darum:

- `sw.js` selbst wird vom Browser bei jedem Start auf Änderungen geprüft
  (Service-Worker-Skripte umgehen den HTTP-Cache).
- In `sw.js` steht die Versionsnummer; der Cache heißt `zuhause-v0.1.0`.
  Neue Version → neuer Cache → alter wird gelöscht.
- Alle Dateien werden mit `?v=0.1.0` angefordert, damit auch der HTTP-Cache umgangen wird.
- Strategie: App-Dateien „Cache zuerst“ (sofortiger Start), Daten kommen ohnehin per WebSocket.
- Erkennt die App eine neue Version, erscheint unten „Neue Version – jetzt laden“.

Ablauf für dich nach einer Änderung: auf dem Server `git pull`, am Handy App einmal
schließen und öffnen (oder auf „jetzt laden“ tippen).

## 8. Robustheit

- Reconnect mit wachsendem Abstand (1 s, 2 s, 5 s, 10 s …), Statusanzeige „Live / Verbinde … / Offline“.
- Bei Rückkehr in die App (`visibilitychange`) sofort neu verbinden und States neu laden.
- Letzter bekannter Zustand wird lokal zwischengespeichert, damit die App sofort etwas zeigt.
- Token ungültig (`auth_invalid`) → zurück zum Anmeldebildschirm mit klarer Meldung.

## 9. Ausbaustufen

| Stufe | Inhalt |
|---|---|
| 0 | Design festlegen (siehe Gestaltungsvorschläge) |
| 1 | Grundgerüst: Anmeldung, WebSocket, Registries, Übersicht mit Räumen, Hell/Dunkel, PWA, README |
| 2 | Raumdetail mit Diagramm, Klima-Vergleich, Lüftungsempfehlung |
| 3 | Steckdose: schalten, Watt, kWh heute/Monat; Hinweise (Akku, offline) |
| 4 | Tablet-Layout, Einstellungen (Schwellen, Reihenfolge) |
| 5 | Heizung (EMS-ESP), Fenster/Wassermelder |
| 6 | Energie (IR-Lesekopf, Balkonkraftwerk) |
