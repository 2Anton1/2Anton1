const { M, P, PART } = require('./data');
const jobs = [];
// v3: Lage-Korrekturen für animierte Werkzeuge (Textzone x<1181 & y>706 frei halten, Platz für Bewegung)
const PATCH = {
  m02a: { cx: 1380 },                 // Lagerfeuer: Scheite ragten in die Textzone
  m03a: { cx: 960, iconCut: 'spear' }, // Jäger links, Speer als eigene Ebene
  m03b: { cx: 1560, cy: 505 },        // Mammut rechts: Ziel des Speers
  m11a: { cx: 1380 },                 // Karavelle: Rumpf ragte in die Textzone
  m19b: { cy: 370 },                  // Pilzwolke: Fuß oberhalb der Textzone
  m20b: { iconKeep: 'arm' },          // Roboterarm: Icon = beweglicher Arm, Rest als Zusatzebene 'iconBase'
};
// intro
jobs.push(['intro', { pal: { top: '#000003', mid: '#05051a', hor: '#2a1a2e', glow: '#ffb35c' }, terrain: 'savanna', stars: 900, milky: true, glowOp: 0.18, cx: 1500, cy: 760, seed: 3, particles: PART.dust }]);
M.forEach((m, i) => {
  const base = { seed: i * 101 + 7, terrainSeed: i * 101 + 7, progress: [i, M.length] };
  const ka = `m${String(i + 1).padStart(2, '0')}a`, kb = `m${String(i + 1).padStart(2, '0')}b`;
  jobs.push([ka, { ...base, ...m.L, accent: m.L.pal.glow, ...(PATCH[ka] || {}) }]);
  jobs.push([kb, { ...base, terrain: m.L.terrain, ...m.S, seed: i * 101 + 13, accent: '#ff5a4e', ...(PATCH[kb] || {}) }]);
});
// outro
const fut = { top: '#03041a', mid: '#141a46', hor: '#e3a46a', glow: '#ffd9a0' };
jobs.push(['o1', { pal: fut, terrain: 'lowcity', grid: true, seed: 901, terrainSeed: 901, stars: 500, disc: { x: 1180, y: 740, r: 300, c: '#ffd9a0', inner: '#fff6e6' }, glowOp: 0.6, cx: 1180, cy: 700, particles: PART.data, rays: true }]);
jobs.push(['o2', { pal: { ...P.crimson, hor: '#7a1c22' }, terrain: 'lowcity', grid: true, seed: 902, terrainSeed: 901, stars: 300, disc: { x: 1180, y: 740, r: 300, c: '#e8402a', inner: '#ff9a6a' }, glowOp: 0.6, cx: 1180, cy: 700, smokeBank: '#1a0606', particles: PART.ash }]);
jobs.push(['o3', { pal: { top: '#020208', mid: '#121430', hor: '#3a2e44', glow: '#ffe2b0' }, splitSky: ['#e09a4a', '#3a6aff'], terrain: 'savanna', seed: 903, terrainSeed: 7, stars: 600, milky: true, icon: 'GiOpenPalm', cx: 1150, cy: 560, size: 560, glowOp: 0.35, noIconGlow: false, orb: { x: 1240, y: 420, r: 20, c: '#ffd9a0' }, particles: PART.dust }]);
jobs.push(['o4', { pal: { top: '#000000', mid: '#000002', hor: '#04040a', glow: '#000000' }, terrain: 'savanna', seed: 904, terrainSeed: 3, stars: 500, noGlow: true }]);
module.exports = { jobs };
