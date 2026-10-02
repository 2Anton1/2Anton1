// Scene renderer: cinematic silhouette scenes -> 1920x1080 JPG
const gi = require('react-icons/gi');
const React = require('react');
const RDS = require('react-dom/server');
const sharp = require('sharp');
const fs = require('fs');

const W = 1920, H = 1080, HOR = 720;

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hx = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const toHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const A = hx(a), B = hx(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };

const iconCache = {};
function iconInner(name) {
  if (!iconCache[name]) {
    const s = RDS.renderToStaticMarkup(React.createElement(gi[name]));
    iconCache[name] = s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  }
  return iconCache[name];
}
function icon(name, cx, cy, size, attrs = '') {
  const s = size / 512;
  return `<g transform="translate(${cx - size / 2},${cy - size / 2}) scale(${s})" ${attrs}>${iconInner(name)}</g>`;
}

function ridge(rnd, y, amp, step = 16) {
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6], f = [0.0021 + rnd() * 0.001, 0.0063 + rnd() * 0.002, 0.017 + rnd() * 0.004];
  let d = `M0,${H} `;
  for (let x = 0; x <= W; x += step) {
    const v = Math.sin(x * f[0] + ph[0]) * amp + Math.sin(x * f[1] + ph[1]) * amp * 0.35 + Math.sin(x * f[2] + ph[2]) * amp * 0.12;
    d += `L${x},${(y - Math.abs(v) * 0.6 - v * 0.4).toFixed(1)} `;
  }
  return d + `L${W},${H} Z`;
}

// ---------- terrain features ----------
function acacia(x, y, h, c, rnd) {
  const w = 70 + rnd() * 70;
  let s = `<path d="M${x},${y} C${x + 3},${y - h * 0.5} ${x + 12},${y - h * 0.8} ${x + 18},${y - h} L${x + 24},${y - h} C${x + 16},${y - h * 0.7} ${x + 10},${y - h * 0.4} ${x + 9},${y} Z" fill="${c}"/>`;
  s += `<path d="M${x + 14},${y - h * 0.7} L${x - w * 0.35},${y - h * 1.02} L${x - w * 0.3},${y - h * 1.04} L${x + 16},${y - h * 0.76} Z" fill="${c}"/>`;
  s += `<ellipse cx="${x + 20}" cy="${y - h - 6}" rx="${w}" ry="${12 + rnd() * 6}" fill="${c}"/>`;
  s += `<ellipse cx="${x - w * 0.3}" cy="${y - h * 1.05}" rx="${w * 0.55}" ry="${9 + rnd() * 4}" fill="${c}"/>`;
  return s;
}
function buildings(rnd, kind, base, c, glow) {
  let s = '';
  if (kind === 'ancient') {
    // ziggurat + pyramids + palms
    const zx = 260 + rnd() * 200;
    for (let i = 0; i < 4; i++) { const w = 360 - i * 80, h = 34; s += `<rect x="${zx - w / 2}" y="${base - (i + 1) * h}" width="${w}" height="${h + 1}" fill="${c}"/>`; }
    const px = 1550 + rnd() * 120;
    s += `<polygon points="${px - 190},${base} ${px},${base - 170} ${px + 190},${base}" fill="${c}"/>`;
    s += `<polygon points="${px + 120},${base} ${px + 250},${base - 110} ${px + 380},${base}" fill="${c}"/>`;
    for (const tx of [620, 700, 1400, 1840]) s += icon('GiPalmTree', tx, base - 55, 120 + rnd() * 30, `fill="${c}"`);
  } else if (kind === 'medieval') {
    let x = -20;
    while (x < W + 40) {
      const w = 40 + rnd() * 60, h = 40 + rnd() * 70;
      s += `<rect x="${x}" y="${base - h}" width="${w}" height="${h + 2}" fill="${c}"/><polygon points="${x - 4},${base - h} ${x + w / 2},${base - h - w * 0.6} ${x + w + 4},${base - h}" fill="${c}"/>`;
      if (rnd() < 0.5) s += `<rect x="${x + w * 0.3}" y="${base - h * 0.6}" width="6" height="9" fill="${glow}" opacity="0.55"/>`;
      if (rnd() < 0.12) { const th = 150 + rnd() * 120; s += `<rect x="${x + w / 2 - 14}" y="${base - th}" width="28" height="${th}" fill="${c}"/><polygon points="${x + w / 2 - 20},${base - th} ${x + w / 2},${base - th - 70} ${x + w / 2 + 20},${base - th}" fill="${c}"/>`; }
      x += w - 4;
    }
    const sx = 1500; s += `<rect x="${sx}" y="${base - 230}" width="44" height="230" fill="${c}"/><polygon points="${sx - 6},${base - 230} ${sx + 22},${base - 390} ${sx + 50},${base - 230}" fill="${c}"/>`;
  } else if (kind === 'industrial') {
    let x = -10;
    while (x < W) {
      const w = 90 + rnd() * 90, h = 50 + rnd() * 60;
      s += `<rect x="${x}" y="${base - h}" width="${w}" height="${h + 2}" fill="${c}"/>`;
      for (let k = 0; k < 3; k++) { const tx = x + k * w / 3; s += `<polygon points="${tx},${base - h} ${tx},${base - h - 26} ${tx + w / 3},${base - h}" fill="${c}"/>`; }
      if (rnd() < 0.45) { const ch = 160 + rnd() * 160, cx = x + rnd() * w; s += `<polygon points="${cx},${base - h} ${cx + 4},${base - h - ch} ${cx + 20},${base - h - ch} ${cx + 24},${base - h}" fill="${c}"/>`; s += smoke(rnd, cx + 12, base - h - ch, 6, 0.35); }
      x += w;
    }
  } else if (kind === 'city' || kind === 'digital') {
    let x = -10;
    while (x < W) {
      const w = 34 + rnd() * 70, h = 60 + Math.pow(rnd(), 1.6) * (kind === 'digital' ? 420 : 340);
      s += `<rect x="${x}" y="${base - h}" width="${w}" height="${h + 2}" fill="${c}"/>`;
      if (rnd() < 0.2) s += `<rect x="${x + w / 2 - 2}" y="${base - h - 50}" width="4" height="50" fill="${c}"/>`;
      for (let wy = base - h + 10; wy < base - 8; wy += 14) for (let wx = x + 5; wx < x + w - 6; wx += 10) if (rnd() < 0.16) s += `<rect x="${wx}" y="${wy}" width="4" height="6" fill="${glow}" opacity="${0.25 + rnd() * 0.45}"/>`;
      x += w + rnd() * 6;
    }
  } else if (kind === 'lowcity') {
    let x = -10;
    while (x < W) { const w = 40 + rnd() * 80, h = 20 + rnd() * 70; s += `<rect x="${x}" y="${base - h}" width="${w}" height="${h + 2}" fill="${c}"/>`; x += w; }
  }
  return s;
}
function smoke(rnd, x, y, n, op, col = '#2a2627') {
  let s = '';
  for (let i = 0; i < n; i++) { const r = 18 + i * 14; s += `<circle cx="${x + i * i * 4 + rnd() * 10}" cy="${y - i * 32}" r="${r}" fill="${col}" opacity="${(op * (1 - i / (n + 1))).toFixed(2)}" filter="url(#b12)"/>`; }
  return s;
}

function terrain(spec, rnd, pal) {
  const far = mix(pal.hor, pal.top, 0.45), mid = mix(pal.hor, '#05050a', 0.72), near = '#050508';
  const glowC = pal.glow;
  let s = '';
  const t = spec.terrain;
  if (t === 'space') {
    s += `<circle cx="1560" cy="250" r="130" fill="url(#earth)"/><circle cx="1560" cy="250" r="150" fill="${'#5fa8ff'}" opacity="0.15" filter="url(#b24)"/>`;
    s += `<path d="${ridge(rnd, 800, 30, 20)}" fill="${mix('#3a3a44', pal.hor, 0.15)}"/>`;
    for (let i = 0; i < 26; i++) { const x = rnd() * W, y = 830 + rnd() * 230, r = 10 + rnd() * 60; s += `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.28}" fill="#15151b" opacity="0.7"/>`; }
    s += `<path d="${ridge(rnd, 940, 25, 20)}" fill="${near}"/>`;
    return s;
  }
  if (t === 'sea') {
    s += `<rect x="0" y="${HOR}" width="${W}" height="${H - HOR}" fill="url(#sea)"/>`;
    for (let i = 0; i < 70; i++) { const y = HOR + 6 + Math.pow(rnd(), 1.5) * 340, w = 20 + rnd() * 140 * (y - HOR) / 200; s += `<rect x="${spec.cx - w / 2 + (rnd() - 0.5) * (y - HOR) * 0.9}" y="${y}" width="${w}" height="${1.5 + (y - HOR) / 120}" fill="${glowC}" opacity="${0.12 + rnd() * 0.35}"/>`; }
    s += `<path d="M0,${H} L0,900 C120,880 220,920 330,960 L420,${H} Z" fill="${near}"/>`;
    return s;
  }
  if (t === 'cave') return s; // handled as frame
  // far range
  s += `<path d="${ridge(rnd, HOR - 30, 60)}" fill="${far}" opacity="0.85"/>`;
  const kinds = { ancient: 'ancient', medieval: 'medieval', industrial: 'industrial', city: 'city', digital: 'digital', lowcity: 'lowcity' };
  if (kinds[t]) s += buildings(rnd, kinds[t], HOR + 8, mix(far, mid, (t === 'city' || t === 'digital') ? 0.8 : 0.55), glowC);
  s += `<path d="${ridge(rnd, HOR + 20, 22)}" fill="${mid}"/>`;
  if (t === 'savanna') { for (let i = 0; i < 6; i++) { const x = rnd() * W; if (x > 900 && x < 1460) continue; s += acacia(x, HOR + 26 + rnd() * 20, 70 + rnd() * 90, mid, rnd); } }
  if (t === 'tundra') { for (let i = 0; i < 14; i++) { const x = rnd() * W; if (x > 950 && x < 1500) continue; s += icon('GiPineTree', x, HOR - 5 + rnd() * 30, 80 + rnd() * 90, `fill="${mid}"`); } }
  if (t === 'fields') {
    for (let i = 0; i < 5; i++) { const x = rnd() * W; if (x > 950 && x < 1450) continue; s += `<ellipse cx="${x}" cy="${HOR + 10}" rx="${40 + rnd() * 50}" ry="${30 + rnd() * 20}" fill="${mid}"/>`; }
  }
  // near ground
  s += `<path d="${ridge(rnd, 860, 40)}" fill="${near}"/>`;
  if (t === 'fields') for (let i = -14; i <= 14; i++) s += `<line x1="${960 + i * 18}" y1="880" x2="${960 + i * 260}" y2="${H}" stroke="${glowC}" stroke-opacity="0.045" stroke-width="2"/>`;
  if (t === 'digital' || spec.grid) {
    for (let i = -24; i <= 24; i++) s += `<line x1="${960 + i * 22}" y1="860" x2="${960 + i * 260}" y2="${H}" stroke="${glowC}" stroke-opacity="0.16" stroke-width="1.5"/>`;
    let y = 870, g = 8; while (y < H) { s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${glowC}" stroke-opacity="0.12" stroke-width="1.5"/>`; y += g; g *= 1.35; }
  }
  return s;
}

// ---------- main scene ----------
function scene(spec) {
  const rnd = rng(spec.seed);
  const pal = spec.pal;
  const cx = spec.cx || 1180, cy = spec.cy || 455, size = spec.size || 440;
  let defs = `<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${pal.top}"/><stop offset="0.45" stop-color="${pal.mid}"/><stop offset="${HOR / H}" stop-color="${pal.hor}"/><stop offset="1" stop-color="${pal.hor}"/></linearGradient>
  ${spec.splitSky ? `<linearGradient id="split" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${spec.splitSky[0]}" stop-opacity="0.55"/><stop offset="0.5" stop-color="${spec.splitSky[0]}" stop-opacity="0"/><stop offset="0.5" stop-color="${spec.splitSky[1]}" stop-opacity="0"/><stop offset="1" stop-color="${spec.splitSky[1]}" stop-opacity="0.55"/></linearGradient>` : ''}
  <radialGradient id="glow" cx="${cx / W}" cy="${cy / H}" r="0.5" gradientUnits="objectBoundingBox" fx="${cx / W}" fy="${cy / H}">
    <stop offset="0" stop-color="${pal.glow}" stop-opacity="${spec.glowOp ?? 0.75}"/><stop offset="0.35" stop-color="${pal.glow}" stop-opacity="${(spec.glowOp ?? 0.75) * 0.28}"/><stop offset="1" stop-color="${pal.glow}" stop-opacity="0"/></radialGradient>
  <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.82"/></radialGradient>
  <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(pal.hor, '#000000', 0.45)}"/><stop offset="1" stop-color="#030306"/></linearGradient>
  <radialGradient id="earth" cx="0.38" cy="0.35" r="0.75"><stop offset="0" stop-color="#9fd0ff"/><stop offset="0.45" stop-color="#2d6fb8"/><stop offset="0.85" stop-color="#0c2448"/><stop offset="1" stop-color="#020814"/></radialGradient>
  <filter id="b6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="b12" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>
  <filter id="b24" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="24"/></filter>
  <filter id="b60" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${spec.seed % 97}"/><feColorMatrix type="saturate" values="0"/></filter>
  <filter id="rock"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="4" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.18  0 0 0 0 0.08  0 0 0 0.9 0"/></filter>
  </defs>`;
  let s = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  if (spec.splitSky) s += `<rect width="${W}" height="${H}" fill="url(#split)"/>`;
  // milky way / stars
  if (spec.milky) s += `<ellipse cx="960" cy="330" rx="1200" ry="120" fill="#b9b2ff" opacity="0.10" transform="rotate(-18 960 330)" filter="url(#b60)"/><ellipse cx="960" cy="330" rx="900" ry="45" fill="#e9e4ff" opacity="0.08" transform="rotate(-18 960 330)" filter="url(#b24)"/>`;
  if (spec.stars) { const n = spec.stars; for (let i = 0; i < n; i++) { const x = rnd() * W, y = Math.pow(rnd(), 1.4) * (HOR - 40); const r = rnd() < 0.04 ? 1.9 : 0.6 + rnd() * 0.9; s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#fff" opacity="${(0.25 + rnd() * 0.7 * (1 - y / HOR)).toFixed(2)}"/>`; } }
  // big glow & rays
  if (!spec.noGlow) s += `<rect width="${W}" height="${H}" fill="url(#glow)"/>`;
  if (spec.disc) { const d = spec.disc; s += `<circle cx="${d.x}" cy="${d.y}" r="${d.r * 1.5}" fill="${d.c}" opacity="0.35" filter="url(#b60)"/><circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${d.c}" opacity="${d.op ?? 0.95}"/><circle cx="${d.x}" cy="${d.y}" r="${d.r * 0.92}" fill="${d.inner || d.c}" opacity="0.6" filter="url(#b24)"/>`; }
  if (spec.rays) { let r = ''; for (let i = 0; i < 28; i++) { const a = rnd() * Math.PI * 2, w = 0.012 + rnd() * 0.03, L = 1600; r += `<polygon points="${cx},${cy} ${cx + Math.cos(a - w) * L},${cy + Math.sin(a - w) * L} ${cx + Math.cos(a + w) * L},${cy + Math.sin(a + w) * L}" fill="${pal.glow}" opacity="${(0.03 + rnd() * 0.06).toFixed(3)}"/>`; } s += `<g filter="url(#b6)">${r}</g>`; }
  // clouds / smoke banks
  if (spec.smokeBank) { for (let i = 0; i < 26; i++) { const x = rnd() * W, y = HOR - 60 - rnd() * 260; s += `<ellipse cx="${x}" cy="${y}" rx="${140 + rnd() * 260}" ry="${40 + rnd() * 70}" fill="${spec.smokeBank}" opacity="${(0.3 + rnd() * 0.35).toFixed(2)}" filter="url(#b60)"/>`; } }
  if (spec.clouds) { for (let i = 0; i < 12; i++) { const x = rnd() * W, y = 120 + rnd() * 420; s += `<ellipse cx="${x}" cy="${y}" rx="${180 + rnd() * 260}" ry="${18 + rnd() * 30}" fill="${spec.clouds}" opacity="${(0.12 + rnd() * 0.2).toFixed(2)}" filter="url(#b12)"/>`; } }
  // cave wall background
  if (spec.terrain === 'cave') s += `<rect width="${W}" height="${H}" filter="url(#rock)" opacity="0.32"/><circle cx="260" cy="980" r="520" fill="${pal.glow}" opacity="0.22" filter="url(#b60)"/>`;
  // terrain
  const trnd = rng(spec.terrainSeed || spec.seed);
  s += terrain({ ...spec, cx }, trnd, pal);
  // main icon(s)
  const ic = spec.icon;
  if (ic && spec.rot) s += `<g transform="rotate(${spec.rot} ${cx} ${cy})">`;
  if (ic) {
    const fill = spec.iconFill || '#07070b';
    if (!spec.noIconGlow) {
      s += `<g filter="url(#b24)" opacity="0.95">${icon(ic, cx, cy, size * 1.04, `fill="${pal.glow}"`)}</g>`;
      s += `<g filter="url(#b6)" opacity="0.9">${icon(ic, cx, cy, size * 1.015, `fill="${mix(pal.glow, '#ffffff', 0.4)}"`)}</g>`;
    }
    s += icon(ic, cx, cy, size, `fill="${fill}" ${spec.iconOp ? `opacity="${spec.iconOp}"` : ''}`);
  }
  if (ic && spec.rot) s += `</g>`;
  if (spec.extraIcons) for (const e of spec.extraIcons) { s += `<g filter="url(#b12)" opacity="0.8">${icon(e.name, e.x, e.y, e.size * 1.04, `fill="${pal.glow}"`)}</g>` + icon(e.name, e.x, e.y, e.size, `fill="${e.fill || '#07070b'}" ${e.op ? `opacity="${e.op}"` : ''}`); }
  if (spec.orb) { const o = spec.orb; s += `<circle cx="${o.x}" cy="${o.y}" r="${o.r * 4}" fill="${o.c}" opacity="0.25" filter="url(#b60)"/><circle cx="${o.x}" cy="${o.y}" r="${o.r * 1.6}" fill="${o.c}" opacity="0.7" filter="url(#b12)"/><circle cx="${o.x}" cy="${o.y}" r="${o.r}" fill="#fffaf0"/>`; }
  // cave frame
  if (spec.terrain === 'cave') {
    const c = '#050304';
    let d = `M0,0 L${W},0 L${W},${H} L0,${H} Z M140,${H} `;
    const pts = [[60, H], [20, 820], [60, 600], [20, 380], [140, 160], [380, 40], [700, 10], [1000, 0], [1320, 20], [1620, 80], [1850, 260], [1900, 560], [1880, 790], [1900, H]];
    d += pts.map(p => `L${p[0] + (rnd() - 0.5) * 30},${p[1] + (rnd() - 0.5) * 30}`).join(' ') + ' Z';
    s += `<path d="${d}" fill="${c}" fill-rule="evenodd" filter="url(#b60)"/><path d="${d}" fill="${c}" fill-rule="evenodd" filter="url(#b24)" opacity="0.8"/>`;
    s += `<path d="M0,${H} L0,900 C400,840 800,870 1100,890 C1400,910 1700,860 ${W},880 L${W},${H} Z" fill="${c}"/>`;
  }
  // particles
  if (spec.particles) {
    const pc = spec.particles; let p = '';
    for (let i = 0; i < pc.n; i++) { const x = rnd() * W, y = rnd() * H, r = pc.r[0] + rnd() * (pc.r[1] - pc.r[0]); p += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="${pc.c}" opacity="${((0.2 + rnd() * 0.7) * (y > HOR + 40 ? 0.35 : 1)).toFixed(2)}"/>`; }
    s += `<g ${pc.blur ? 'filter="url(#b6)"' : ''}>${p}</g>`;
  }
  if (!spec.noLower) s += `<ellipse cx="380" cy="930" rx="1050" ry="330" fill="#000" opacity="0.62" filter="url(#b60)"/>`;
  if (spec.flash) s += `<rect width="${W}" height="${H}" fill="${spec.flash}" opacity="0.08"/>`;
  // vignette + grain
  s += `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;
  s += `<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.07"/>`;
  // progress timeline
  if (spec.progress) {
    const [i, n] = spec.progress, x0 = 1140, x1 = 1780, y = 1022;
    s += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#ffffff" stroke-opacity="0.16" stroke-width="1.5"/>`;
    for (let k = 0; k < n; k++) { const x = x0 + (x1 - x0) * k / (n - 1); const cur = k === i; s += cur ? `<circle cx="${x}" cy="${y}" r="11" fill="${spec.accent}" opacity="0.35" filter="url(#b6)"/><circle cx="${x}" cy="${y}" r="5" fill="${spec.accent}"/>` : `<circle cx="${x}" cy="${y}" r="2.6" fill="#fff" opacity="${k < i ? 0.55 : 0.2}"/>`; }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}${s}</svg>`;
}

async function render(spec, out) {
  const svg = scene(spec);
  await sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toFile(out);
}
module.exports = { render, scene, mix, icon, terrain, rng, smoke, W, H, HOR };
