// v3: Zusatzebenen (Speer, Rauch, Funken, Blitze, Lettern …) im Silhouetten-/Glow-Stil von layers.js.
// Jede Ebene ist ein eigenes PNG, zentriert auf (x, y) in Szenen-Pixeln (1920 × 1080).
const { mix, icon, rng } = require('./scenes');
const { defs, out, clipIcon } = require('./layers');

const DARK = '#07070b';
// Silhouette + zweistufiger Glow wie bei den Icons in layers.js
function sil(shape, glow, o = {}) {
  const g2 = mix(glow, '#ffffff', 0.4);
  let s = '';
  if (!o.noGlow) {
    s += `<g filter="url(#b24)" opacity="0.95">${shape(`fill="${glow}" stroke="${glow}" stroke-width="${o.gw ?? 9}" stroke-linejoin="round"`)}</g>`;
    s += `<g filter="url(#b6)" opacity="0.9">${shape(`fill="${g2}" stroke="${g2}" stroke-width="${o.gw2 ?? 3.5}" stroke-linejoin="round"`)}</g>`;
  }
  return s + shape(`fill="${o.fill || DARK}"`);
}
const pts = a => a.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');

const KINDS = {
  // Icon-Variante: gleiche Darstellung wie das Szenen-Icon, optional beschnitten (cut) oder nur Teilbereich (keep)
  iconVar(f, pal) {
    const size = f.size, cx = f.x, cy = f.y, fill = f.fill || DARK;
    let s = '';
    if (!f.noGlow) {
      s += `<g filter="url(#b24)" opacity="0.95">${icon(f.icon, cx, cy, size * 1.04, `fill="${pal.glow}"`)}</g>`;
      s += `<g filter="url(#b6)" opacity="0.9">${icon(f.icon, cx, cy, size * 1.015, `fill="${mix(pal.glow, '#ffffff', 0.4)}"`)}</g>`;
    }
    s += icon(f.icon, cx, cy, size, `fill="${fill}" ${f.op ? `opacity="${f.op}"` : ''}`);
    if (f.rot) s = `<g transform="rotate(${f.rot} ${cx} ${cy})">${s}</g>`;
    if (f.cut) s = clipIcon(s, f.cut, cx, cy, size);
    if (f.keep) {
      const k = size / 512, X = u => (cx + (u - 256) * k).toFixed(1), Y = v => (cy + (v - 256) * k).toFixed(1);
      const d = f.keep.map(p => 'M' + p.map(([u, v]) => `${X(u)},${Y(v)}`).join(' L') + ' Z').join(' ');
      const id = 'keep' + f.name; s = `<clipPath id="${id}"><path d="${d}"/></clipPath><g clip-path="url(#${id})">${s}</g>`;
    }
    const S = size / 2 + 110; return { s, box: [cx - S, cy - S, 2 * S, 2 * S] };
  },
  // Speer (waagrecht gezeichnet, Spitze nach rechts); Länge in px
  spear(f, pal) {
    const L = f.len, h = L / 2, w = L * 0.03, x = f.x, y = f.y;
    const shape = a => `<rect x="${x - h}" y="${y - w / 2}" width="${L * 0.79}" height="${w}" rx="${w / 2}" ${a}/>` +
      `<polygon points="${pts([[x + h * 0.55, y - w * 1.6], [x + h * 0.8, y - w * 1.9], [x + h, y], [x + h * 0.8, y + w * 1.9], [x + h * 0.55, y + w * 1.4]])}" ${a}/>`;
    return { s: sil(shape, pal.glow, { gw: 7 }), box: [x - h - 60, y - 60, L + 120, 120] };
  },
  // weiche Rauch-/Dampf-/Gaswolke
  puff(f) {
    const rnd = rng(f.seed || 5), r = f.r, x = f.x, y = f.y; let s = '';
    s += `<circle cx="${x}" cy="${y}" r="${r * 1.05}" fill="${f.color}" opacity="${(f.op ?? 0.7) * 0.45}" filter="url(#b24)"/>`;
    for (let i = 0; i < 6; i++) { const a = rnd() * 6.28, d = r * 0.45 * rnd(), rr = r * (0.42 + rnd() * 0.3); s += `<circle cx="${(x + Math.cos(a) * d).toFixed(1)}" cy="${(y + Math.sin(a) * d * 0.8).toFixed(1)}" r="${rr.toFixed(1)}" fill="${f.color}" opacity="${((f.op ?? 0.7) * (0.5 + rnd() * 0.4)).toFixed(2)}" filter="url(#b12)"/>`; }
    if (f.rim) s += `<circle cx="${x - r * 0.15}" cy="${y - r * 0.2}" r="${r * 0.55}" fill="${f.rim}" opacity="0.18" filter="url(#b24)"/>`;
    const p = r * 1.7; return { s, box: [x - p, y - p, 2 * p, 2 * p] };
  },
  // Strahlenkranz: Funken, Splitter, Feuerwerk, Mündungsfeuer
  burst(f) {
    const rnd = rng(f.seed || 9), r = f.r, x = f.x, y = f.y, n = f.n || 18; let rays = '', dots = '';
    for (let i = 0; i < n; i++) {
      const a = (f.spread ? (f.dir - f.spread / 2 + rnd() * f.spread) : (i / n) * 6.283 + rnd() * 0.3), r0 = r * (0.18 + rnd() * 0.25), r1 = r * (0.6 + rnd() * 0.4);
      rays += `<line x1="${(x + Math.cos(a) * r0).toFixed(1)}" y1="${(y + Math.sin(a) * r0).toFixed(1)}" x2="${(x + Math.cos(a) * r1).toFixed(1)}" y2="${(y + Math.sin(a) * r1).toFixed(1)}" stroke-width="${(f.w || 3) * (0.6 + rnd() * 0.7)}" stroke-linecap="round"/>`;
      if (f.dots) dots += `<circle cx="${(x + Math.cos(a) * r1 * 1.04).toFixed(1)}" cy="${(y + Math.sin(a) * r1 * 1.04).toFixed(1)}" r="${(f.w || 3) * 0.9}"/>`;
    }
    let s = `<g stroke="${f.color}" fill="${f.color}" filter="url(#b6)" opacity="0.9">${rays}${dots}</g><g stroke="${mix(f.color, '#ffffff', 0.55)}" fill="${mix(f.color, '#ffffff', 0.55)}">${rays}${dots}</g>`;
    if (f.core) s = `<circle cx="${x}" cy="${y}" r="${r * 0.42}" fill="${f.core}" opacity="0.85" filter="url(#b24)"/><circle cx="${x}" cy="${y}" r="${r * 0.14}" fill="#fffaf0" filter="url(#b6)"/>` + s;
    const p = r * 1.25; return { s, box: [x - p, y - p, 2 * p, 2 * p] };
  },
  // weiches Licht (Blitz, Kernglühen, Hitze)
  glow(f) {
    const r = f.r, x = f.x, y = f.y, b1 = r >= 250 ? 'b60' : r >= 120 ? 'b24' : 'b12', b2 = r >= 120 ? 'b24' : 'b6';
    const s = `<circle cx="${x}" cy="${y}" r="${r * 0.7}" fill="${f.color}" opacity="${(f.op ?? 0.8) * 0.6}" filter="url(#${b1})"/><circle cx="${x}" cy="${y}" r="${r * 0.32}" fill="${f.core || f.color}" opacity="${f.op ?? 0.8}" filter="url(#${b2})"/>`;
    const p = r * 1.25; return { s, box: [x - p, y - p, 2 * p, 2 * p] };
  },
  // heller Punkt mit Hof (Elektron, LED, Datenpaket, Tropfen)
  dot(f) {
    const r = f.r, x = f.x, y = f.y;
    const s = `<circle cx="${x}" cy="${y}" r="${r * 3.2}" fill="${f.color}" opacity="0.35" filter="url(#b12)"/><circle cx="${x}" cy="${y}" r="${r * 1.6}" fill="${f.color}" opacity="0.85" filter="url(#b6)"/><circle cx="${x}" cy="${y}" r="${r}" fill="${f.core || '#fffaf0'}"/>`;
    const p = r * 5; return { s, box: [x - p, y - p, 2 * p, 2 * p] };
  },
  // vierzackiges Glanzlicht
  star(f) {
    const r = f.r, x = f.x, y = f.y, t = r * 0.12;
    const st = `<polygon points="${pts([[x, y - r], [x + t, y - t], [x + r, y], [x + t, y + t], [x, y + r], [x - t, y + t], [x - r, y], [x - t, y - t]])}"`;
    const s = `<circle cx="${x}" cy="${y}" r="${r * 0.5}" fill="${f.color}" opacity="0.6" filter="url(#b12)"/>${st} fill="${f.color}" filter="url(#b6)"/>${st} fill="#fffaf0"/>`;
    const p = r * 1.3; return { s, box: [x - p, y - p, 2 * p, 2 * p] };
  },
  // Lettern / Bits als Silhouette mit Glow
  glyph(f, pal) {
    const x = f.x, y = f.y, sz = f.size;
    const shape = a => `<text x="${x}" y="${y + sz * 0.35}" font-family="DejaVu Serif" font-weight="bold" font-size="${sz}" text-anchor="middle" ${a}>${f.text}</text>`;
    const p = sz * 0.9; return { s: sil(shape, f.glow || pal.glow, { gw: 6 }), box: [x - p, y - p, 2 * p, 2 * p] };
  },
  // Schallwellen (Bögen nach rechts)
  waves(f) {
    const x = f.x, y = f.y, r = f.r; let arcs = '';
    for (const k of [0.45, 0.72, 1.0]) { const R = r * k, a = 0.75; arcs += `<path d="M${(x + Math.cos(-a) * R).toFixed(1)},${(y + Math.sin(-a) * R).toFixed(1)} A${R},${R} 0 0 1 ${(x + Math.cos(a) * R).toFixed(1)},${(y + Math.sin(a) * R).toFixed(1)}" stroke-width="${r * 0.07}" fill="none" stroke-linecap="round"/>`; }
    const s = `<g stroke="${f.color}" filter="url(#b12)" opacity="0.9">${arcs}</g><g stroke="${DARK}">${arcs}</g>`;
    const p = r * 1.2; return { s, box: [x - p, y - p, 2 * p, 2 * p] };
  },
  // halber Längengrad (Ellipsenbogen) um die Globusmitte, für x-Skalierung
  arc(f) {
    const x = f.x, y = f.y, R = f.R, sgn = f.side === 'L' ? 0 : 1;
    const d = `M${x},${y - R} A${R},${R} 0 0 ${sgn} ${x},${y + R}`;
    const s = `<path d="${d}" stroke="${f.color}" stroke-width="${f.w * 3}" fill="none" opacity="0.7" filter="url(#b12)"/><path d="${d}" stroke="${mix(f.color, '#ffffff', 0.5)}" stroke-width="${f.w}" fill="none" stroke-linecap="round"/>`;
    const p = R + 40; return { s, box: [x - p, y - p, 2 * p, 2 * p] };
  },
  // Balken (Quecksilber)
  bar(f) {
    const { x, y, w, h } = f;
    const s = `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${w / 2}" fill="${f.color}" opacity="0.8" filter="url(#b6)"/><rect x="${x - w * 0.3}" y="${y - h / 2}" width="${w * 0.6}" height="${h}" rx="${w * 0.3}" fill="${mix(f.color, '#ffffff', 0.35)}"/>`;
    return { s, box: [x - w - 30, y - h / 2 - 30, 2 * w + 60, h + 60] };
  },
  // kleine Icon-Kopie (Virus-Vermehrung)
  mini(f, pal) {
    const s = `<g filter="url(#b12)" opacity="0.9">${icon(f.icon, f.x, f.y, f.size * 1.05, `fill="${f.glow || pal.glow}"`)}</g>` + icon(f.icon, f.x, f.y, f.size, `fill="${DARK}"`);
    const p = f.size / 2 + 50; return { s, box: [f.x - p, f.y - p, 2 * p, 2 * p] };
  },
  // Fahrtlinien
  speed(f) {
    const rnd = rng(f.seed || 3), { x, y, w, h } = f; let l = '';
    for (let i = 0; i < 9; i++) { const yy = y - h / 2 + rnd() * h, ww = w * (0.4 + rnd() * 0.6), xx = x + w / 2 - ww; l += `<rect x="${xx.toFixed(1)}" y="${yy.toFixed(1)}" width="${ww.toFixed(1)}" height="${(2 + rnd() * 3).toFixed(1)}" rx="1.5" fill="url(#spd)" opacity="${(0.4 + rnd() * 0.5).toFixed(2)}"/>`; }
    const s = `<defs><linearGradient id="spd" x1="0" x2="1"><stop offset="0" stop-color="${f.color}" stop-opacity="0"/><stop offset="1" stop-color="${f.color}" stop-opacity="0.9"/></linearGradient></defs><g filter="url(#b6)">${l}</g>${l}`;
    return { s, box: [x - w / 2 - 20, y - h / 2 - 20, w + 40, h + 40] };
  },
  // leuchtender Bildschirm
  screen(f) {
    const { x, y, w, h } = f;
    const s = `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" fill="${f.color}" opacity="0.55" filter="url(#b24)"/><rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" fill="${f.color}" opacity="0.35"/>` +
      [0.25, 0.42, 0.59].map((k, i) => `<rect x="${x - w * 0.38}" y="${y - h / 2 + h * k}" width="${w * (0.5 + 0.12 * i)}" height="${h * 0.05}" fill="${mix(f.color, '#ffffff', 0.6)}" opacity="0.8"/>`).join('');
    return { s, box: [x - w / 2 - 70, y - h / 2 - 70, w + 140, h + 140] };
  },
  // Blase (Ring)
  ring(f) {
    const { x, y, r } = f;
    const s = `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${f.color}" stroke-width="${r * 0.5}" opacity="0.6" filter="url(#b6)"/><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${DARK}" stroke-width="${r * 0.28}"/><circle cx="${x - r * 0.3}" cy="${y - r * 0.3}" r="${r * 0.18}" fill="${mix(f.color, '#ffffff', 0.6)}"/>`;
    const p = r * 2.2; return { s, box: [x - p, y - p, 2 * p, 2 * p] };
  },
  // Funkengruppe (aufsteigende Glut)
  embers(f) {
    const rnd = rng(f.seed || 21), { x, y, r } = f; let s = '';
    for (let i = 0; i < (f.n || 7); i++) { const xx = x + (rnd() - 0.5) * r * 1.6, yy = y + (rnd() - 0.5) * r * 1.6, rr = 2 + rnd() * 3.5; s += `<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="${(rr * 2.6).toFixed(1)}" fill="${f.color}" opacity="0.55" filter="url(#b6)"/><circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="${rr.toFixed(1)}" fill="${mix(f.color, '#ffffff', 0.5)}"/>`; }
    const p = r * 1.3; return { s, box: [x - p, y - p, 2 * p, 2 * p] };
  },
};

async function renderFx(list, spec, name, dir = 'lay') {
  const pal = spec.pal, R = {};
  const d = defs(spec, pal, spec.cx || 1180, spec.cy || 455);
  for (const f of list) {
    const { s, box } = KINDS[f.kind](f, pal);
    const g = await out(s, d, box, f.res || 1, `${dir}/${name}_${f.name.replace(/!/g, '')}.png`);
    R[f.name] = g;
  }
  return R;
}
module.exports = { renderFx, KINDS };
