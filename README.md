# Zuhause

Eigene Smart-Home-App für Home Assistant: Haus im Querschnitt mit Raumklima,
Lüftungsempfehlung über die absolute Feuchte, Verläufe, Steckdosen und Hinweise.
Vanilla HTML/CSS/JS ohne Build-Schritt, als PWA auf dem Home-Bildschirm.

- Läuft direkt aus dem HA-Ordner `config/www/zuhause/`, Adresse:
  **https://heimserver.tail8f2780.ts.net:8124/local/zuhause/**
- Daten kommen live über die HA-WebSocket-API. Der Zugangs-Token wird beim ersten Start
  eingegeben und bleibt nur auf dem jeweiligen Gerät.
- Räume, Etagen und Geräte liest die App aus Home Assistant. Ein neues Gerät erscheint
  automatisch im Raum, dem du es in HA zuweist.

Das Konzept steht in [KONZEPT.md](KONZEPT.md).

---

## Einrichten auf dem Server (einmalig)

Du brauchst ein Terminal auf dem Heimserver (direkt oder per `ssh`).
Alles, was in den grauen Kästen steht, tippst oder kopierst du Zeile für Zeile hinein
und drückst danach Enter.

**1. In den HA-Konfigurationsordner wechseln und den Ordner `www` anlegen**

```bash
cd ~/server/homeassistant/config
mkdir -p www
cd www
```

**2. Die App von GitHub holen**

```bash
git clone https://github.com/htt10-design/home.git zuhause
```

Danach gibt es den Ordner `~/server/homeassistant/config/www/zuhause` mit allen Dateien.
Falls `git` fehlt: `sudo apt install git` (fragt nach deinem Passwort).
Falls das Repo privat ist, fragt git nach Benutzername und Passwort. Als Passwort
brauchst du dann einen GitHub-Token. Einfacher ist es, das Repo öffentlich zu stellen:
Im Code stehen keine Passwörter.

**3. Home Assistant einmal neu starten** (nur nötig, wenn der Ordner `www` in Schritt 1 neu war)

HA schaltet die Adresse `/local/` nur frei, wenn `www` beim Start schon existiert.

```bash
docker ps --format '{{.Names}}'
```

zeigt die Namen deiner Container. Den von Home Assistant (meist `homeassistant`) neu starten:

```bash
docker restart homeassistant
```

**4. Testen**

Am Handy (Tailscale an) im Chrome öffnen:
`https://heimserver.tail8f2780.ts.net:8124/local/zuhause/`

## Token erstellen

1. Home Assistant öffnen → unten links auf deinen **Namen** (Profil) tippen.
2. Oben den Reiter **Sicherheit** wählen, ganz nach unten zu **Langlebige Zugangs-Token**.
3. **Token erstellen**, Namen „Zuhause-App“ eingeben, den angezeigten Token kopieren
   (er wird nur einmal angezeigt).
4. In der App einfügen und **Verbinden** tippen.

Den Token kannst du in HA jederzeit wieder löschen. Die App fragt dann neu.

## Als App auf den Home-Bildschirm

Android, Chrome: Seite öffnen → Menü **⋮** → **App installieren** (oder „Zum Startbildschirm
hinzufügen“). Danach startet Zuhause wie eine normale App ohne Browserleiste.
Auf dem Tablet genauso.

---

## Update einspielen

Wenn es eine neue Version gibt, auf dem Server:

```bash
cd ~/server/homeassistant/config/www/zuhause
git pull
```

Fertig, HA muss dafür **nicht** neu gestartet werden.

Am Handy die App schließen und wieder öffnen. Unten erscheint dann „Neue Version verfügbar“,
auf **Jetzt laden** tippen. Klappt das einmal nicht: in der App **Einstellungen → App-Dateien
neu laden**.

### Warum das funktioniert (Caching)

HA liefert alles unter `/local/` mit sehr langen Cache-Zeiten aus. Deshalb verwaltet ein
Service Worker (`sw.js`) die App-Dateien selbst:

- Die Versionsnummer steht an genau einer Stelle: `version.js`.
- Bei jeder Änderung wird sie hochgezählt. Der Browser prüft `sw.js` und `version.js`
  bei jedem Start am Cache vorbei, erkennt die neue Nummer und lädt alle Dateien frisch
  vom Server in einen neuen Cache. Der alte wird gelöscht.
- Danach startet die App sofort aus diesem Cache, auch bei schlechtem Netz.

**Wichtig für Änderungen am Code:** Nach jeder Änderung `version.js` hochzählen,
sonst bekommen die Geräte die neuen Dateien nicht. Neue Dateien zusätzlich in die
Liste `FILES` in `sw.js` eintragen.

---

## Wenn etwas nicht geht

| Problem | Lösung |
|---|---|
| Seite zeigt „404“ | Ordner heißt nicht `zuhause` oder liegt nicht in `config/www/`, oder HA wurde nach dem Anlegen von `www` nicht neu gestartet (Schritt 3). |
| „Home Assistant ist nicht erreichbar“ | Tailscale am Handy an? Läuft HA? Die normale HA-Seite unter derselben Adresse testen. |
| „Token wurde abgelehnt“ | Token in HA gelöscht oder falsch kopiert. Neuen Token erstellen. |
| Raum zeigt „kein Sensor“ | Dem Gerät in HA einen Bereich zuweisen: Einstellungen → Geräte & Dienste → Gerät → Bereich. |
| Haus steht falsch / Räume in Reihe „–“ | Den Bereichen in HA eine Etage geben: Einstellungen → Bereiche, Etagen & Zonen. Die Etage mit der höchsten Ebene steht oben, ein Dachboden allein auf der obersten Etage kommt ins Dach. |
| Kein Wetter | Integration „Meteorologisk institutt (Met.no)“ in HA hinzufügen. |
| Falscher Außensensor | App → Einstellungen → Außenbereich. |
| Alte Version wird angezeigt | App → Einstellungen → App-Dateien neu laden. |

## Sicherheit

- Im Code stehen keine Passwörter oder Tokens. Der Token liegt nur im Speicher des Geräts.
- Dateien unter `/local/` liefert HA ohne Anmeldung aus, auch den Ordner `.git`. Weil der
  Server nur über Tailscale erreichbar ist und das Repo ohnehin auf GitHub liegt, ist das
  unkritisch, solange nie ein Geheimnis ins Repo kommt.

## Aufbau

```
index.html            App-Hülle
version.js            Versionsnummer (bei jeder Änderung hochzählen)
sw.js                 Service Worker, Dateiliste FILES
manifest.webmanifest  PWA-Angaben
css/app.css           Gestaltung (Hell/Dunkel über Farb-Variablen)
js/ha.js              WebSocket-Client (Anmeldung, Reconnect, Abos)
js/store.js           Live-Zustände, Registries, Verläufe
js/model.js           Räume, Etagen, Außenwerte, Geräte, Hinweise
js/physik.js          absolute Feuchte, Taupunkt
js/chart.js           SVG-Diagramm
js/views/*.js         Bildschirme
fonts/                Archivo, IBM Plex Mono (SIL Open Font License)
icons/                App-Icons
```

Lokal ausprobieren ohne HA geht nicht sinnvoll, weil die App eine echte HA-Verbindung braucht.
In den Einstellungen lässt sich aber eine andere Server-Adresse eintragen.
