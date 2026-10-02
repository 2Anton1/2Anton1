// Renders each scene as separate layers so PowerPoint can animate them independently.
const sharp = require('sharp');
const fs = require('fs');
const { mix, icon, terrain, rng, W, H, HOR } = require('./scenes');

function defs(spec, pal, cx, cy) {
  return `<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.top}"/><stop offset="0.45" stop-color="${pal.mid}"/><stop offset="${HOR / H}" stop-color="${pal.hor}"/><stop offset="1" stop-color="${pal.hor}"/></linearGradient>
  ${spec.splitSky ? `<linearGradient id="split" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${spec.splitSky[0]}" stop-opacity="0.55"/><stop offset="0.5" stop-color="${spec.splitSky[0]}" stop-opacity="0"/><stop offset="0.5" stop-color="${spec.splitSky[1]}" stop-opacity="0"/><stop offset="1" stop-color="${spec.splitSky[1]}" stop-opacity="0.55"/></linearGradient>` : ''}
  <radialGradient id="glow" cx="${cx / W}" cy="${cy / H}" r="0.5" fx="${cx / W}" fy="${cy / H}"><stop offset="0" stop-color="${pal.glow}" stop-opacity="${spec.glowOp ?? 0.75}"/><stop offset="0.35" stop-color="${pal.glow}" stop-opacity="${(spec.glowOp ?? 0.75) * 0.28}"/><stop offset="1" stop-color="${pal.glow}" stop-opacity="0"/></radialGradient>
  <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.82"/></radialGradient>
  <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(pal.hor, '#000000', 0.45)}"/><stop offset="1" stop-color="#030306"/></linearGradient>
  <radialGradient id="earth" cx="0.38" cy="0.35" r="0.75"><stop offset="0" stop-color="#9fd0ff"/><stop offset="0.45" stop-color="#2d6fb8"/><stop offset="0.85" stop-color="#0c2448"/><stop offset="1" stop-color="#020814"/></radialGradient>
  <filter id="b6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="b12" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>
  <filter id="b24" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="24"/></filter>
  <filter id="b60" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11"/><feColorMatrix type="saturate" values="0"/></filter>
  <filter id="rock"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="4" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.18  0 0 0 0 0.08  0 0 0 0.9 0"/></filter>
  </defs>`;
}
// v3: Ausschnitte aus Icons (Icon-Einheiten 0..512). 'spear': Speer aus GiCaveman entfernen (fliegt als eigene Ebene)
const CUTS = {
  spear: [[[110, -10], [305, 40], [302, 96], [110, 48]], [[366, 50], [512, 84], [512, 165], [366, 124]]],
  arm: [[[140, 55], [400, 55], [400, 297], [240, 297], [140, 180]]],   // GiFactoryArm: beweglicher Arm (ohne Deckenhalter, Band, Kisten)
};
function keepIcon(inner, polys, cx, cy, size) {
  const k = size / 512, X = u => (cx + (u - 256) * k).toFixed(1), Y = v => (cy + (v - 256) * k).toFixed(1);
  const d = polys.map(p => 'M' + p.map(([u, v]) => `${X(u)},${Y(v)}`).join(' L') + ' Z').join(' ');
  const id = 'keep' + Math.round(cx) + Math.round(cy);
  return `<clipPath id="${id}"><path d="${d}"/></clipPath><g clip-path="url(#${id})">${inner}</g>`;
}
function clipIcon(inner, polys, cx, cy, size) {
  const k = size / 512, X = u => (cx + (u - 256) * k).toFixed(1), Y = v => (cy + (v - 256) * k).toFixed(1);
  const d = `M-4000,-4000 H8000 V8000 H-4000 Z ` + polys.map(p => 'M' + p.map(([u, v]) => `${X(u)},${Y(v)}`).join(' L') + ' Z').join(' ');
  const id = 'cut' + Math.round(cx) + Math.round(cy);
  return `<clipPath id="${id}"><path d="${d}" clip-rule="evenodd"/></clipPath><g clip-path="url(#${id})">${inner}</g>`;
}
// box = [x,y,w,h] in frame px; scale = output resolution factor
async function out(svgInner, d, box, scale, file, jpg = false) {
  const [x, y, w, h] = box;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" viewBox="${x} ${y} ${w} ${h}">${d}${svgInner}</svg>`;
  const img = sharp(Buffer.from(svg));
  if (jpg) await img.jpeg({ quality: 88, mozjpeg: true }).toFile(file);
  else await img.png({ compressionLevel: 9, effort: 8 }).toFile(file);
  return { file, x: x / 144, y: y / 144, w: w / 144, h: h / 144 };
}

async function renderLayers(spec, name, dir = 'lay') {
  fs.mkdirSync(dir, { recursive: true });
  const pal = spec.pal;
  const cx = spec.cx || 1180, cy = spec.cy || 455, size = spec.size || 440;
  const d = defs(spec, pal, cx, cy);
  const R = {};
  // ---- sky ----
  { const rnd = rng(spec.seed); let s = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
    if (spec.splitSky) s += `<rect width="${W}" height="${H}" fill="url(#split)"/>`;
    if (spec.milky) s += `<ellipse cx="960" cy="330" rx="1200" ry="120" fill="#b9b2ff" opacity="0.10" transform="rotate(-18 960 330)" filter="url(#b60)"/><ellipse cx="960" cy="330" rx="900" ry="45" fill="#e9e4ff" opacity="0.08" transform="rotate(-18 960 330)" filter="url(#b24)"/>`;
    if (spec.stars) for (let i = 0; i < spec.stars; i++) { const x = rnd() * W, y = Math.pow(rnd(), 1.4) * (HOR - 40); const r = rnd() < 0.04 ? 1.9 : 0.6 + rnd() * 0.9; s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#fff" opacity="${(0.25 + rnd() * 0.7 * (1 - y / HOR)).toFixed(2)}"/>`; }
    if (!spec.noGlow) s += `<rect width="${W}" height="${H}" fill="url(#glow)"/>`;
    if (spec.terrain === 'cave') s += `<rect width="${W}" height="${H}" filter="url(#rock)" opacity="0.32"/><circle cx="260" cy="980" r="520" fill="${pal.glow}" opacity="0.22" filter="url(#b60)"/>`;
    s += `<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.05"/>`;
    R.sky = await out(s, d, [0, 0, W, H], 1, `${dir}/${name}_sky.jpg`, true); }
  // ---- disc (sunrise) ----
  if (spec.disc) { const k = spec.disc; const s = `<circle cx="${k.x}" cy="${k.y}" r="${k.r * 1.5}" fill="${k.c}" opacity="0.35" filter="url(#b60)"/><circle cx="${k.x}" cy="${k.y}" r="${k.r}" fill="${k.c}" opacity="${k.op ?? 0.95}"/><circle cx="${k.x}" cy="${k.y}" r="${k.r * 0.92}" fill="${k.inner || k.c}" opacity="0.6" filter="url(#b24)"/>`;
    const pad = k.r * 1.8; R.disc = await out(s, d, [k.x - pad, k.y - pad, 2 * pad, 2 * pad], 0.6, `${dir}/${name}_disc.png`); }
  // ---- rays ----
  if (spec.rays) { const rnd = rng(spec.seed + 5); let r = ''; const L = 1500;
    for (let i = 0; i < 28; i++) { const a = rnd() * Math.PI * 2, w = 0.012 + rnd() * 0.03; r += `<polygon points="${cx},${cy} ${cx + Math.cos(a - w) * L},${cy + Math.sin(a - w) * L} ${cx + Math.cos(a + w) * L},${cy + Math.sin(a + w) * L}" fill="${pal.glow}" opacity="${(0.035 + rnd() * 0.06).toFixed(3)}"/>`; }
    R.rays = await out(`<g filter="url(#b6)">${r}</g>`, d, [cx - L, cy - L, 2 * L, 2 * L], 0.3, `${dir}/${name}_rays.png`); }
  // ---- clouds / smoke ----
  if (spec.smokeBank || spec.clouds) { const rnd = rng(spec.seed + 9); let s = '';
    if (spec.smokeBank) for (let i = 0; i < 32; i++) { const x = -260 + rnd() * (W + 520), y = HOR - 60 - rnd() * 260; s += `<ellipse cx="${x}" cy="${y}" rx="${140 + rnd() * 260}" ry="${40 + rnd() * 70}" fill="${spec.smokeBank}" opacity="${(0.3 + rnd() * 0.35).toFixed(2)}" filter="url(#b60)"/>`; }
    if (spec.clouds) for (let i = 0; i < 15; i++) { const x = -260 + rnd() * (W + 520), y = 120 + rnd() * 420; s += `<ellipse cx="${x}" cy="${y}" rx="${180 + rnd() * 260}" ry="${18 + rnd() * 30}" fill="${spec.clouds}" opacity="${(0.12 + rnd() * 0.2).toFixed(2)}" filter="url(#b12)"/>`; }
    R.clouds = await out(s, d, [-300, 0, W + 600, H], 0.5, `${dir}/${name}_clouds.png`); }
  // ---- land ----
  { const trnd = rng(spec.terrainSeed || spec.seed); const s = terrain({ ...spec, cx }, trnd, pal);
    if (s) R.land = await out(s, d, [0, 0, W, H], 1, `${dir}/${name}_land.png`); }
  // ---- icon ----
  if (spec.icon) { const ic = spec.icon, fill = spec.iconFill || '#07070b'; let s = '';
    if (!spec.noIconGlow) {
      s += `<g filter="url(#b24)" opacity="0.95">${icon(ic, cx, cy, size * 1.04, `fill="${pal.glow}"`)}</g>`;
      s += `<g filter="url(#b6)" opacity="0.9">${icon(ic, cx, cy, size * 1.015, `fill="${mix(pal.glow, '#ffffff', 0.4)}"`)}</g>`;
    }
    s += icon(ic, cx, cy, size, `fill="${fill}" ${spec.iconOp ? `opacity="${spec.iconOp}"` : ''}`);
    if (spec.rot) s = `<g transform="rotate(${spec.rot} ${cx} ${cy})">${s}</g>`;
    if (spec.iconCut) s = clipIcon(s, CUTS[spec.iconCut], cx, cy, size);
    if (spec.iconKeep) s = keepIcon(s, CUTS[spec.iconKeep], cx, cy, size);
    const S = size / 2 + 110; R.icon = await out(s, d, [cx - S, cy - S, 2 * S, 2 * S], 1, `${dir}/${name}_icon.png`); }
  // ---- orb ----
  if (spec.orb) { const o = spec.orb; const s = `<circle cx="${o.x}" cy="${o.y}" r="${o.r * 4}" fill="${o.c}" opacity="0.3" filter="url(#b60)"/><circle cx="${o.x}" cy="${o.y}" r="${o.r * 1.6}" fill="${o.c}" opacity="0.75" filter="url(#b12)"/><circle cx="${o.x}" cy="${o.y}" r="${o.r}" fill="#fffaf0"/>`;
    const p = o.r * 9; R.orb = await out(s, d, [o.x - p, o.y - p, 2 * p, 2 * p], 1, `${dir}/${name}_orb.png`); }
  return R;
}

// ---- shared layers ----
async function shared(dir = 'lay') {
  fs.mkdirSync(dir, { recursive: true });
  const d = defs({}, { top: '#000000', mid: '#000000', hor: '#000000', glow: '#000000' }, 960, 540);
  const S = {};
  const ov = `<ellipse cx="380" cy="930" rx="1050" ry="330" fill="#000" opacity="0.62" filter="url(#b60)"/><rect width="${W}" height="${H}" fill="url(#vig)"/>`;
  S.overlay = await out(ov, d, [0, 0, W, H], 0.5, `${dir}/overlay.png`);
  // cave frame overlay
  { const rnd = rng(42); const c = '#050304';
    const pts = [[60, H], [20, 820], [60, 600], [20, 380], [140, 160], [380, 40], [700, 10], [1000, 0], [1320, 20], [1620, 80], [1850, 260], [1900, 560], [1880, 790], [1900, H]];
    let p = `M-200,-200 L${W + 200},-200 L${W + 200},${H + 200} L-200,${H + 200} Z M60,${H} ` + pts.map(q => `L${q[0] + (rnd() - 0.5) * 30},${q[1] + (rnd() - 0.5) * 30}`).join(' ') + ' Z';
    const s = `<path d="${p}" fill="${c}" fill-rule="evenodd" filter="url(#b60)"/><path d="${p}" fill="${c}" fill-rule="evenodd" filter="url(#b24)" opacity="0.8"/><path d="M-200,${H + 200} L-200,900 C400,840 800,870 1100,890 C1400,910 1700,860 ${W + 200},880 L${W + 200},${H + 200} Z" fill="${c}"/>`;
    S.cave = await out(s, d, [-100, -60, W + 200, H + 120], 1, `${dir}/caveframe.png`); }
  // particles (fine, sharp) and bokeh (large, soft, foreground)
  const types = { dust: ['#ffe7c2', 0.6, 1.8, 150], embers: ['#ff7a2a', 0.8, 2.8, 220], ash: ['#a39890', 0.6, 2.2, 280], data: ['#7fe6ff', 0.6, 1.6, 200], sparks: ['#ffd36b', 0.6, 2.2, 320], snow: ['#ffffff', 0.6, 2.0, 260], toxicP: ['#d8ff3a', 0.6, 1.8, 200] };
  for (const [t, [c, r0, r1, n]] of Object.entries(types)) {
    const rnd = rng(t.length * 977); const bw = W * 1.3, bh = H * 1.3; let s = '';
    for (let i = 0; i < n; i++) { const x = rnd() * bw, y = rnd() * bh, r = r0 + rnd() * (r1 - r0); s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="${c}" opacity="${(0.25 + rnd() * 0.7).toFixed(2)}"/>`; }
    S['p_' + t] = await out(s, d, [0, 0, bw, bh], 1, `${dir}/p_${t}.png`); S['p_' + t].x = -0.15 * W / 144; S['p_' + t].y = -0.15 * H / 144;
    let b = ''; const bw2 = W * 1.4, bh2 = H * 1.4;
    for (let i = 0; i < 16; i++) { const x = rnd() * bw2, y = rnd() * bh2, r = 6 + rnd() * 16; b += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="${c}" opacity="${(0.12 + rnd() * 0.25).toFixed(2)}" filter="url(#b6)"/>`; }
    S['b_' + t] = await out(b, d, [0, 0, bw2, bh2], 0.5, `${dir}/b_${t}.png`); S['b_' + t].x = -0.2 * W / 144; S['b_' + t].y = -0.2 * H / 144;
  }
  // shooting star
  S.meteor = await out(`<defs><linearGradient id="mt" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.95"/></linearGradient></defs><rect x="0" y="9" width="420" height="3" rx="1.5" fill="url(#mt)"/><circle cx="418" cy="10.5" r="4" fill="#fff"/><circle cx="418" cy="10.5" r="9" fill="#fff" opacity="0.35" filter="url(#b6)"/>`, d, [0, 0, 440, 21], 1, `${dir}/meteor.png`);
  return S;
}
module.exports = { renderLayers, shared, defs, out, clipIcon, CUTS };
