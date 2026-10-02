// v3: kontextgerechte Werkzeug-Animationen. Pro Meilenstein ein Bewegungspaar (Licht + Schatten).
// Zustände: { x, y } = Versatz in Szenen-px vom Layout-Mittelpunkt der Ebene, sx/sy = Skalierung, r = Drehung (Grad, im Uhrzeigersinn).
// Bahnen sind Funktionen der "Paarzeit" T: Licht-Folie 0…D; Schatten-Folie setzt bei T = D (Überblendung, Ebene 'carry')
// bzw. T = D + TM (Morph, Objekt fliegt während des Übergangs weiter) fort.
const { jobs } = require('./jobs');
const { CUTS } = require('./layers');
const SPEC = Object.fromEntries(jobs);
const TM = 1000;          // angenommene Dauer des Morph-Übergangs (spd="slow")
const STEP = 40;          // Abtastung der Bahnen in ms (danach Reduktion)

// ---------- Mathe ----------
const clamp = u => Math.max(0, Math.min(1, u));
const eio = u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const eo = u => 1 - Math.pow(1 - u, 3);
const ei = u => u * u * u;
const ei2 = u => u * u;
// stückweise Interpolation: K = [[t, v, ease?], …]
function pw(K, t) {
  if (t <= K[0][0]) return K[0][1];
  for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const [t0, v0] = K[i - 1], [t1, v1, e] = K[i]; const u = (t - t0) / ((t1 - t0) || 1); return v0 + (v1 - v0) * (e ? e(u) : u); }
  return K[K.length - 1][1];
}
const sin = Math.sin, cos = Math.cos, PI = Math.PI, rad = d => d * PI / 180;
const st = (o = {}) => ({ x: o.x || 0, y: o.y || 0, sx: o.sx ?? o.s ?? 1, sy: o.sy ?? o.s ?? 1, r: o.r || 0 });
// Transformation um einen Drehpunkt p (px relativ zum Ebenenmittelpunkt): erst skalieren, dann drehen
function piv(p, o) {
  const s = st(o), a = rad(s.r), qx = p[0] * s.sx, qy = p[1] * s.sy;
  return { ...s, x: s.x + p[0] - (qx * cos(a) - qy * sin(a)), y: s.y + p[1] - (qx * sin(a) + qy * cos(a)) };
}
// Bildschirmlage eines Punktes q (px relativ zum Mittelpunkt c) eines Objekts im Zustand s
function ptOf(c, s0, q) { const s = st(s0), a = rad(s.r), qx = q[0] * s.sx, qy = q[1] * s.sy; return [c[0] + s.x + qx * cos(a) - qy * sin(a), c[1] + s.y + qx * sin(a) + qy * cos(a)]; }
// Geometrie der Szenen-Icons
function G(key) {
  const s = SPEC[key], cx = s.cx || 1180, cy = s.cy || 455, size = s.size || 440, k = size / 512, flip = s.rot === 180 ? -1 : 1;
  const U = (u, v) => [flip * (u - 256) * k, flip * (v - 256) * k];
  const P = (u, v) => { const d = U(u, v); return [cx + d[0], cy + d[1]]; };
  return { spec: s, cx, cy, c: [cx, cy], size, k, U, P };
}
const noise = (t, f, ph = 0) => 0.6 * sin(2 * PI * t / f + ph) + 0.4 * sin(2 * PI * t / (f * 1.71) + 1.3 + ph);

// ---------- Folien-Bauer ----------
class Slide {
  constructor(key, dur, opt = {}) { this.key = key; this.D = dur; this.A = []; this.fx = []; this.carry = []; this.ref = opt.ref || 'start'; this.morph = !!opt.morph; this.iconVisible = opt.iconVisible ?? false; this.noIcon = !!opt.noIcon; this.static = !!opt.static; this.subStatic = !!opt.subStatic; }
  // Bahn abtasten: f(t) liefert Zustand zur lokalen Zeit t
  track(id, f, t0 = 0, t1 = this.D, step = STEP) {
    t1 = Math.min(t1, this.D); if (this.ref === 'end') t0 = 0;
    const keys = []; for (let t = t0; ; t += step) { if (t > t1) t = t1; keys.push({ t: Math.round(t), ...st(f(t)) }); if (t >= t1) break; }
    // mehrere Abschnitte derselben Ebene zu einer Spur zusammenführen (eine Spur pro Ebene)
    const old = this.A.find(a => a.t === 'kf' && a.id === id);
    if (old) { const m = new Map(old.keys.map(k => [k.t, k])); keys.forEach(k => m.set(k.t, k)); old.keys = [...m.values()].sort((a, b) => a.t - b.t); return this; }
    this.A.push({ t: 'kf', id, ref: this.ref, keys }); return this;
  }
  fadeIn(id, delay, d) { this.A.push({ t: 'fadeIn', id, delay: Math.round(delay), d: Math.round(d) }); return this; }
  fadeOut(id, delay, d) { this.A.push({ t: 'fadeOut', id, delay: Math.round(delay), d: Math.round(d) }); return this; }
  show(id, at) { this.A.push({ t: 'show', id, delay: Math.round(at) }); return this; }
  hide(id, at) { this.A.push({ t: 'hide', id, delay: Math.round(at) }); return this; }
  blink(id, pairs) { for (const [a, b] of pairs) this.show(id, a).hide(id, b); return this; }
  orbit(id, o) { this.A.push({ t: 'orbit', id, ...o }); return this; }
  addFx(f) { this.fx.push(f); return f; }
  // Icon der Vorfolie als 'carry' übernehmen (Startlage = Endzustand dort)
  carryFrom(layer, as, z = 'front') { this.carry.push({ layer, as, z }); return this; }
}

// Zyklen (Rauch, Funken, Lettern): Einblenden, Bahn u∈[0,1], Ausblenden; nur Zyklen, die vor dem Folienende enden
function cycles(sl, id, starts, len, path, o = {}) {
  const ok = starts.filter(s0 => s0 + len <= sl.D - 20);
  if (!ok.length) return;
  const f = t => { let cur = null; for (const s0 of ok) if (t >= s0 - 1) cur = s0; if (cur === null) return path(0, ok[0]); return path(clamp((t - cur) / len), cur); };
  sl.track(id, f, ok[0], ok[ok.length - 1] + len, o.step || STEP);
  for (const s0 of ok) { sl.fadeIn(id, s0, o.fin ?? 250); sl.fadeOut(id, s0 + len * (o.outAt ?? 0.55), len * (1 - (o.outAt ?? 0.55)) - 10); }
}
// Funke/Glanz einmalig: auftauchen, wachsen, verschwinden
function pop(sl, id, at, len, f) { sl.show(id, at); sl.track(id, t => f(clamp((t - at) / len)), at, at + len, 20); sl.hide(id, at + len + 10); }

// ---------- die 25 Paare ----------
// Jede Funktion bekommt (L, S, D, E) und füllt beide Folien. fx: Zusatzebenen mit Lage in Szenen-px.
const PAIRS = [];

// 1 Steinwerkzeug: Faustkeil holt aus, schlägt zu (Drehpunkt Griffende) → Schädel
PAIRS[0] = (L, S, D, E) => {
  const g = G('m01a'), p = g.U(50, 490);
  const R = [[0, 0], [1600, 0], [3600, -38, eio], [3780, 10, ei], [4050, 4, eo], [4600, 2, eio], [5200, 2], [7200, -38, eio], [7380, 10, ei], [7650, 4, eo], [8200, 6, eio],
    [D + 300, 6], [D + 1400, -30, eio], [D + 1560, 14, ei], [D + 1800, 8, eo]];
  const axe = T => piv(p, { r: pw(R, T) });
  L.fadeIn('icon', 300, 1300).track('icon', axe);
  const hit = r => ptOf(g.c, piv(p, { r }), g.U(250, 175)); // Schlagkante der Klinge bei Drehung r
  const h = hit(10); L.addFx({ name: 'chips1', kind: 'burst', x: h[0], y: h[1], r: 120, color: '#ffd9a0', n: 16, w: 3, dots: true, z: 'front', seed: 3 });
  L.addFx({ name: 'chips2', kind: 'burst', x: h[0], y: h[1], r: 120, color: '#ffd9a0', n: 16, w: 3, dots: true, z: 'front', seed: 8 });
  for (const [id, t0] of [['chips1', 3780], ['chips2', 7380]]) { L.fadeIn(id, t0, 60); L.track(id, t => ({ s: pw([[t0, 0.4], [t0 + 450, 1.3, eo]], t) }), t0, t0 + 450, 20); L.fadeOut(id, t0 + 160, 330); }
  // Schatten
  S.carryFrom('icon', 'carry', 'front');
  S.track('carry', t => axe(D + t), 0, 1900).fadeOut('carry', 1750, 700);
  const h2 = hit(14); S.addFx({ name: 'chips', kind: 'burst', x: h2[0], y: h2[1], r: 140, color: '#ff6a4a', n: 18, w: 3.5, dots: true, z: 'front', seed: 5 });
  S.fadeIn('chips', 1560, 60).track('chips', t => ({ s: pw([[1560, 0.4], [2050, 1.35, eo]], t) }), 1560, 2050, 20).fadeOut('chips', 1700, 350);
  S.fadeIn('icon', 1500, 400).track('icon', t => ({ s: pw([[0, 1.14], [1500, 1.14], [1700, 0.97, eo], [1900, 1.0], [E, 1.08]], t), x: pw([[1560, 0], [1620, 8], [1680, -6], [1740, 4], [1800, -2], [1860, 0]], t) }), 1500, E);
};

// 2 Feuer: Flammen flackern (Anker Glut), Funken steigen → Waldbrand
PAIRS[1] = (L, S, D, E) => {
  const g = G('m02a'), p = g.U(256, 470);
  const flick = T => ({ sy: 1 + 0.045 * noise(T, 310), sx: 1 - 0.018 * noise(T, 310) + 0.01 * sin(2 * PI * T / 410 + 0.4) });
  L.fadeIn('icon', 300, 1500).track('icon', T => piv(p, flick(T)), 0, D, 60);
  const fc = g.P(256, 230); L.addFx({ name: 'fglow', kind: 'glow', x: fc[0], y: fc[1], r: 300, color: '#ff8a2a', op: 0.55, z: 'back' });
  L.fadeIn('fglow', 300, 1500).track('fglow', T => ({ s: 1 + 0.07 * noise(T, 470, 2) }), 0, D, 80);
  const top = g.P(256, 80);
  [[900, 3300, 5700], [1700, 4100, 6500], [2500, 4900, 7300]].forEach((starts, j) => {
    const id = 'ember' + (j + 1); L.addFx({ name: id, kind: 'embers', x: top[0], y: top[1], r: 40, color: '#ffb35c', n: 7, seed: 31 + j, z: 'front' });
    cycles(L, id, starts, 2400, u => ({ x: 30 * sin(2 * PI * u * 1.5 + j * 2) + (j - 1) * 50 * u, y: -300 * u, s: 1 - 0.4 * u }), { outAt: 0.5 });
  });
  // Schatten: Lagerfeuer wächst und geht im Waldbrand auf
  S.carryFrom('icon', 'carry', 'front');
  S.track('carry', t => { const f = flick(D + t), gr = pw([[0, 1], [1600, 1.3, eio]], t); return piv(p, { sx: f.sx * gr, sy: f.sy * gr }); }, 0, 2000, 60).fadeOut('carry', 700, 1300);
  const gs = G('m02b'), ps = gs.U(256, 480);
  S.fadeIn('icon', 500, 1500).track('icon', t => { const f = flick(t + 777), w = pw([[500, 0.75], [2500, 1, eo]], t); return piv(ps, { sx: f.sx * w, sy: f.sy }); }, 0, E, 60);
  const ft = gs.P(256, 60);
  [[1200, 3600, 6000], [2000, 4400], [2800, 5200]].forEach((starts, j) => {
    const id = 'ember' + (j + 1); S.addFx({ name: id, kind: 'embers', x: ft[0], y: ft[1] + 30, r: 80, color: '#ff7a2a', n: 9, seed: 41 + j, z: 'front' });
    cycles(S, id, starts, 2400, u => ({ x: 40 * sin(2 * PI * u + j) + (j - 1) * 70 * u, y: -230 * u, s: 1 - 0.35 * u }), { outAt: 0.5 });
  });
};

// 3 Speer: Jäger holt aus und wirft; Speer fliegt Bogenbahn → (Morph) trifft das Mammut
PAIRS[2] = (L, S, D, E) => {
  const g = G('m03a'), pf = g.U(150, 480);
  const RC = [[0, 0], [5800, 0], [8000, -7, eio], [8250, 5, ei], [8700, 2, eo]];
  const cave = T => piv(pf, { r: pw(RC, T) });
  L.fadeIn('icon', 350, 1600).track('icon', cave);
  // Speer in der Hand: Mittelpunkt (321,77), Winkel 15,2°
  const k = g.k, sc = [g.cx + (321 - 256) * k, g.cy + (77 - 256) * k], len = 344 * k, a0 = 15.17;
  L.addFx({ name: '!!spear', kind: 'spear', x: sc[0], y: sc[1], len, z: 'back' });
  const held = T => { const c = cave(T), pnt = ptOf(g.c, c, [sc[0] - g.cx, sc[1] - g.cy]); return { x: pnt[0] - sc[0], y: pnt[1] - sc[1], r: a0 + c.r }; };
  const T0 = 8250, s0 = held(T0), P0 = [sc[0] + s0.x, sc[1] + s0.y];
  // Ziel: Rücken des Mammuts (Szene m03b)
  const gm = G('m03b'), tip = gm.P(200, 205), Thit = D + TM + 500, Tf = (Thit - T0) / 1000, yApex = 120;
  let th = 55, vx, vy, gg; // Iteration: Speermitte so, dass die Spitze das Ziel trifft
  for (let i = 0; i < 30; i++) {
    const xe = tip[0] - len / 2 * cos(rad(th)), ye = tip[1] - len / 2 * sin(rad(th));
    vx = (xe - P0[0]) / Tf; // y: ye = y0 + vy*Tf + g/2*Tf^2 und y0 - vy^2/(2g) = yApex
    const h = P0[1] - yApex, dy = ye - P0[1];
    let lo = 1, hi = 5000; for (let j = 0; j < 60; j++) { const m = (lo + hi) / 2, v = -Math.sqrt(2 * m * h); (P0[1] + v * Tf + m / 2 * Tf * Tf - P0[1] > dy) ? (hi = m) : (lo = m); }
    gg = (lo + hi) / 2; vy = -Math.sqrt(2 * gg * h); th = Math.atan2(vy + gg * Tf, vx) * 180 / PI;
  }
  const fly = T => { if (T <= T0) return held(T); const tau = Math.min(T, Thit) - T0, s = tau / 1000; const ang = Math.atan2(vy + gg * s, vx) * 180 / PI, bl = clamp(tau / 220);
    return { x: P0[0] + vx * s - sc[0], y: P0[1] + vy * s + gg / 2 * s * s - sc[1], r: s0.r + (ang - s0.r) * eo(bl) }; };
  L.fadeIn('!!spear', 350, 1600).track('!!spear', fly);
  // Schatten (Morph): Speer setzt fort, trifft; Mammut zuckt, sinkt und verblasst
  const pm = gm.U(256, 480);
  const mam = t => piv(pm, { x: pw([[500, 0], [580, 14], [700, -4], [820, 0]], t), y: pw([[3500, 0], [E - 400, 45, eio]], t), r: pw([[500, 0], [580, 1.5], [800, 0]], t) });
  S.iconVisible = true; S.track('icon', mam, 0, E - 400).fadeOut('icon', 4300, E - 4300 - 400);
  const hitS = fly(Thit), hitC = [sc[0] + hitS.x, sc[1] + hitS.y], rel = [hitC[0] - gm.cx, hitC[1] - gm.cy];
  S.addFx({ name: '!!spear', kind: 'spear', x: sc[0], y: sc[1], len, z: 'front' });
  S.track('!!spear', t => { if (t <= 500) return fly(D + TM + t); const m = mam(t), q = ptOf(gm.c, m, rel); return { x: q[0] - sc[0], y: q[1] - sc[1], r: hitS.r + m.r }; }, 0, E - 400).fadeOut('!!spear', 4300, E - 4300 - 400);
  S.addFx({ name: 'dust', kind: 'puff', x: tip[0], y: tip[1], r: 70, color: '#c9b8a0', op: 0.55, z: 'front', seed: 7 });
  S.fadeIn('dust', 500, 150).track('dust', t => ({ s: pw([[500, 0.4], [1500, 1.4, eo]], t), y: pw([[500, 0], [1500, -25]], t) }), 500, 1500).fadeOut('dust', 700, 800);
  S.subStatic = true;
};

// 4 Bild & Symbol: Handabdruck wird aufgestempelt → Maske pulsiert im Trommeltakt
PAIRS[3] = (L, S, D, E) => {
  const hand = T => ({ s: pw([[0, 1.12], [600, 1.12], [1300, 1.0, eo], [D, 1.04], [D + 1500, 1.07]], T) });
  L.fadeIn('icon', 600, 700).track('icon', hand);
  S.carryFrom('icon', 'carry', 'back').track('carry', t => hand(D + t), 0, 1500).fadeOut('carry', 200, 1300);
  const g = G('m04b'), p = g.U(256, 30), beats = []; for (let b = 1500; b < E - 300; b += 830) beats.push(b);
  const pulse = t => beats.reduce((m, b) => (t >= b ? Math.max(m, Math.exp(-(t - b) / 180)) : m), 0);
  S.fadeIn('icon', 500, 1400).track('icon', t => piv(p, { s: (1 + 0.035 * pulse(t)) * pw([[0, 1], [E, 1.04]], t), r: 2.5 * sin(2 * PI * t / 3300) }), 0, E, 30);
};

// 5 Ackerbau: Weizen wiegt sich (Drehpunkt Halmfuß) → Weizen sinkt, Krone steigt auf
PAIRS[4] = (L, S, D, E) => {
  const g = G('m05a'), p = g.U(256, 505);
  const sway = T => clamp((T - 500) / 1500) * (4 * sin(2 * PI * T / 3000) + 1.5 * sin(2 * PI * T / 1300 + 1));
  const wheat = T => piv(p, { r: sway(T), s: T <= D ? pw([[0, 1], [D, 1.04]], T) : pw([[D, 1.04], [D + 2200, 0.95]], T), y: pw([[D, 0], [D + 2200, 22, eio]], T) });
  L.fadeIn('icon', 350, 1800).track('icon', wheat);
  S.carryFrom('icon', 'carry', 'back').track('carry', t => wheat(D + t), 0, 2200).fadeOut('carry', 300, 1700);
  const gs = G('m05b'), crown = t => ({ y: pw([[500, 70], [3000, 0, eo]], t), s: pw([[500, 0.92], [3000, 1.0, eo], [E, 1.06]], t) });
  S.fadeIn('icon', 500, 1400).track('icon', crown);
  const q = gs.U(256, 50); S.addFx({ name: 'glint', kind: 'star', x: gs.cx + q[0], y: gs.cy + q[1], r: 46, color: '#ffe7b8', z: 'front' });
  for (const t0 of [3100, 6000]) pop(S, 'glint', t0, 700, u => { const c = crown(t0 + 700 * u), pnt = ptOf(gs.c, c, q); return { x: pnt[0] - gs.cx - q[0], y: pnt[1] - gs.cy - q[1], s: 0.2 + sin(PI * u) * 0.95, r: 90 * u }; });
};

// 6 Rad: rollt ins Bild und bleibt stehen → Streitwagen prescht heran
PAIRS[5] = (L, S, D, E) => {
  const R0 = 203, X = [[0, 420], [600, 420], [5200, 0, eo]];
  const wheel = T => { const x = pw(X, T); return { x, y: -3 * Math.abs(sin(PI * (420 - x) / 70)), r: -(420 - x) / R0 * 180 / PI + pw([[5200, 0], [5500, 3, eo], [5900, -1, eio], [6200, 0]], T) }; };
  L.fadeIn('icon', 300, 900).track('icon', wheel);
  S.carryFrom('icon', 'carry', 'back').fadeOut('carry', 300, 1300);
  const g = G('m06b'), cx = t => pw([[0, -350], [300, -350], [3000, 0, eo], [E, 30]], t), prog = t => clamp((t - 300) / 2700);
  const char = t => ({ x: cx(t), y: 4 * sin(2 * PI * t / 170) * (1 - prog(t)), r: 1.5 * sin(2 * PI * t / 230) * (1 - prog(t)) + 0, s: pw([[3000, 1], [E, 1.07]], t) });
  S.fadeIn('icon', 300, 900).track('icon', char, 0, E, 30);
  const w = g.U(95, 430);
  ['dust1', 'dust2'].forEach((id, j) => {
    const t0 = 500 + j * 800, c0 = ptOf(g.c, char(t0), w);
    S.addFx({ name: id, kind: 'puff', x: c0[0], y: c0[1], r: 45, color: '#8a7a68', op: 0.5, z: 'back', seed: 11 + j });
    S.fadeIn(id, t0, 200).track(id, t => { const u = clamp((t - t0) / 1600); return { x: -60 * u, y: -40 * u, s: 0.6 + 0.9 * eo(u) }; }, t0, t0 + 1600).fadeOut(id, t0 + 500, 1000);
  });
};

// 7 Schrift: Schriftrolle entrollt sich (x-Skalierung, Anker links) → Auge öffnet sich
PAIRS[6] = (L, S, D, E) => {
  const g = G('m07a'), p = g.U(30, 256);
  const scroll = T => piv(p, { sx: T <= D ? pw([[0, 0.08], [500, 0.08], [3200, 1, eio]], T) * pw([[3200, 1], [D, 1.04]], T) : pw([[D, 1.04], [D + 1200, 0.1, eio]], T), sy: pw([[3200, 1], [D, 1.04]], T), y: pw([[3200, 0], [D, -14]], T) });
  L.fadeIn('icon', 300, 700).track('icon', scroll);
  S.carryFrom('icon', 'carry', 'front').track('carry', t => scroll(D + t), 0, 1200).fadeOut('carry', 500, 700);
  const beat = t => [3000, 5000].reduce((m, b) => (t >= b ? Math.max(m, Math.exp(-(t - b) / 300)) : m), 0);
  S.fadeIn('icon', 900, 300).track('icon', t => ({ sy: pw([[0, 0.04], [900, 0.04], [1500, 1, eo]], t) * (1 + 0.04 * beat(t)) * pw([[1500, 1], [E, 1.08]], t), sx: (1 + 0.04 * beat(t)) * pw([[1500, 1], [E, 1.08]], t) }), 0, E, 30);
};

// 8 Eisen: Sichel schwingt dreimal (Drehpunkt Griff) → Schwerter prallen aufeinander
PAIRS[7] = (L, S, D, E) => {
  const g = G('m08a'), p = g.U(38, 484);
  const R = [[0, 0], [1500, 0]]; for (const b of [1500, 3500, 5500]) R.push([b + 1200, -24, eio], [b + 1600, 14, ei], [b + 2000, 12]);
  R.push([8200, 6, eio], [D + 1000, -10, eio]);
  const sick = T => piv(p, { r: pw(R, T) });
  L.fadeIn('icon', 350, 1500).track('icon', sick);
  const q = g.U(445, 25); L.addFx({ name: 'glint', kind: 'star', x: g.cx + q[0], y: g.cy + q[1], r: 44, color: '#ffe0b0', z: 'front' });
  pop(L, 'glint', 7150, 650, u => { const pnt = ptOf(g.c, sick(7150 + 650 * u), q); return { x: pnt[0] - g.cx - q[0], y: pnt[1] - g.cy - q[1], s: 0.2 + sin(PI * u), r: 80 * u }; });
  S.carryFrom('icon', 'carry', 'front').track('carry', t => sick(D + t), 0, 1200).fadeOut('carry', 200, 1000);
  const gs = G('m08b'), c = gs.P(256, 250);
  S.fadeIn('icon', 650, 250).track('icon', t => ({ s: pw([[0, 1.3], [650, 1.3], [900, 0.96, ei], [1100, 1.0], [4200, 1.0], [4300, 1.07], [4450, 0.98], [4600, 1.0], [E, 1.06]], t), x: pw([[4200, 0], [4260, -9], [4320, 7], [4380, -4], [4440, 2], [4500, 0]], t) }), 0, E, 20);
  ['spark1', 'spark2'].forEach((id, j) => { S.addFx({ name: id, kind: 'burst', x: c[0], y: c[1], r: 150, color: '#ffd36b', core: '#fff1c0', n: 20, w: 3, dots: true, z: 'front', seed: 13 + j }); });
  for (const [id, t0] of [['spark1', 880], ['spark2', 4250]]) { S.fadeIn(id, t0, 60); S.track(id, t => ({ s: pw([[t0, 0.3], [t0 + 420, 1.4, eo]], t) }), t0, t0 + 420, 20); S.fadeOut(id, t0 + 120, 450); }
};

// 9 Schießpulver: Feuerwerksrakete steigt zweimal auf und zerplatzt → Kanone feuert mit Rückstoß und Rauch
PAIRS[8] = (L, S, D, E) => {
  const g = G('m09a'), sc = 0.65, dir = [cos(rad(-52.7)), sin(rad(-52.7))], nose = g.U(470, 30);
  const shots = [{ st: [1250, 565], len: 280, a: 700, b: 900, c: 2900 }, { st: [1300, 545], len: 250, a: 4500, b: 4700, c: 6700 }];
  const rocket = T => { const sh = T < 3600 ? shots[0] : shots[1], u = clamp((T - sh.b) / (sh.c - sh.b)), d = sh.len * ei2(u);
    return { x: sh.st[0] + dir[0] * d - g.cx, y: sh.st[1] + dir[1] * d - g.cy, s: sc, r: (T > sh.b && T < sh.c) ? 2 * sin(2 * PI * T / 300) : 0 }; };
  L.track('icon', rocket);
  shots.forEach((sh, j) => {
    L.fadeIn('icon', sh.a, 300).hide('icon', sh.c);
    const e = [sh.st[0] + dir[0] * sh.len + nose[0] * sc, sh.st[1] + dir[1] * sh.len + nose[1] * sc], id = 'burst' + (j + 1);
    L.addFx({ name: id, kind: 'burst', x: e[0], y: e[1], r: 170, color: j ? '#ff8ad8' : '#ffd36b', core: j ? '#ffc8f0' : '#fff1c0', n: 28, w: 2.6, dots: true, z: 'front', seed: 17 + j });
    L.fadeIn(id, sh.c, 80).track(id, t => ({ s: pw([[sh.c, 0.15], [sh.c + 800, 1.2, eo]], t), y: pw([[sh.c, 0], [sh.c + 1400, 40]], t) }), sh.c, sh.c + 1400).fadeOut(id, sh.c + 400, 1000);
  });
  // Schatten: Kanone
  const gs = G('m09b'), pr = gs.U(280, 400), mz = gs.P(492, 218), F = [1800, 5600];
  const XK = [[0, 0]], RK = [[0, 0]]; for (const f of F) { XK.push([f, 0], [f + 80, -45, eo], [f + 1100, 0, eio]); RK.push([f, 0], [f + 80, -2.5], [f + 700, 0, eio]); }
  S.iconVisible = true; S.track('icon', t => piv(pr, { x: pw(XK, t), r: pw(RK, t), s: pw([[0, 1], [E, 1.05]], t) }), 0, E, 20);
  S.addFx({ name: 'muzzle', kind: 'burst', x: mz[0] + 60, y: mz[1], r: 110, color: '#ffcf6b', core: '#fff1c0', n: 14, w: 4, dir: 0, spread: 1.6, z: 'front', seed: 23 });
  for (const f of F) { S.show('muzzle', f); S.track('muzzle', t => ({ s: pw([[f, 0.5], [f + 180, 1.3, eo]], t) }), f, f + 300, 20); S.fadeOut('muzzle', f + 60, 230); }
  F.forEach((f, j) => [0, 1].forEach(m => {
    const id = 'smoke' + (2 * j + m + 1), t0 = f + 30 + m * 120;
    S.addFx({ name: id, kind: 'puff', x: mz[0] + 50, y: mz[1], r: 70, color: '#5a4a42', op: 0.75, rim: '#ff9a6a', z: 'front', seed: 50 + 2 * j + m });
    S.fadeIn(id, t0, 200).track(id, t => { const u = eo(clamp((t - t0) / 2600)); return { x: (m ? 160 : 200) * u, y: (m ? -60 : -110) * u, s: 0.4 + 1.3 * u }; }, t0, t0 + 2600).fadeOut(id, t0 + 1200, 1400);
  }));
};

// 10 Buchdruck: Buch öffnet sich, Lettern steigen auf → Megafon stößt Schallwellen aus
PAIRS[9] = (L, S, D, E) => {
  const g = G('m10a');
  const book = T => T <= D ? { sx: pw([[0, 0.12], [400, 0.12], [1800, 1, eo]], T) * pw([[1800, 1], [D, 1.05]], T), sy: pw([[1800, 1], [D, 1.05]], T) } : { sx: pw([[D, 1.05], [D + 1000, 0.15, eio]], T), sy: 1.05 };
  L.fadeIn('icon', 300, 800).track('icon', book);
  const o = g.P(256, 170), dirs = [-1, 0.5, 1, -0.4];
  ['A', 'g', 'R', 'e'].forEach((ch, j) => {
    const id = 'let' + (j + 1); L.addFx({ name: id, kind: 'glyph', text: ch, x: o[0], y: o[1], size: 64, z: 'front' });
    cycles(L, id, [2000 + 700 * j, 5600 + 700 * j], 2400, u => ({ x: dirs[j] * 130 * eo(u), y: -250 * eo(u), s: 0.5 + 0.6 * u, r: dirs[j] * 15 * u }), { outAt: 0.55 });
  });
  S.carryFrom('icon', 'carry', 'front').track('carry', t => book(D + t), 0, 1000).fadeOut('carry', 300, 800);
  const gs = G('m10b'), mo = gs.P(330, 240), waves = [1500, 2700, 3900, 5100, 6300, 7500];
  const shout = t => waves.reduce((m, b) => (t >= b ? Math.max(m, Math.exp(-(t - b) / 250)) : m), 0);
  S.fadeIn('icon', 400, 900).track('icon', t => ({ s: (1 + 0.035 * shout(t)) * pw([[0, 1], [E, 1.05]], t) }), 0, E, 30);
  ['wave1', 'wave2'].forEach((id, j) => {
    S.addFx({ name: id, kind: 'waves', x: mo[0], y: mo[1], r: 150, color: '#ff5a4e', z: 'front' });
    cycles(S, id, waves.filter((_, i) => i % 2 === j), 1500, u => ({ x: 120 * u, s: 0.5 + 1.0 * eo(u) }), { outAt: 0.45, fin: 200 });
  });
};

// 11 Seefahrt: Karavelle schaukelt auf den Wellen (Drehpunkt Kiel) → Fesseln pendeln
PAIRS[10] = (L, S, D, E) => {
  const g = G('m11a'), p = g.U(256, 470);
  const ship = T => piv(p, { r: 4.5 * sin(2 * PI * T / 3400) + 1.2 * sin(2 * PI * T / 1700 + 0.7), y: 8 * sin(2 * PI * T / 3400 + 1.2), x: T <= D ? 70 * T / D : 70 + pw([[D, 0], [D + 2400, 100]], T), s: pw([[D, 1], [D + 2400, 0.85, eio]], T) });
  L.fadeIn('icon', 300, 1600).track('icon', ship, 0, D, 60);
  S.carryFrom('icon', 'carry', 'back').track('carry', t => ship(D + t), 0, 2400, 60).fadeOut('carry', 400, 2000);
  const gs = G('m11b'), p2 = gs.U(150, 35);
  S.fadeIn('icon', 300, 1500).track('icon', t => piv(p2, { r: t > 300 ? 9 * Math.exp(-(t - 300) / 3500) * sin(2 * PI * (t - 300) / 2200) : 0, y: pw([[300, 0], [380, 6], [600, 0]], t), s: pw([[0, 1], [E, 1.05]], t) }), 0, E, 40);
};

// 12 Dampfkraft: Lok fährt ins Bild, stampft, Dampf pufft → Fabrikschlote qualmen
PAIRS[11] = (L, S, D, E) => {
  const g = G('m12a'), X = [[0, -380], [300, -380], [5500, 0, eo]];
  const loco = T => { const x = T <= D ? pw(X, T) : pw([[D, 0], [D + 1600, 60]], T), pr = clamp((T - 300) / 5200); return { x, y: -3 * Math.abs(sin(2 * PI * T / 760)) * (1 - pr) - (T > 5500 ? Math.abs(sin(2 * PI * T / 1000)) : 0) }; };
  L.fadeIn('icon', 200, 1200).track('icon', loco, 0, D, 40);
  const ch = g.U(437, 225), em = [[800, 4000, 7200], [1600, 4800], [2400, 5600], [3200, 6400]];
  em.forEach((starts, j) => {
    const id = 'steam' + (j + 1), c0 = [g.cx + ch[0], g.cy + ch[1]];
    L.addFx({ name: id, kind: 'puff', x: c0[0], y: c0[1], r: 50, color: '#e8ddd0', op: 0.55, z: 'back', seed: 60 + j });
    cycles(L, id, starts, 2400, (u, s0) => { const l = loco(s0); return { x: l.x - 110 * eo(u), y: l.y - 180 * eo(u), s: 0.4 + 1.3 * u }; }, { outAt: 0.42, fin: 200 });
  });
  S.carryFrom('icon', 'carry', 'front').track('carry', t => loco(D + t), 0, 1600).fadeOut('carry', 0, 1600);
  const gs = G('m12b'), stacks = [gs.P(404, 66), gs.P(476, 66)];
  S.fadeIn('icon', 300, 1500).track('icon', t => ({ s: pw([[0, 1], [E, 1.05]], t) }), 0, E);
  [[900, 3300, 5700], [1500, 3900, 6300], [2100, 4500], [2700, 5100]].forEach((starts, j) => {
    const id = 'smoke' + (j + 1), c0 = stacks[j % 2];
    S.addFx({ name: id, kind: 'puff', x: c0[0], y: c0[1], r: 45, color: '#2b2522', op: 0.8, rim: '#ff6a3a', z: 'back', seed: 70 + j });
    cycles(S, id, starts, 2400, u => ({ x: 70 * eo(u), y: -150 * eo(u), s: 0.45 + 1.15 * u }), { outAt: 0.45, fin: 300 });
  });
};

// 13 Medizin: Spritze sticht, Tropfen fällt → Virus dreht sich und vermehrt sich
PAIRS[12] = (L, S, D, E) => {
  const g = G('m13a'), J = [2800, 6000], d = T => J.reduce((m, j) => m + pw([[j, 0], [j + 140, 28, ei], [j + 900, 0, eio]], T), 0);
  const syr = T => ({ x: d(T) * 0.707 + (T > D ? pw([[D, 0], [D + 1400, -40]], T) : 0), y: d(T) * 0.707 + pw([[0, 0], [D, -10]], T) + (T > D ? pw([[D, 0], [D + 1400, -40]], T) : 0) });
  L.fadeIn('icon', 350, 1500).track('icon', syr);
  const tip = g.P(486, 486); L.addFx({ name: 'drop', kind: 'dot', x: tip[0], y: tip[1], r: 6, color: '#9fe8ff', z: 'front' });
  const dropF = t => { const j = t < 5000 ? J[0] : J[1], s = syr(j + 140), u = clamp((t - j - 140) / 700); return { x: s.x, y: s.y + 45 * eo(u), s: 0.6 + 0.4 * u }; };
  L.track('drop', dropF, J[0] + 140, J[1] + 840);
  for (const j of J) L.fadeIn('drop', j + 140, 100).fadeOut('drop', j + 500, 330);
  S.carryFrom('icon', 'carry', 'front').track('carry', t => syr(D + t), 0, 1400).fadeOut('carry', 0, 1400);
  S.fadeIn('icon', 300, 1200).track('icon', t => ({ r: 25 * t / E, s: 1 + 0.03 * sin(2 * PI * t / 1800) }), 0, E, 60);
  const gs = G('m13b'); [[2200, 330, -210, 40], [3200, 370, 170, -35], [4200, -320, -190, 45]].forEach(([t0, dx, dy, rr], j) => {
    const id = 'vir' + (j + 1); S.addFx({ name: id, kind: 'mini', icon: 'GiVirus', x: gs.cx, y: gs.cy, size: 150, glow: '#d8ff3a', z: 'back' });
    S.fadeIn(id, t0, 500).track(id, t => { const u = eo(clamp((t - t0) / 2600)); return { x: dx * u, y: dy * u, s: 0.3 + 0.7 * u, r: rr * u + (t - t0) / 200 }; }, t0, E, 60);
  });
};

// 14 Elektrizität: Glühbirne flackert an → flackert aus, Funken an den Mastarmen
PAIRS[13] = (L, S, D, E) => {
  const g = G('m14a'), sc = T => ({ s: pw([[2450, 1], [D, 1.06]], T) });
  L.addFx({ name: 'iconOff', kind: 'iconVar', icon: 'GiLightBulb', x: g.cx, y: g.cy, size: g.size, noGlow: true, fill: '#15151c', z: 'back' });
  L.addFx({ name: 'bglow', kind: 'glow', x: g.cx, y: g.cy - 40, r: 380, color: '#ffe9a8', op: 0.55, z: 'back' });
  L.fadeIn('iconOff', 200, 1000).track('iconOff', sc);
  const on = [[1600, 1680], [1800, 1850], [2100, 2300]];
  for (const id of ['icon', 'bglow']) { L.blink(id, on); L.show(id, 2450); }
  L.track('icon', sc); L.track('bglow', T => ({ s: sc(T).s * (1 + 0.05 * sin(2 * PI * Math.max(0, T - 2450) / 1700)) }), 0, D, 60);
  S.carryFrom('iconOff', 'carryOff', 'back').carryFrom('bglow', 'carryGlow', 'back').carryFrom('icon', 'carry', 'front');
  // Ausflackern: sichtbar ab Start, aus bei 400, an bei 480 …, endgültig aus bei 1000
  for (const id of ['carry', 'carryGlow']) { S.hide(id, 400).show(id, 480).hide(id, 700).show(id, 760).hide(id, 1000); }
  S.fadeOut('carryOff', 1600, 1000);
  const gs = G('m14b'), push = t => ({ s: pw([[0, 1], [E, 1.07]], t) });
  S.fadeIn('icon', 900, 1500).track('icon', push);
  [[gs.U(40, 75), [[2600, 2700], [2800, 2860], [5200, 5320]]], [gs.U(472, 75), [[3700, 3800], [3900, 3950], [6400, 6520]]]].forEach(([q, bl], j) => {
    const id = 'arc' + (j + 1); S.addFx({ name: id, kind: 'burst', x: gs.cx + q[0], y: gs.cy + q[1], r: 55, color: '#cfe8ff', core: '#eaf6ff', n: 10, w: 2.4, z: 'front', seed: 80 + j });
    S.blink(id, bl); S.track(id, t => { const s = push(t).s; return { x: q[0] * (s - 1), y: q[1] * (s - 1) }; }, bl[0][0], bl[bl.length - 1][1], 200);
  });
};

// 15 Automobil: Auto fährt herein und federt → fährt weiter, Aufprall, Totenkopf
PAIRS[14] = (L, S, D, E) => {
  const g = G('m15a'), X = [[0, -420], [300, -420], [6000, 40, eo], [D, 60], [D + 800, 340, ei2]];
  const car = T => ({ x: pw(X, T), y: 2.5 * sin(2 * PI * T / 430) * (1 - clamp((T - 300) / 5700)) });
  L.fadeIn('icon', 300, 1000).track('icon', car);
  const rear = g.P(30, 290); L.addFx({ name: 'speed', kind: 'speed', x: rear[0] - 190, y: rear[1] - 30, w: 360, h: 110, color: '#ffb070', z: 'back' });
  L.fadeIn('speed', 300, 600).track('speed', T => ({ x: car(T).x }), 0, 5000).fadeOut('speed', 3500, 1500);
  S.carryFrom('icon', 'carry', 'front').track('carry', t => car(D + t), 0, 800).fadeOut('carry', 650, 250);
  const fr = ptOf(g.c, car(D + 800), g.U(480, 300));
  S.addFx({ name: 'flash', kind: 'glow', x: Math.min(fr[0], 1700), y: fr[1], r: 300, color: '#fff3d6', core: '#ffffff', op: 0.95, z: 'front' });
  S.show('flash', 750).track('flash', t => ({ s: pw([[750, 0.3], [1050, 1.5, eo]], t) }), 750, 1050, 20).fadeOut('flash', 950, 600);
  S.fadeIn('icon', 850, 600).track('icon', t => ({ s: pw([[0, 1.15], [850, 1.15], [1400, 1.0, eo], [E, 1.07]], t), x: pw([[850, 0], [910, 9], [970, -7], [1030, 5], [1090, -2], [1150, 0]], t) }), 0, E, 20);
};

// 16 Kohle & Öl: Ölfass fällt, prallt auf, staucht → Fass versinkt, Quecksilber steigt
PAIRS[15] = (L, S, D, E) => {
  const g = G('m16a'), p = g.U(256, 486), hits = [[1250, 0.14], [1950, 0.06], [2350, 0.02]];
  const sq = T => hits.reduce((m, [ti, a]) => (T >= ti && T <= ti + 220 ? m + a * sin(PI * (T - ti) / 220) : m), 0);
  const drum = T => piv(p, { y: pw([[0, -170], [450, -170], [1250, 0, ei2], [1600, -55, eo], [1950, 0, ei2], [2150, -12, eo], [2350, 0, ei2], [D, 0], [D + 1800, 70, eio]], T), sy: (1 - sq(T)) * pw([[2600, 1], [D, 1.08], [D + 1800, 1.0]], T), sx: (1 + 0.6 * sq(T)) * pw([[2600, 1], [D, 1.08], [D + 1800, 1.0]], T) });
  L.fadeIn('icon', 300, 400).track('icon', drum, 0, D, 20);
  S.carryFrom('icon', 'carry', 'front').track('carry', t => drum(D + t), 0, 1800).fadeOut('carry', 0, 1600);
  const gs = G('m16b'), x = gs.P(205, 0)[0], y0 = gs.P(0, 70)[1], y1 = gs.P(0, 430)[1], bulb = gs.P(205, 437), sun = gs.P(330, 256);
  S.addFx({ name: 'hglow', kind: 'glow', x: sun[0], y: sun[1], r: 330, color: '#ff5a1a', op: 0.6, z: 'back' });
  S.fadeIn('hglow', 800, 1500).track('hglow', t => ({ s: 0.9 + 0.14 * Math.pow(sin(PI * t / 1500), 2) }), 0, E, 60);
  S.fadeIn('icon', 300, 1200);
  S.addFx({ name: 'merc', kind: 'bar', x, y: (y0 + y1) / 2, w: 10, h: y1 - y0, color: '#ff3d26', z: 'front' });
  S.addFx({ name: 'mercB', kind: 'dot', x: bulb[0], y: bulb[1], r: 16, color: '#ff3d26', core: '#ff8a6a', z: 'front' });
  S.fadeIn('mercB', 1000, 500).fadeIn('merc', 1000, 500).track('merc', t => piv([0, (y1 - y0) / 2], { sy: pw([[0, 0.1], [1200, 0.1], [E - 800, 1, eio]], t) }), 0, E - 800);
};

// 17 Flugzeug: Doppeldecker nähert sich und rollt → (Morph) zieht über die Szene, Bomben fallen, Einschläge
PAIRS[16] = (L, S, D, E) => {
  const s0 = 0.30, s1 = 0.84, inv = u => 1 / (1 / s0 - (1 / s0 - 1 / s1) * u);
  const plane = T => {
    const roll = 7 * sin(2 * PI * T / 3800);
    if (T <= D) { const s = inv(clamp(T / D)), w = (s - s0) / (s1 - s0); return { s, x: 360 + (40 - 360) * w, y: -210 + (-110 + 210) * w + 10 * sin(2 * PI * T / 2500), r: roll }; }
    const u = clamp((T - D) / (TM + 2600)); return { s: s1 + (1.2 - s1) * eio(u), x: 40 - 60 * u, y: -110 + 10 * sin(2 * PI * T / 2500) - 160 * eio(u), r: roll };
  };
  L.addFx({ name: '!!plane', kind: 'iconVar', icon: 'GiBiplane', x: 1180, y: 455, size: 440, z: 'front' });
  L.noIcon = true; L.fadeIn('!!plane', 300, 1400).track('!!plane', plane);
  S.addFx({ name: '!!plane', kind: 'iconVar', icon: 'GiBiplane', x: 1180, y: 455, size: 440, z: 'front' });
  S.track('!!plane', t => plane(D + TM + t), 0, 2600).fadeOut('!!plane', 1800, 800);
  // Bomben (Szenen-Icon GiBombingRun): zwei Abwürfe
  const bomb = t => {
    if (t < 4000) { const u = clamp((t - 900) / 2100), pl = plane(D + TM + 900); return { x: pl.x + (200 - pl.x) * ei2(u), y: pl.y + 60 + (135 - pl.y - 60) * ei2(u), s: 0.3 + 0.42 * ei2(u), r: 6 * u }; }
    const u = clamp((t - 4300) / 1800); return { x: 70 + 250 * ei2(u), y: -285 + 395 * ei2(u), s: 0.4 + 0.3 * ei2(u), r: 8 * u };
  };
  S.track('icon', bomb, 900, 6100).fadeIn('icon', 900, 200).fadeOut('icon', 2880, 120).fadeIn('icon', 4300, 300).fadeOut('icon', 5980, 120);
  const spots = [[[1350, 700], [1480, 720], [1620, 695]], [[1500, 712], [1640, 700], [1760, 716]]], T0 = [[3000, 3150, 3350], [6100, 6250, 6450]];
  [0, 1, 2].forEach(j => {
    const id = 'blast' + (j + 1), b0 = spots[0][j]; S.addFx({ name: id, kind: 'glow', x: b0[0], y: b0[1], r: 120, color: '#ffb070', core: '#fff1d0', op: 0.95, z: 'front' });
    [0, 1].forEach(w => { const t0 = T0[w][j], dx = spots[w][j][0] - b0[0], dy = spots[w][j][1] - b0[1]; S.show(id, t0).fadeOut(id, t0 + 300, 800); });
    S.track(id, t => { const w = t < 5000 ? 0 : 1, t0 = T0[w][j], u = clamp((t - t0) / 500); return { x: spots[w][j][0] - b0[0], y: spots[w][j][1] - b0[1], s: 0.3 + eo(u) }; }, T0[0][j], T0[1][j] + 500, 20);
  });
  S.subStatic = true;
};

// 18 Chemie: Kolben schwenkt, Blasen steigen → Kolben kippt weg, Gaswolken ziehen herein
PAIRS[17] = (L, S, D, E) => {
  const g = G('m18a'), p = g.U(256, 500), amp = T => pw([[1000, 0], [2500, 1, eio], [6000, 1], [D, 0.25, eio]], T);
  const flask = T => piv(p, { r: T <= D ? amp(T) * 7 * sin(2 * PI * (T - 1000) / 1500) : pw([[D, amp(D) * 7 * sin(2 * PI * (D - 1000) / 1500)], [D + 1400, 28, eio]], T) });
  L.fadeIn('icon', 350, 1500).track('icon', flask);
  const liq = g.U(256, 400);
  for (let j = 0; j < 4; j++) {
    const id = 'bub' + (j + 1); L.addFx({ name: id, kind: 'ring', x: g.cx + liq[0], y: g.cy + liq[1], r: 9, color: '#f3ffb0', z: 'front' });
    const st0 = []; for (let s0 = 1200 + 500 * j; s0 <= D - 1900; s0 += 1900 + 300 * (j % 2)) st0.push(s0);
    cycles(L, id, st0, 1900, (u, s0) => { const T = s0 + 1900 * u, loc = [liq[0] + 8 * sin(2 * PI * u * 2 + j), liq[1] - 380 * u], pnt = ptOf(g.c, flask(T), loc); return { x: pnt[0] - g.cx - liq[0], y: pnt[1] - g.cy - liq[1], s: 0.6 + 0.5 * u }; }, { outAt: 0.7, fin: 150 });
  }
  S.carryFrom('icon', 'carry', 'front').track('carry', t => flask(D + t), 0, 1400).fadeOut('carry', 200, 1200);
  S.fadeIn('icon', 500, 1500).track('icon', t => ({ s: (1 + 0.025 * Math.pow(sin(PI * t / 2400), 2)) * pw([[0, 1], [E, 1.04]], t) }), 0, E, 60);
  [[500, 1640, 600], [1500, 1620, 470], [2500, 1660, 680]].forEach(([t0, x, y], j) => {
    const id = 'gas' + (j + 1); S.addFx({ name: id, kind: 'puff', x, y, r: 120, color: '#b8d43a', op: 0.45, z: 'front', seed: 90 + j });
    S.fadeIn(id, t0, 1200).track(id, t => { const u = clamp((t - t0) / (E - t0)); return { x: 280 - 430 * eo(u), y: 10 * sin(2 * PI * t / 3000 + j), s: 0.8 + 0.7 * u }; }, t0, E, 80);
  });
};

// 19 Kernspaltung: Elektronen kreisen, Kern glüht auf → Pilzwolke steigt und wächst
PAIRS[18] = (L, S, D, E) => {
  const g = G('m19a'), a = 222 * g.k, b = 63 * g.k;
  L.fadeIn('icon', 350, 1800);
  [[90, 1600, 1300, 0], [30, 1900, 1500, 2], [150, 1750, 1700, 4]].forEach(([th, per, t0, ph], j) => {
    const id = 'el' + (j + 1), P = phi => { const u = a * cos(phi), v = b * sin(phi), A = rad(th); return [g.cx + u * cos(A) - v * sin(A), g.cy + u * sin(A) + v * cos(A)]; }, c0 = P(ph);
    L.addFx({ name: id, kind: 'dot', x: c0[0], y: c0[1], r: 7, color: '#b8f2ff', z: 'front' });
    L.fadeIn(id, t0, 400).orbit(id, { cx: g.cx, cy: g.cy, a, b, th, phi0: ph, per, t0, t1: D });
  });
  L.addFx({ name: 'core', kind: 'glow', x: g.cx, y: g.cy, r: 140, color: '#d8fbff', core: '#ffffff', op: 0.9, z: 'front' });
  L.fadeIn('core', 2000, 800).track('core', T => ({ s: T < D - 1800 ? 0.85 + 0.1 * sin(2 * PI * T / 900) : pw([[D - 1800, 0.85 + 0.1 * sin(2 * PI * (D - 1800) / 900)], [D, 1.9, ei]], T) }), 2000, D, 60);
  const gs = G('m19b'), p = gs.U(256, 500);
  S.iconVisible = true; S.track('icon', t => piv(p, { s: pw([[0, 0.35], [300, 0.35], [7000, 1.0, eo], [E, 1.05]], t) }), 0, E, 60);
};

// 20 Computer: Monitor bootet, Bits steigen → Roboterarm schwenkt über dem Band (Drehpunkt Schulter)
PAIRS[19] = (L, S, D, E) => {
  const g = G('m20a'), pc = T => ({ s: pw([[0, 1], [D, 1.04]], T) });
  L.fadeIn('icon', 350, 1500).track('icon', pc);
  const scr = g.P(328, 219); L.addFx({ name: 'screen', kind: 'screen', x: scr[0], y: scr[1], w: 276 * g.k, h: 162 * g.k, color: '#7dffcf', z: 'front' });
  L.blink('screen', [[1900, 1960], [2100, 2140]]).show('screen', 2400);
  L.track('screen', T => { const s = pc(T).s; return { s, x: (scr[0] - g.cx) * (s - 1), y: (scr[1] - g.cy) * (s - 1) }; });
  ['1', '0', '1'].forEach((ch, j) => {
    const id = 'bit' + (j + 1); L.addFx({ name: id, kind: 'glyph', text: ch, x: scr[0] - 60 + 60 * j, y: scr[1] - 90, size: 44, glow: '#7dffcf', z: 'front' });
    const st0 = []; for (let s0 = 2800 + 600 * j; s0 <= D - 1900; s0 += 2100) st0.push(s0);
    cycles(L, id, st0, 1900, u => ({ y: -200 * u, x: (j - 1) * 50 * u, s: 0.7 + 0.4 * u }), { outAt: 0.55, fin: 200 });
  });
  S.carryFrom('screen', 'carryScreen', 'front').carryFrom('icon', 'carry', 'back');
  S.fadeOut('carry', 0, 1400).fadeOut('carryScreen', 0, 900);
  const gs = G('m20b'), p = gs.U(195, 98); // Szenen-Icon ist nur der Arm (iconKeep), Band und Kisten als 'iconBase'
  S.addFx({ name: 'iconBase', kind: 'iconVar', icon: 'GiFactoryArm', x: gs.cx, y: gs.cy, size: gs.size, cut: CUTS.arm, z: 'back' });
  S.fadeIn('iconBase', 300, 1300).fadeIn('icon', 300, 1300);
  S.track('icon', t => piv(p, { r: pw([[0, 0], [1500, 0], [2500, -14, eio], [3100, -14], [3700, 7, eio], [4200, 7], [5200, -14, eio], [5800, -14], [6400, 8, eio], [7000, 8], [8000, 0, eio]], t) }), 0, Math.min(E, 8000));
};

// 21 Genetik: Doppelhelix verdreht sich → Biohazard-Zeichen rotiert
PAIRS[20] = (L, S, D, E) => {
  const g = G('m21a');
  const dna = T => ({ sx: (T > 1500 ? 0.8 + 0.2 * cos(2 * PI * (T - 1500) / 2600) : 1) * (T > D ? pw([[D, 1], [D + 1400, 0.3, eio]], T) : 1), sy: 1, r: 10 * Math.min(T, D) / D, y: -14 * Math.min(T, D) / D });
  L.fadeIn('icon', 350, 1800).track('icon', dna, 0, D, 60);
  const q = [0, 0]; L.addFx({ name: 'glint', kind: 'star', x: g.cx, y: g.cy, r: 40, color: '#e9dcff', z: 'front' });
  for (const t0 of [3600, 7200]) pop(L, 'glint', t0, 600, u => { const d = dna(t0 + 600 * u); return { x: d.x, y: d.y, s: 0.2 + sin(PI * u), r: 90 * u }; });
  S.carryFrom('icon', 'carry', 'front').track('carry', t => dna(D + t), 0, 1400, 60).fadeOut('carry', 0, 1400);
  const gs = G('m21b'); S.addFx({ name: 'hglow', kind: 'glow', x: gs.cx, y: gs.cy, r: 330, color: '#d8ff3a', op: 0.5, z: 'back' });
  S.fadeIn('hglow', 300, 1500).track('hglow', t => ({ s: 0.9 + 0.12 * Math.pow(sin(PI * t / 1500), 2) }), 0, E, 60);
  S.fadeIn('icon', 300, 1500).track('icon', t => ({ r: 70 * t / E }), 0, E, 200);
};

// 22 Raumfahrt: Rakete bebt, hebt ab, steigt → (Morph) wird zum Raketenschwarm, der herabstößt
PAIRS[21] = (L, S, D, E) => {
  const g = G('m22a'), d0 = [170, 105], L0 = 3300, dir = [-0.7071, -0.7071];
  const rocket = T => { const u = clamp((T - L0) / (D - L0)), d = 540 * (0.55 * ei2(u) + 0.45 * eio(u)), sh = T > 1500 && T < L0 + 600 ? 3 * (1 - clamp((T - L0) / 600)) : 0;
    return { x: d0[0] + dir[0] * d + sh * sin(2 * PI * T / 83), y: d0[1] + dir[1] * d + sh * sin(2 * PI * T / 71 + 1), s: 1 - 0.38 * Math.pow(u, 1.5) }; };
  L.addFx({ name: '!!rocket', kind: 'iconVar', icon: 'GiRocket', rot: 180, x: g.cx, y: g.cy, size: g.size, z: 'front' });
  L.noIcon = true; L.fadeIn('!!rocket', 300, 1200).track('!!rocket', rocket, 0, D, 30);
  const tail = g.U(60, 60); L.addFx({ name: 'exh', kind: 'glow', x: g.cx + tail[0], y: g.cy + tail[1], r: 110, color: '#ffd9a0', core: '#fff6e6', op: 0.9, z: 'back' });
  L.fadeIn('exh', 1500, 500).track('exh', T => { const r = rocket(T), q = ptOf(g.c, r, tail); return { x: q[0] - g.cx - tail[0], y: q[1] - g.cy - tail[1], s: r.s * (T < L0 ? 0.6 : 1.1) * (1 + 0.15 * noise(T, 130)) }; }, 0, D, 40);
  const pad = [g.cx + d0[0] + tail[0], g.cy + d0[1] + tail[1]];
  [-1, 1].forEach((sgn, j) => {
    const id = 'smoke' + (j + 1); L.addFx({ name: id, kind: 'puff', x: pad[0], y: pad[1] - 10, r: 90, color: '#cbbfb0', op: 0.55, z: 'back', seed: 100 + j });
    L.fadeIn(id, L0, 300).track(id, T => T < 8000 ? { x: sgn * 70 * eo(clamp((T - L0) / 3000)), y: -20 * eo(clamp((T - L0) / 3000)), s: 0.5 + 1.5 * eo(clamp((T - L0) / 3000)) } : { x: 3000, s: 2 }, 0, Math.min(D, 8040)).fadeOut(id, 6000, 1990);
  });
  // Schatten: '!!rocket' ist der Raketenschwarm, beginnt in der Endlage der Rakete
  const re = rocket(D);
  S.addFx({ name: '!!rocket', kind: 'iconVar', icon: 'GiMissileSwarm', x: g.cx, y: g.cy, size: g.size, z: 'front' });
  S.noIcon = true;
  S.track('!!rocket', t => ({ x: pw([[0, re.x - 38], [300, re.x - 38], [4000, 120, eio], [E, 160]], t), y: pw([[0, re.y - 38], [300, re.y - 38], [4000, -35, eio], [E, -5]], t), s: pw([[0, re.s - 0.04], [300, re.s - 0.04], [4000, 1.0, eio], [E, 1.07]], t) }), 0, E);
  S.subStatic = true;
};

// 23 Internet: Längengrad wandert über den Globus, Datenpakete kreisen → Doppelmaske dreht sich wie eine Münze
PAIRS[22] = (L, S, D, E) => {
  const g = G('m23a'), glob = T => ({ s: T <= D ? pw([[0, 1], [D, 1.05]], T) : 1.05 });
  L.fadeIn('icon', 350, 1800).track('icon', glob);
  const Rm = 185;
  L.addFx({ name: 'merL', kind: 'arc', x: g.cx, y: g.cy, R: Rm, side: 'L', color: '#bff6ff', w: 5, z: 'front' });
  L.addFx({ name: 'merR', kind: 'arc', x: g.cx, y: g.cy, R: Rm, side: 'R', color: '#bff6ff', w: 5, z: 'front' });
  const sw = [2000, 4600, 7200], SW = 2400;
  const mer = side => T => { let u = 0; for (const s0 of sw) if (T >= s0 - 1) u = clamp((T - s0) / SW); const c = cos(PI * u), s = glob(T).s; return { sx: Math.max(0.03, side === 'L' ? c : -c) * s, sy: s }; };
  for (const s0 of sw.filter(s => s + SW <= D)) { L.fadeIn('merL', s0, 250).hide('merL', s0 + SW / 2); L.show('merR', s0 + SW / 2).fadeOut('merR', s0 + SW - 300, 290); }
  L.track('merL', mer('L'), sw[0], D, 40); L.track('merR', mer('R'), sw[0], D, 40);
  [[-15, 300, 85, 3200, 1600, 0.5], [20, 270, 70, 4100, 2400, 2.6]].forEach(([th, a, b, per, t0, ph], j) => {
    const id = 'pk' + (j + 1), A = rad(th), c0 = [g.cx + a * cos(ph) * cos(A) - b * sin(ph) * sin(A), g.cy + a * cos(ph) * sin(A) + b * sin(ph) * cos(A)];
    L.addFx({ name: id, kind: 'dot', x: c0[0], y: c0[1], r: 6, color: '#7fe6ff', z: 'front' });
    L.fadeIn(id, t0, 500).orbit(id, { cx: g.cx, cy: g.cy, a, b, th, phi0: ph, per, t0, t1: D });
  });
  S.carryFrom('icon', 'carry', 'back').fadeOut('carry', 0, 1400);
  S.fadeIn('icon', 400, 1200).track('icon', t => ({ sx: pw([[1800, 1], [2200, 0.06, ei], [2600, 1, eo], [5200, 1], [5600, 0.06, ei], [6000, 1, eo]], t) * pw([[0, 1], [E, 1.05]], t), sy: pw([[0, 1], [E, 1.05]], t) }), 0, E, 30);
};

// 24 Smartphone: vibriert, Benachrichtigungen ploppen auf → Überwachungskamera schwenkt, LED blinkt
PAIRS[23] = (L, S, D, E) => {
  const g = G('m24a'), V = [2200, 4200, 6200];
  const vib = T => V.reduce((m, v) => (T >= v && T <= v + 300 ? 5 * sin(2 * PI * (T - v) / 50) : m), 0);
  const ph = T => ({ x: vib(T), s: T <= D ? pw([[0, 0.92], [350, 0.92], [1200, 1.0, eo]], T) : pw([[D, 1], [D + 1300, 0.9]], T) });
  L.fadeIn('icon', 350, 1000).track('icon', ph, 0, D, 12);
  const n0 = g.P(420, 70);
  V.forEach((v, j) => {
    const id = 'nt' + (j + 1); L.addFx({ name: id, kind: 'dot', x: n0[0] + (j - 1) * 30, y: n0[1], r: 10, color: '#ff6ad5', z: 'front' });
    L.fadeIn(id, v + 50, 120).track(id, t => ({ s: pw([[v + 50, 0.2], [v + 250, 1.2, eo], [v + 400, 1.0]], t), y: pw([[v + 50, 0], [v + 1500, -60, eo]], t) }), v + 50, v + 1500, 30).fadeOut(id, v + 900, 600);
  });
  S.carryFrom('icon', 'carry', 'back').track('carry', t => ph(D + t), 0, 1300).fadeOut('carry', 0, 1300);
  const gs = G('m24b'), p = gs.U(180, 386), cam = t => piv(p, { r: pw([[0, 0], [1500, 0], [2700, -11, eio], [3600, -11], [5000, 10, eio], [5800, 10], [7000, -5, eio]], t) });
  S.fadeIn('icon', 400, 1300).track('icon', cam, 0, 7000);
  const q = gs.U(425, 225); S.addFx({ name: 'led', kind: 'dot', x: gs.cx + q[0], y: gs.cy + q[1], r: 6, color: '#ff2e3a', core: '#ffd0d0', z: 'front' });
  const bl = []; for (let t = 1400; t + 350 <= E - 100; t += 700) bl.push([t, t + 350]);
  S.blink('led', bl).track('led', t => { const pnt = ptOf(gs.c, cam(t), q); return { x: pnt[0] - gs.cx - q[0], y: pnt[1] - gs.cy - q[1] }; }, 1400, 7000);
};

// 25 KI: Gehirn atmet, Synapsen blitzen → Cyber-Auge blickt umher
PAIRS[24] = (L, S, D, E) => {
  const g = G('m25a'), br = T => ({ s: T <= D ? 1 + 0.03 * Math.pow(sin(PI * T / 2600), 2) : pw([[D, 1 + 0.03 * Math.pow(sin(PI * D / 2600), 2)], [D + 1400, 0.92]], T) });
  L.fadeIn('icon', 350, 1800).track('icon', br, 0, D, 60);
  [[g.U(150, 190), [2200, 4800, 7400]], [g.U(300, 140), [2900, 5500, 8100]], [g.U(390, 270), [3500, 6100, 8700]], [g.U(230, 330), [4100, 6700, 9300]]].forEach(([q, ts], j) => {
    const id = 'syn' + (j + 1); L.addFx({ name: id, kind: 'star', x: g.cx + q[0], y: g.cy + q[1], r: 34, color: '#a8f0ff', z: 'front' });
    for (const t0 of ts.filter(t => t + 420 <= D)) pop(L, id, t0, 400, u => { const s = br(t0).s; return { x: q[0] * (s - 1), y: q[1] * (s - 1), s: 0.3 + 0.9 * sin(PI * u), r: 45 * u }; });
  });
  S.carryFrom('icon', 'carry', 'back').track('carry', t => br(D + t), 0, 1400).fadeOut('carry', 0, 1400);
  const gs = G('m25b'), R = [[0, 0], [1600, 0], [1750, -25, eo], [3200, -25], [3350, 18, eo], [4800, 18], [4950, -8, eo], [6200, -8], [6350, 30, eo], [7600, 30], [7750, 0, eo]];
  const eye = t => ({ r: pw(R, t), s: pw([[0, 1], [E, 1.06]], t) });
  S.fadeIn('icon', 300, 1200).track('icon', eye, 0, E, 20);
  const q = gs.U(436, 236); S.addFx({ name: 'iris', kind: 'glow', x: gs.cx + q[0], y: gs.cy + q[1], r: 70, color: '#ff2e3a', core: '#ff8080', op: 0.9, z: 'front' });
  S.fadeIn('iris', 1000, 600).track('iris', t => { const pnt = ptOf(gs.c, eye(t), q); return { x: pnt[0] - gs.cx - q[0], y: pnt[1] - gs.cy - q[1], s: 0.9 + 0.15 * sin(2 * PI * t / 1300) }; }, 0, E, 30);
};

// Morph-Paare: Licht-Folie mit Layout im Endzustand und ruhigem Hintergrund
const MORPH = new Set([2, 16, 21]);

function buildPair(i, D, E) {
  const ka = `m${String(i + 1).padStart(2, '0')}a`, kb = `m${String(i + 1).padStart(2, '0')}b`;
  const L = new Slide(ka, D, { ref: MORPH.has(i) ? 'end' : 'start', static: MORPH.has(i) }), S = new Slide(kb, E, { morph: MORPH.has(i) });
  PAIRS[i](L, S, D, E);
  return { L, S };
}
// Zusatzebenen je Szene (unabhängig von der Dauer: mit Standarddauern erzeugen)
function fxFor(key) {
  const m = key.match(/^m(\d\d)([ab])$/); if (!m) return [];
  const i = +m[1] - 1, P = buildPair(i, 10000, i === 18 ? 12000 : 9000);
  return (m[2] === 'a' ? P.L : P.S).fx;
}
module.exports = { buildPair, fxFor, MORPH, TM, G, SPEC };
