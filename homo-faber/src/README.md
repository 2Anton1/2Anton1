# Homo faber – Quellcode der Film-Präsentation (v3)

v3 ergänzt kontextgerechte Werkzeug-Animationen (inkl. Morph und Zusatzebenen) und eine Erzählstimme.
Bildstil, Texte und Reihenfolge sind unverändert. Plan: `ANIMATIONSPLAN.md`, Texte: `Sprechertext.md`.

Pipeline (Arbeitsverzeichnis = dieser Ordner):

1. `npm install pptxgenjs sharp react react-dom react-icons` und `pip install numpy scipy lameenc --break-system-packages`
   (Node mit `NODE_PATH=$PWD/node_modules`, damit `apply_theme.js` pptxgenjs findet)
2. `node render_layers.js`  → Bildebenen + Zusatzebenen (Speer, Rauch, Funken …) in `lay/`, `layers.json`
3. `python3 narration_src.py` → `narration.json` (Sprechertexte)
4. optional: Aufnahmen als `voice/v00.mp3 … voice/v54.mp3` ablegen (Index = Folie − 1)
5. `node plan.js`           → Folien-Dauern (max(alt, Sprechzeit + 2,5 s)), `durations.json`, `music_plan.json` inkl. Duck-Fenster
6. `python3 music.py`       → Musik-Clips pro Folie in `audio/` (unter der Stimme −10 dB)
7. `node build2.js`         → `raw2.pptx` + `meta.json`
8. `python3 post2.py`       → `Homo_faber_Film.pptx` (Übergänge inkl. Morph, Keyframe-Timeline, Musik + Sprecher, Deduplizierung)
9. `python3 /mnt/skills/public/pptx/scripts/office/validate.py Homo_faber_Film.pptx`
10. `python3 preview.py`    → Kontrollbilder `qa/frames/` (0/50/100 %) + automatische Prüfung `qa/report.txt`

Dateien:
- `data.js`        Inhalte der 25 Meilensteine (unverändert)
- `scenes.js`      Szenen-Hilfsfunktionen (unverändert)
- `layers.js`      Ebenen pro Szene; v3: Icon-Ausschnitte (`iconCut`, `iconKeep`)
- `jobs.js`        Szenen-Spezifikationen; v3: Lage-Korrekturen (`PATCH`) für Textzone und Bewegungsraum
- `fx.js`          v3: Zusatzebenen im Silhouetten-/Glow-Stil
- `motion.js`      v3: 25 Bewegungspaare (Licht/Schatten) als Keyframe-Bahnen in „Paarzeit“, Carry/Morph-Logik
- `plan.js`        v3: Dauern aus Sprechtext/Aufnahme, Musikplan mit Duck-Fenstern
- `music.py`       Generative Filmmusik; v3: Ducking unter der Stimme
- `build2.js`      Baut das Deck; v3: Keyframe-Reduktion, Carry-Ebenen, Sprecher-Audio, Notizen mit Sprechertext und Icon-Nachweis
- `post2.py`       OOXML-Timing; v3: `ppt_x/ppt_y/ppt_w/ppt_h`-Keyframes, `animRot`-Ketten, Orbits, Appear/Disappear,
                   Morph (`p159:morph` mit `<p:fade/>`-Fallback), zweite Audiospur (numSld=1, 800 ms), Konsistenzprüfungen
- `preview.py`     v3: Python-Kompositor für Kontrollbilder und automatische Prüfungen
- `icon_authors.json` Urheber aller Icons (game-icons.net)

Bekannte Fallstricke (gelöst): pptxgenjs schreibt `<a:videoFile>` statt `<a:audioFile>` und doppelte Medien-Shape-IDs;
Content-Type `audio/mpeg`; cTn-IDs eindeutig und aufsteigend; Medien-Deduplizierung; Python 3.11-kompatible f-Strings.

Icons: game-icons.net via react-icons (Lizenz CC BY 3.0) – Urheber: Lorc, Delapouite, Skoll, Quoting, Cathelineau, Sbed
(Einzelnachweis in `icon_authors.json`, im Abspann und in den Folien-Notizen).
