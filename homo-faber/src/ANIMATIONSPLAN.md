# Animationsplan v3 – Werkzeuge in Bewegung

Koordinaten in Szenen-Pixeln (1920 × 1080, 144 px/in). Schutzzone Text: x < 1181 px **und** y > 706 px.
Alle Bewegungen sind Keyframe-Spuren (`kf`) in `build2.js` → `post2.py` schreibt sie als
`<p:anim>` auf `ppt_x/ppt_y/ppt_w/ppt_h` (Formeln relativ zur Layout-Lage) und als kettenweise
`<p:animRot by=…>`-Segmente. `preview.py` rechnet exakt dieselben (reduzierten) Keyframes nach.

**Übergänge**
- Licht → Schatten: Überblendung ohne Schwarz. Was am Ende der Licht-Folie in Bewegung ist, liegt auf der
  Schatten-Folie als Ebene `carry` (gleiche Bilddatei) **exakt im Endzustand** und bewegt sich dort weiter.
- Morph (`p159:morph`, Fallback `<p:fade/>`) bei drei Paaren, deren Objekt *über den Schnitt fliegt*:
  Speer (`!!spear`), Flugzeug (`!!plane`), Rakete → Raketenschwarm (`!!rocket`).
  Morph rechnet von der *statischen* Lage der Vorfolie aus. Daher liegt dort jedes animierte Objekt im Layout
  bereits im Endzustand (Keyframes relativ zum Ende). Hintergrund-Ebenen bleiben auf diesen drei Licht-Folien
  ruhig, damit nichts zurückspringt.
- Schatten → nächstes Licht: wie bisher Überblendung durch Schwarz.

| # | Licht (Nutzen) | Schatten (Schaden) | Zusatzebenen |
|---|---|---|---|
| 1 | Faustkeil holt zweimal aus und schlägt zu (Drehpunkt Griffende), Splitter beim Aufschlag | Keil schlägt ein letztes Mal, Schädel erscheint mit Ruck, Riss-Splitter | `chips1/2`, `carry` |
| 2 | Flammen flackern (y-Skalierung, Anker Glut), Funken steigen | Lagerfeuer wächst und geht im Waldbrand auf, mehr Funken | `fglow`, `ember1–3`, `carry` |
| 3 | Jäger holt aus, wirft; Speer fliegt Bogenbahn (Tangente) | Speer fliegt per Morph weiter, trifft das Mammut; Mammut sinkt und verblasst | `iconNS`, `!!spear`, `dust` |
| 4 | Handabdruck wird „aufgestempelt“ | Hand verblasst, Maske pulsiert im Trommeltakt und wiegt sich | `carry` |
| 5 | Weizen wiegt sich im Wind (Drehpunkt Halmfuß) | Weizen sinkt, Krone steigt auf, Glanzlicht | `glint`, `carry` |
| 6 | Rad rollt ins Bild und kommt zum Stehen (Drehung = Weg/r) | Streitwagen prescht heran, Staub | `dust1/2`, `carry` |
| 7 | Schriftrolle entrollt sich (x-Skalierung, Anker links) | Auge „öffnet sich“ (y-Skalierung), pulsiert | `carry` |
| 8 | Sichel schwingt dreimal (Drehpunkt Griff), Glanz auf der Klinge | Schwerter prallen zweimal, Funken | `glint`, `spark1/2`, `carry` |
| 9 | Feuerwerksrakete steigt zweimal auf und zerplatzt | Kanone feuert zweimal: Mündungsblitz, Rückstoß, Rauch | `burst1/2`, `muzzle`, `smoke1–4` |
| 10 | Buch öffnet sich, Lettern steigen auf | Megafon stößt Schallwellen aus | `let1–4`, `wave1/2`, `carry` |
| 11 | Karavelle schaukelt und treibt (Drehpunkt Kiel) | Schiff treibt ab, Fesseln pendeln an der oberen Schelle | `carry` |
| 12 | Lok fährt ins Bild, stampft, Dampf pufft aus dem Schlot | Lok verschwindet, Fabrikschlote qualmen | `steam1–4`, `smoke1–4`, `carry` |
| 13 | Spritze sticht, Tropfen fällt von der Nadel | Virus dreht sich, Kopien vermehren sich | `drop`, `vir1–3`, `carry` |
| 14 | Glühbirne flackert an | Birne flackert aus, Funken an den Mastarmen | `iconOff`, `bglow`, `arc1/2`, `carry` |
| 15 | Auto fährt herein, federt | Auto fährt weiter, Aufprall-Blitz, Totenkopf | `speed`, `flash`, `carry` |
| 16 | Ölfass fällt, prallt auf, staucht | Fass versinkt, Quecksilber steigt, Hitze pulsiert | `merc`, `hglow`, `carry` |
| 17 | Doppeldecker nähert sich (wächst), rollt | Flugzeug zieht per Morph über die Szene, Bomben fallen, Einschläge | `!!plane`, `blast1–3` |
| 18 | Kolben schwenkt, Blasen steigen | Kolben kippt weg, Gaswolken ziehen herein, Maske „atmet“ | `bub1–4`, `gas1–3`, `carry` |
| 19 | Elektronen kreisen auf den drei Bahnen, Kern glüht auf | (Blitz + Beben wie bisher) Pilzwolke steigt und wächst | `el1–3`, `core` |
| 20 | Monitor bootet (Bildschirmglühen flackert), Bits steigen | Roboterarm schwenkt (Drehpunkt Schulter) über dem Band | `screen`, `bit1–3`, `iconBase`, `carry` |
| 21 | Doppelhelix verdreht sich (x-Skalierung), Glanz | Biohazard-Zeichen rotiert, Glühen pulsiert | `glint`, `carry` |
| 22 | Rakete bebt, hebt ab, beschleunigt; Abgasglühen, Startrauch | Rakete wird per Morph zum Raketenschwarm, der herabstößt | `exh`, `smoke1/2`, `!!rocket` |
| 23 | Globus dreht sich: Längengrad wandert über die Kugel, Datenpakete kreisen | Doppelmaske dreht sich wie eine Münze | `merL/merR`, `pk1/2`, `carry` |
| 24 | Smartphone vibriert, Benachrichtigungen ploppen auf | Überwachungskamera schwenkt, rote LED blinkt | `nt1–3`, `led`, `carry` |
| 25 | Gehirn atmet, Synapsen blitzen | Cyber-Auge blickt umher (Rotation um Augenmitte), rote Iris glüht | `syn1–4`, `carry` |

Prolog und Ausblick bleiben unverändert. Der Abspann bekommt die Icon-Namensnennung.

**Regeln, die `preview.py` automatisch prüft (alle 100 ms):**
- Keine Werkzeug-Ebene (Alpha ≥ 0,35) außerhalb des Bildes und keine in der Textzone.
- Kein Keyframe nach `advTm`.
- Endzustand Licht = Startzustand `carry` bzw. `!!`-Objekt auf der Schatten-Folie.
