# Meine Handschrift

Web-App für das iPad: eigene Handschrift mit dem Apple Pencil erfassen und beliebigen Text darin auf liniertem Papier ausgeben (PNG/PDF). Alle Daten bleiben lokal im Browser (IndexedDB).

## Aufbau

| Datei | Aufgabe |
|---|---|
| `index.html`, `app.css` | Oberfläche (3 Ansichten: Erfassen, Übersicht, Schreiben) |
| `capture.js` | Schreibfläche mit Hilfslinien, nur Apple Pencil (`pointerType "pen"`), Varianten |
| `overview.js` | Raster aller Zeichen, Zusatzzeichen, Backup als JSON |
| `layout.js` | Satz-Engine: längste Kombination zuerst, Zufall, Zeilenumbruch, Silbentrennung, Seitenumbruch |
| `paper.js` | Papier-Vorlagen und automatische Linienerkennung in Fotos |
| `render.js`, `pdf.js` | Zeichnen auf Canvas (Vorschau/PNG) und als Vektor-PDF |
| `state.js`, `store.js` | Zustand und lokale Speicherung |
| `perfect-freehand.js`, `hypher.js`, `hyphenation-de.js` | Bibliotheken: perfect-freehand (MIT), Hypher (BSD), deutsche Trennmuster |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Home-Bildschirm-App und Offline-Betrieb |

Kein Build-Schritt, keine Abhängigkeiten zur Laufzeit aus dem Internet.

## Auf dem iPad öffnen

### Variante A: GitHub Pages (empfohlen, kostenlos, HTTPS, offline nutzbar)
1. Auf github.com ein kostenloses Konto anlegen und oben rechts **+ → New repository** wählen, z. B. Name `handschrift`, **Public**, dann **Create repository**.
2. Auf der neuen Seite **uploading an existing file** anklicken und alle Dateien dieses Ordners markieren (Strg+A) und hineinziehen. Es gibt keine Unterordner. **Commit changes**.
3. Im Repository **Settings → Pages**: bei *Source* „Deploy from a branch“, Branch `main`, Ordner `/ (root)`, **Save**.
4. Nach 1–2 Minuten ist die App unter `https://DEINNAME.github.io/handschrift/` erreichbar.
5. Auf dem iPad diese Adresse in **Safari** öffnen → Teilen-Symbol → **Zum Home-Bildschirm**. Ab jetzt startet die App im Vollbild, auch ohne Internet.

### Variante B: Lokaler Server im selben WLAN
1. Auf dem PC doppelt auf `start-server.bat` klicken (benötigt Python). Falls die Windows-Firewall fragt: Zugriff im **privaten Netzwerk** erlauben.
2. Das Fenster zeigt eine Adresse wie `http://192.168.178.23:8000` – diese auf dem iPad in Safari öffnen.
3. Optional: Teilen → **Zum Home-Bildschirm**.

Einschränkungen von Variante B (kein HTTPS): keine Offline-Nutzung, und statt „Teilen“ werden Dateien direkt heruntergeladen (landen in der Dateien-App unter *Downloads*).

**Wichtig:** Die Daten gehören zur Adresse. GitHub-Pages-Version, lokale Version und die Home-Bildschirm-App haben jeweils eigene Speicher. Zum Umziehen: *Übersicht → Backup exportieren* und dort *Backup importieren*.

## Updates veröffentlichen
Nach Änderungen an Dateien in `sw.js` die Zeile `const VERSION = 'handschrift-v2'` hochzählen, damit iPads die neue Version laden.
