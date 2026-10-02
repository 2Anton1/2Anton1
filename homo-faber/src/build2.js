const pptxgen = require('pptxgenjs');
const fs = require('fs');
const { applyTheme } = require('/mnt/skills/public/pptx/scripts/apply_theme.js');
const { M } = require('./data');
const { buildPair, MORPH } = require('./motion');
const LJ = JSON.parse(fs.readFileSync('layers.json'));
const plan = JSON.parse(fs.readFileSync('music_plan.json'));
const DUR = JSON.parse(fs.readFileSync('durations.json'));
const NAR = fs.existsSync('narration.json') ? JSON.parse(fs.readFileSync('narration.json')) : [];
const AUTH = JSON.parse(fs.readFileSync('icon_authors.json'));

const THEME = {
  name: 'Homo faber', headFontFace: 'Cambria', bodyFontFace: 'Calibri',
  colors: { dk1: '0B0B10', lt1: 'FFFFFF', dk2: 'B9A98E', lt2: 'F4EDE1', accent1: 'F2C46D', accent2: 'FF5A4E', accent3: '7FE6FF', accent4: 'A8F0FF', accent5: '8A6FD6', accent6: 'D8FF3A', hlink: 'F2C46D', folHlink: 'B9A98E' },
};
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'Homo faber – Der Mensch und seine Werkzeuge';
pres.author = 'Anton';
const C = pres.SchemeColor;
const SW = 13.333, SH = 7.5, PX = 144;
const shadowTxt = () => ({ type: 'outer', blur: 10, offset: 0, angle: 90, color: '000000', opacity: 0.75 });
const META = [];
let slideNo = 0;
const dur = k => DUR.durs[k];

// motion vectors per particle type (fraction of slide w/h over one slide)
const DRIFT = { dust: [0.05, -0.03], embers: [0.03, -0.11], sparks: [0.02, -0.1], ash: [-0.04, 0.1], snow: [-0.03, 0.1], data: [0, -0.08], toxicP: [0.02, -0.05] };

// Ebenen werden erst gesammelt (für Vorschau/Prüfung in meta.json) und dann eingefügt
function put(slide, LY, name, file, x, y, w, h, rotate = 0, kind = 'img') {
  const o = { path: file, x, y, w, h, objectName: name, altText: name };
  const r = ((rotate % 360) + 360) % 360; if (Math.abs(r) > 0.01) o.rotate = r;
  slide.addImage(o); LY.push({ name, file, x, y, w, h, rot: r, kind });
}
function img(slide, LY, L, name, zoom = 1, extra = {}) {
  const w = L.w * zoom, h = L.h * zoom, x = L.x - (w - L.w) / 2 + (extra.dx || 0), y = L.y - (h - L.h) / 2 + (extra.dy || 0);
  put(slide, LY, name, L.file, x, y, w, h, extra.rotate || 0);
}
// zoom about slide centre: position must also scale away from centre for full-frame layers
function imgFrame(slide, LY, L, name, zoom) {
  const cx = SW / 2, cy = SH / 2;
  put(slide, LY, name, L.file, cx + (L.x - cx) * zoom, cy + (L.y - cy) * zoom, L.w * zoom, L.h * zoom);
}

// ---- Keyframes: Reduktion (Ramer-Douglas-Peucker je Eigenschaft) und Referenzzustand ----
const TOL = { x: 0.6, y: 0.6, sx: 0.0025, sy: 0.0025, r: 0.25 };
function rdp(P, eps) {
  if (P.length < 3) return P;
  const [t0, v0] = P[0], [t1, v1] = P[P.length - 1]; let iMax = 0, dMax = 0;
  for (let i = 1; i < P.length - 1; i++) { const v = v0 + (v1 - v0) * (P[i][0] - t0) / ((t1 - t0) || 1), d = Math.abs(P[i][1] - v); if (d > dMax) { dMax = d; iMax = i; } }
  if (dMax <= eps) return [P[0], P[P.length - 1]];
  const a = rdp(P.slice(0, iMax + 1), eps), b = rdp(P.slice(iMax), eps); return a.slice(0, -1).concat(b);
}
function reduceKf(a) {
  const props = {};
  for (const k of ['x', 'y', 'sx', 'sy', 'r']) {
    let P = a.keys.map(q => [q.t, +q[k].toFixed(k[0] === 's' ? 5 : 3)]);
    P = P.filter((p, i) => i === 0 || p[0] > P[i - 1][0]);
    const lo = Math.min(...P.map(p => p[1])), hi = Math.max(...P.map(p => p[1]));
    props[k] = hi - lo <= TOL[k] * 0.5 ? [[P[0][0], P[0][1]], [P[P.length - 1][0], P[P.length - 1][1]]] : rdp(P, TOL[k]);
  }
  return { t: 'kf', id: a.id, ref: a.ref, props };
}
const refOf = kf => Object.fromEntries(Object.entries(kf.props).map(([k, P]) => [k, kf.ref === 'end' ? P[P.length - 1][1] : P[0][1]]));
const endOf = kf => Object.fromEntries(Object.entries(kf.props).map(([k, P]) => [k, P[P.length - 1][1]]));
// Ebene im Zustand s (px-Versatz, Skalierung, Drehung) platzieren
function placeState(slide, LY, g, name, s) {
  const cx = g.x + g.w / 2 + s.x / PX, cy = g.y + g.h / 2 + s.y / PX, w = g.w * s.sx, h = g.h * s.sy;
  put(slide, LY, name, g.file, cx - w / 2, cy - h / 2, w, h, s.r);
}
const ID = { x: 0, y: 0, sx: 1, sy: 1, r: 0 };

function progress(slide, i, n, accent) {
  const x0 = 1140 / 144, x1 = 1780 / 144, y = 1022 / 144;
  slide.addShape(pres.shapes.LINE, { x: x0, y, w: x1 - x0, h: 0, line: { color: C.background1, width: 0.75, transparency: 82 }, objectName: 'tl' });
  for (let k = 0; k < n; k++) {
    const x = x0 + (x1 - x0) * k / (n - 1);
    if (k === i) slide.addShape(pres.shapes.OVAL, { x: x - 0.045, y: y - 0.045, w: 0.09, h: 0.09, fill: { color: accent }, line: { type: 'none' }, objectName: 'tlcur' });
    else slide.addShape(pres.shapes.OVAL, { x: x - 0.018, y: y - 0.018, w: 0.036, h: 0.036, fill: { color: C.background1, transparency: k < i ? 45 : 80 }, line: { type: 'none' }, objectName: 'tl' + k });
  }
}
// Texte (Lage wird für die Vorschau mitgeschrieben)
let TX = [];
const txt = (s, t, o) => { s.addText(t, o); TX.push({ name: o.objectName, text: t, x: o.x, y: o.y, w: o.w, h: o.h, size: o.fontSize, italic: !!o.italic, align: o.align || 'left' }); };
const year = (s, t) => txt(s, t.toUpperCase(), { x: 0.75, y: 5.0, w: 6.2, h: 0.4, margin: 0, fontSize: 14, bold: true, charSpacing: 5, color: C.text2, isTextBox: true, objectName: 'year', shadow: shadowTxt() });
const title = (s, t, size = 48, y = 5.36) => txt(s, t, { x: 0.72, y, w: 8, h: 0.95, margin: 0, fontFace: '+mj-lt', fontSize: size, color: C.background2, isTextBox: true, objectName: 'title', valign: 'middle', shadow: shadowTxt() });
const sub = (s, t, color) => txt(s, t, { x: 0.75, y: 6.34, w: 7, h: 0.5, margin: 0, fontFace: '+mj-lt', italic: true, fontSize: 24, color, isTextBox: true, objectName: 'sub', shadow: shadowTxt() });

let curSec = null;
function newSlide(sec) { if (sec !== curSec) { pres.addSection({ title: sec }); curSec = sec; } TX = []; return pres.addSlide({ sectionTitle: sec }); }

/**
 * Generic scene builder (Hintergrund-Ebenen wie bisher; Werkzeug-Ebenen v3 aus motion.js)
 * o.mot: Slide-Objekt aus motion.js (oder null für Prolog/Ausblick)
 */
function scene(s, key, o) {
  const sc = LJ.scenes[key], Ly = sc.layers, d = o.dur, A = [], LY = [], mot = o.mot, st = mot && mot.static;
  s.background = { color: '000000' };
  imgFrame(s, LY, Ly.sky, 'sky', o.z0.sky); if (!st) A.push({ t: 'scale', id: 'sky', by: o.z1.sky / o.z0.sky, dur: d });
  if (Ly.disc) { img(s, LY, Ly.disc, 'disc', 1, { dy: o.discDy0 || 0 }); A.push({ t: 'move', id: 'disc', dx: 0, dy: o.discMove || -0.05, dur: d, ease: true }); }
  if (Ly.rays) { img(s, LY, Ly.rays, 'rays', 1, { rotate: o.rayRot0 || 0 }); if (!st) A.push({ t: 'spin', id: 'rays', deg: 9, dur: d }); }
  if (Ly.clouds) { img(s, LY, Ly.clouds, 'clouds', 1); if (!st) A.push({ t: 'move', id: 'clouds', dx: 0.035, dy: 0, dur: d }); }
  if (Ly.land) { imgFrame(s, LY, Ly.land, 'land', o.z0.land); if (!st) A.push({ t: 'scale', id: 'land', by: o.z1.land / o.z0.land, dur: d }); }
  if (mot) {
    // Werkzeug-Ebenen: Keyframes reduzieren, Layout = Referenzzustand (Start bzw. Ende bei Morph-Vorfolien)
    const KF = {}; for (const a of mot.A) if (a.t === 'kf') KF[a.id] = reduceKf(a);
    const geo = n => (n === 'icon' ? Ly.icon : sc.fx[n]);
    const placeLayer = n => { const g = geo(n); if (!g) throw new Error(key + ': keine Ebene ' + n); placeState(s, LY, g, n, KF[n] ? refOf(KF[n]) : ID); };
    const carryL = z => mot.carry.filter(c => c.z === z).forEach(c => placeState(s, LY, c.geo, c.as, c.state));
    mot.fx.filter(f => f.z === 'back').forEach(f => placeLayer(f.name));
    carryL('back');
    if (Ly.icon && !mot.noIcon) placeLayer('icon');
    carryL('front');
    mot.fx.filter(f => f.z !== 'back').forEach(f => placeLayer(f.name));
    for (const a of mot.A) A.push(a.t === 'kf' ? KF[a.id] : a);
    o.kfOut = KF;
  } else if (Ly.icon) {
    img(s, LY, Ly.icon, 'icon', o.iconZ0 || 1);
    for (const a of o.iconAnims) A.push({ ...a, id: 'icon' });
  }
  if (Ly.orb) { img(s, LY, Ly.orb, 'orb'); A.push({ t: 'fadeIn', id: 'orb', delay: 1500, d: 2200 }, { t: 'scale', id: 'orb', by: 1.3, dur: 1600, delay: 1500, autoRev: true, repeat: 3 }, { t: 'move', id: 'orb', dx: 0, dy: -0.02, dur: d - 1500, delay: 1500 }); }
  if (sc.particles) {
    const p = sc.particles, v = DRIFT[p];
    img(s, LY, LJ.shared['p_' + p], 'parts'); if (!st) A.push({ t: 'move', id: 'parts', dx: v[0], dy: v[1], dur: d });
    img(s, LY, LJ.shared['b_' + p], 'bokeh'); if (!st) A.push({ t: 'move', id: 'bokeh', dx: v[0] * 1.6, dy: v[1] * 1.6, dur: d });
  }
  if (o.cave) img(s, LY, LJ.shared.cave, 'caveframe');
  img(s, LY, LJ.shared.overlay, 'overlay');
  o.LY = LY;
  return A;
}

// Audio: Musik (läuft in die nächste Folie, numSld=2) + Sprecher (nur diese Folie, numSld=1, Start 800 ms)
function media(s, k) {
  s.addMedia({ type: 'audio', path: `audio/a${String(k).padStart(2, '0')}.mp3`, x: -1.2, y: -1.2, w: 0.4, h: 0.4 });
  const v = `voice/v${String(k).padStart(2, '0')}.mp3`;
  if (fs.existsSync(v)) { s.addMedia({ type: 'audio', path: v, x: -1.2, y: -0.6, w: 0.4, h: 0.4 }); return true; }
  return false;
}
const narr = k => (NAR[k] || {}).text || '';
const credit = icons => icons.filter(Boolean).map(n => `${n.replace(/^Gi/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2')} von ${AUTH[n].author}`).join(', ');
function notes(s, k, base, icons = []) {
  let t = base;
  if (narr(k)) t += `\n\nSprechertext (gesprochen, englisch): ${narr(k)}` + ((NAR[k] || {}).text_de ? `\nDeutsche Fassung: ${NAR[k].text_de}` : '');
  if (icons.filter(Boolean).length) t += `\n\nIcons: ${credit(icons)} – game-icons.net, Lizenz CC BY 3.0.`;
  s.addNotes(t);
}
const textIn = (L) => L.map(([id, delay, d]) => ({ t: 'fadeIn', id, delay, d, rise: true }));
function push(meta, o) { META.push({ ...meta, layers: o.LY, texts: TX, voice: o.voice, speech: DUR.speech[slideNo], narration: narr(slideNo) }); slideNo++; }

// ===== Intro =====
{
  const s = newSlide('Prolog'), d = dur(slideNo), o = { dur: d, z0: { sky: 1, land: 1 }, z1: { sky: 1.06, land: 1.1 }, iconAnims: [] };
  const A = scene(s, 'intro', o);
  put(s, o.LY, 'meteor', LJ.shared.meteor.file, 1.6, 0.7, LJ.shared.meteor.w * 0.8, LJ.shared.meteor.h * 0.8, 16);
  A.push({ t: 'fadeIn', id: 'meteor', delay: 5200, d: 150 }, { t: 'move', id: 'meteor', dx: 0.3, dy: 0.155, dur: 1300, delay: 5200, ease: false }, { t: 'fadeOut', id: 'meteor', delay: 6200, d: 300 });
  txt(s, 'Homo faber', { x: 0.72, y: 5.15, w: 8, h: 1.0, margin: 0, fontFace: '+mj-lt', fontSize: 60, color: C.background2, isTextBox: true, objectName: 'title', shadow: shadowTxt() });
  txt(s, 'MENSCH & WERKZEUG', { x: 0.75, y: 6.25, w: 6, h: 0.4, margin: 0, fontSize: 14, bold: true, charSpacing: 6, color: C.accent1, isTextBox: true, objectName: 'sub', shadow: shadowTxt() });
  o.voice = media(s, slideNo);
  A.push(...textIn([['title', 2400, 2200], ['sub', 4600, 1600]]));
  notes(s, slideNo, `Prolog: Der Mensch als „Homo faber“ – das Wesen, das Werkzeuge herstellt. Die Präsentation läuft automatisch mit Musik und Erzählstimme (ca. ${Math.round(DUR.durs.reduce((a, b) => a + b, 0) / 60000)} Minuten). Jede Erfindung erscheint zuerst im Licht (Nutzen), dann im Schatten (Schaden).`);
  push({ dur: d, thruBlk: true, anims: A }, o);
}

// ===== Milestones =====
M.forEach((m, i) => {
  const n = String(i + 1).padStart(2, '0');
  const tSize = m.title.length > 14 ? 42 : 48;
  const kL = slideNo, durL = dur(kL), durS = dur(kL + 1);
  const cave = m.L.terrain === 'cave', morph = MORPH.has(i);
  const P = buildPair(i, durL, durS);
  // --- Licht ---
  const a = newSlide(m.sec);
  const oa = { dur: durL, z0: { sky: 1, land: 1 }, z1: { sky: 1.05, land: 1.08 }, cave, mot: P.L };
  const A = scene(a, `m${n}a`, oa);
  year(a, m.year); title(a, m.title, tSize); sub(a, m.light, C.accent1);
  progress(a, i, M.length, C.accent1);
  oa.voice = media(a, slideNo);
  A.push(...textIn([['year', 500, 1000], ['title', 900, 1500], ['sub', 2600, 1300]]));
  notes(a, slideNo, `${m.title} (${m.year}) – Licht: ${m.light}. ${m.notes}`, [m.L.icon]);
  push({ dur: durL, thruBlk: true, anims: A }, oa);

  // --- Schatten ---
  const b = newSlide(m.sec);
  // Carry-Ebenen: Bild und Endzustand der Licht-Folie
  const gL = n2 => (n2 === 'icon' ? LJ.scenes[`m${n}a`].layers.icon : LJ.scenes[`m${n}a`].fx[n2]);
  for (const c of P.S.carry) { c.geo = gL(c.layer); const kf = oa.kfOut[c.layer]; c.state = kf ? endOf(kf) : { ...ID }; }
  // Startzoom = Endzoom der Licht-Folie (bei Morph-Vorfolie ruhig: 1,0)
  const z0 = morph ? { sky: 1, land: 1 } : { sky: 1.05, land: 1.08 };
  const ob = { dur: durS, z0, z1: { sky: z0.sky + (m.long ? 0.07 : 0.04), land: z0.land + (m.long ? 0.08 : 0.05) }, cave, mot: P.S };
  const B = scene(b, `m${n}b`, ob);
  if (m.long) {
    // nuclear flash + camera shake
    b.addShape(pres.shapes.RECTANGLE, { x: -0.2, y: -0.2, w: SW + 0.4, h: SH + 0.4, fill: { color: 'FFF8EA' }, line: { type: 'none' }, objectName: 'flash' });
    ob.LY.push({ name: 'flash', kind: 'rect', color: '#FFF8EA', x: -0.2, y: -0.2, w: SW + 0.4, h: SH + 0.4, rot: 0 });
    B.push({ t: 'fadeOut', id: 'flash', delay: 150, d: 2600 });
    for (const id of ['sky', 'land']) B.push({ t: 'shake', id, delay: 200, dur: 90, repeat: 14 });
  }
  year(b, m.year); title(b, m.title, tSize); sub(b, m.shadow, C.accent2);
  progress(b, i, M.length, C.accent2);
  ob.voice = media(b, slideNo);
  if (!P.S.subStatic) B.push(...textIn([['sub', 1300, 1300]]));
  notes(b, slideNo, `${m.title} – Schatten: ${m.shadow}. ${m.notes}`, [m.S.icon, P.S.carry.length ? m.L.icon : null]);
  push({ dur: durS, thruBlk: false, morph, anims: B }, ob);
});

// ===== Outro =====
{
  let s = newSlide('Ausblick'), d = dur(slideNo), o = { dur: d, z0: { sky: 1, land: 1 }, z1: { sky: 1.05, land: 1.08 }, discMove: -0.07, iconAnims: [] };
  let A = scene(s, 'o1', o);
  year(s, '2030 →'); title(s, 'Darüber hinaus'); sub(s, 'Fusion · Mars · Neurotech', C.accent1); o.voice = media(s, slideNo);
  A.push(...textIn([['year', 500, 1000], ['title', 900, 1500], ['sub', 2800, 1400]]));
  notes(s, slideNo, 'Ausblick: Kernfusion, Besiedlung anderer Planeten, Gehirn-Computer-Schnittstellen, allgemeine KI – jede dieser Technologien wird wieder Licht und Schatten haben.');
  push({ dur: d, thruBlk: true, anims: A }, o);

  s = newSlide('Ausblick'); d = dur(slideNo); o = { dur: d, z0: { sky: 1.05, land: 1.08 }, z1: { sky: 1.09, land: 1.13 }, discDy0: -0.07 * SH, discMove: -0.03, iconAnims: [] };
  A = scene(s, 'o2', o);
  year(s, '2030 →'); title(s, 'Darüber hinaus'); sub(s, 'Wer entscheidet?', C.accent2); o.voice = media(s, slideNo);
  A.push(...textIn([['sub', 1300, 1300]]));
  notes(s, slideNo, 'Die offene Frage: Wer bestimmt, wofür die nächsten Werkzeuge eingesetzt werden?');
  push({ dur: d, thruBlk: false, anims: A }, o);

  s = newSlide('Ausblick'); d = dur(slideNo); o = { dur: d, z0: { sky: 1, land: 1 }, z1: { sky: 1.07, land: 1.1 }, iconAnims: [{ t: 'fadeIn', delay: 400, d: 2200 }, { t: 'move', dx: 0, dy: -0.025, dur: d, ease: true }] };
  A = scene(s, 'o3', o);
  title(s, 'In unserer Hand.'); o.voice = media(s, slideNo);
  A.push(...textIn([['title', 4200, 2400]]));
  notes(s, slideNo, 'Schluss: Das Werkzeug selbst ist weder gut noch böse. Wie seit dem ersten Faustkeil liegt die Entscheidung beim Menschen.', ['GiOpenPalm']);
  push({ dur: d, thruBlk: true, anims: A }, o);

  s = newSlide('Ausblick'); d = dur(slideNo); o = { dur: d, z0: { sky: 1, land: 1 }, z1: { sky: 1.04, land: 1.05 }, iconAnims: [] };
  A = scene(s, 'o4', o);
  txt(s, 'HOMO FABER', { x: 0, y: 3.45, w: SW, h: 0.5, margin: 0, align: 'center', fontSize: 16, bold: true, charSpacing: 10, color: C.text2, isTextBox: true, objectName: 'title' });
  // v3: Namensnennung der Icons (CC BY 3.0)
  const authors = [...new Set(Object.values(AUTH).map(a => a.author))].sort();
  txt(s, `Icons: game-icons.net – ${authors.join(', ')} · Lizenz CC BY 3.0 (creativecommons.org/licenses/by/3.0)`, { x: 1.5, y: 6.55, w: SW - 3, h: 0.35, margin: 0, align: 'center', fontSize: 11, color: C.text2, isTextBox: true, objectName: 'credits' });
  o.voice = media(s, slideNo);
  A.push({ t: 'fadeIn', id: 'title', delay: 1200, d: 2200 }, { t: 'fadeOut', id: 'title', delay: Math.max(5600, d - 2400), d: 1800 }, { t: 'fadeIn', id: 'credits', delay: 1800, d: 1500 });
  const list = Object.entries(AUTH).map(([k, v]) => `${k.replace(/^Gi/, '')} – ${v.author} (${v.url})`).join('\n');
  notes(s, slideNo, `Abspann.\n\nNamensnennung: Alle Icons stammen von game-icons.net und stehen unter der Lizenz Creative Commons Attribution 3.0 Unported (CC BY 3.0, https://creativecommons.org/licenses/by/3.0/). Eingebunden über react-icons (Paket react-icons/gi); für die Animationen teils beschnitten oder in Teile zerlegt.\n\n${list}`);
  push({ dur: d, thruBlk: true, anims: A }, o);
}

(async () => {
  await pres.writeFile({ fileName: 'raw2.pptx' });
  await applyTheme('raw2.pptx', THEME);
  fs.writeFileSync('meta.json', JSON.stringify(META));
  console.log('slides', META.length, 'music clips', slideNo, 'plan', plan.length, 'voice', META.filter(m => m.voice).length, 'total s', META.reduce((a, m) => a + m.dur, 0) / 1000);
})();
