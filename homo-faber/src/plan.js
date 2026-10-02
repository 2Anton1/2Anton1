// v3: Folien-Dauern aus Sprechertext/Sprachaufnahme ableiten und music_plan.json neu schreiben.
// Dauer = max(bisherige Dauer, Sprechzeit + 2,5 s). Sprechzeit = Länge von voice/vNN.mp3, sonst Schätzung (2,3 Wörter/s).
const fs = require('fs'), { execSync } = require('child_process');
const BASE = JSON.parse(fs.readFileSync('music_plan_base.json'));
const NAR = fs.existsSync('narration.json') ? JSON.parse(fs.readFileSync('narration.json')) : [];
const VOICE_DELAY = 800, TAIL_GAP = 2500, TRANS = 1000, WPS = 2.3;
const words = s => (s || '').trim().split(/\s+/).filter(Boolean).length;
const out = { durs: [], speech: [], measured: [], voiceDelay: VOICE_DELAY };
BASE.forEach((b, k) => {
  const f = `voice/v${String(k).padStart(2, '0')}.mp3`, txt = (NAR[k] || {}).text || '';
  let ms = 0, measured = false;
  if (fs.existsSync(f)) { ms = Math.round(parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).toString()) * 1000); measured = true; }
  else if (txt) ms = Math.round(words(txt) / WPS * 1000);
  const dur = ms ? Math.max(b.dur, Math.ceil((ms + TAIL_GAP) / 100) * 100) : b.dur;
  out.durs.push(dur); out.speech.push(ms); out.measured.push(measured);
});
// Musikplan: neue Dauern + Duck-Fenster (Sekunden, relativ zum Clipanfang)
const plan = BASE.map((b, k) => {
  const p = { ...b, dur: out.durs[k] }, duck = [];
  // nur absenken, wo tatsächlich eine Aufnahme eingebettet wird
  if (out.measured[k]) duck.push([VOICE_DELAY / 1000, (VOICE_DELAY + out.speech[k]) / 1000]);
  // Ausklang dieses Clips läuft in die nächste Folie hinein (numSld=2): dort beginnt deren Stimme
  if (out.measured[k + 1]) duck.push([(out.durs[k] + TRANS + VOICE_DELAY) / 1000, (out.durs[k] + TRANS + VOICE_DELAY + out.speech[k + 1]) / 1000]);
  if (duck.length) p.duck = duck;
  return p;
});
fs.writeFileSync('music_plan.json', JSON.stringify(plan));
fs.writeFileSync('durations.json', JSON.stringify(out));
const tot = out.durs.reduce((a, b) => a + b, 0);
console.log('Folien', out.durs.length, '| Gesamt', (tot / 1000).toFixed(1), 's =', Math.floor(tot / 60000) + ':' + String(Math.round(tot / 1000) % 60).padStart(2, '0'), 'min | gemessen', out.measured.filter(Boolean).length);
