const { renderLayers, shared } = require('./layers');
const { renderFx } = require('./fx');
const { fxFor } = require('./motion');
const { jobs } = require('./jobs');
const fs = require('fs');
(async () => {
  const only = process.argv.slice(2);           // optional: nur bestimmte Szenen neu rendern
  const out = only.length && fs.existsSync('layers.json') ? JSON.parse(fs.readFileSync('layers.json')) : { scenes: {} };
  if (!only.length) out.shared = await shared();
  for (const [name, spec] of jobs) {
    if (only.length && !only.includes(name)) continue;
    const t = Date.now();
    const R = await renderLayers(spec, name);
    const fx = await renderFx(fxFor(name), spec, name);   // v3: Zusatzebenen (Speer, Rauch, Funken …)
    out.scenes[name] = { layers: R, fx, particles: spec.particles ? Object.entries(require('./data').PART).find(([k, v]) => v === spec.particles)[0] : null };
    console.log(name, Object.keys(R).join(','), '| fx:', Object.keys(fx).join(','), Date.now() - t, 'ms');
  }
  fs.writeFileSync('layers.json', JSON.stringify(out, null, 1));
})();
