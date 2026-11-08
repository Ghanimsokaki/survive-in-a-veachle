// Offline previews of the sky world: islands, derelicts and ion storms.
//
//   node skyuss/tools/world-preview.mjs [--seed 20261107] [--out shots/world.png]
//                                       [--only island|derelict|storm]
//
import { buildIsland, buildDerelict, buildStorm, generateCell, WorldStream } from '../js/world.js';
import { THREE, trianglesOf, shot, v3 } from './preview-lib.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const seed = Number(arg('seed', 20261107));
const out = arg('out', 'shots/world-preview.png');
const only = arg('only', null);

// pick a few representative pieces, deterministically
const stream = new WorldStream(seed, 2);
const view = stream.update({ x: 0, y: 0, z: 0 });
const firstOf = (kind) => view.islands.find((i) => i.kind === kind);
const island = firstOf('plateau') || view.islands[0];
const spire = firstOf('spire') || view.islands[1];
const rock = firstOf('rock') || view.islands[2];
const derelict = view.derelicts[0] || generateCell(seed, 1, 1).derelicts[0];
const storm = view.storms[0] || generateCell(seed, 2, -2).storms[0] || { x: 0, z: 0, y: 0, r: 90, phase: 1.1, seed: 7 };

const tree = {
  island: () => buildIsland(THREE, island),
  spire: () => buildIsland(THREE, spire),
  rock: () => buildIsland(THREE, rock),
  derelict: () => buildDerelict(THREE, derelict),
  storm: () => buildStorm(THREE, storm),
};

const want = only && tree[only] ? [only] : ['island', 'rock', 'derelict', 'storm'];
const panels = [];
for (const key of want) {
  const obj = tree[key]();
  obj.position.set(0, 0, 0);
  obj.rotation.set(0.12, 0.4, 0);
  const r = key === 'storm' ? storm.r : key === 'derelict' ? 12 : island.r;
  panels.push({
    title: key,
    sub: `${key === 'storm' ? storm.r.toFixed(0) + ' m radius' : r.toFixed(0) + ' m across'} · ${(obj.children.length)} meshes`,
    tris: trianglesOf(obj),
    yaw: 0.85, elev: 0.34, dist: r * (key === 'derelict' ? 3.2 : 4.6), focusY: 0,
  });
}
const res = shot(out, panels.slice(0, 4));
console.log(JSON.stringify({
  out: res.path,
  panels: panels.slice(0, 4).map((p) => ({ title: p.title, tris: p.tris.length })),
}, null, 2));
