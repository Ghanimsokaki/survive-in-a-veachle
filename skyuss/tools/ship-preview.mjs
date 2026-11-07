// Offline previews of the Enterprise mesh.
//
// Usage:
//   node skyuss/tools/ship-preview.mjs [--tiers 4,4,4,4] [--out shots/ship.png]
//                                      [--only pylon] [--colour]
//
import { Enterprise, buildEnterprise, MAX_TIER } from '../js/enterprise.js';
import { THREE, trianglesOf, shot } from './preview-lib.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const allTiers = [MAX_TIER, MAX_TIER, MAX_TIER, MAX_TIER];
const tiers = arg('tiers', null)
  ? arg('tiers').split(',').map((n) => Math.max(0, Math.min(MAX_TIER, parseInt(n, 10) || 0)))
  : allTiers;
const out = arg('out', 'shots/ship-preview.png');

const ship = new Enterprise({ saucer: tiers[0], nacelles: tiers[1], deflector: tiers[2], weapons: tiers[3] });
const mesh = buildEnterprise(THREE, ship);
const tris = trianglesOf(mesh, args.includes('--colour'), arg('only', null));

const meshes = (() => { let n = 0; mesh.traverse((o) => { if (o.isMesh) n++; }); return n; })();
const parts = Object.fromEntries(Object.entries(mesh.userData.parts).map(([k, val]) =>
  [k, Array.isArray(val) ? val.length : val ? 1 : 0]));

const panels = [
  { title: 'three-quarter bow', sub: 'tier ' + tiers.join('/'), tris, yaw: 0.72, elev: 0.34, dist: 40 },
  { title: 'three-quarter stern', sub: 'nacelle + impulse detail', tris, yaw: 2.45, elev: 0.4, dist: 40 },
  { title: 'side elevation', sub: 'hull profile', tris, yaw: Math.PI / 2, elev: 0.03, dist: 42 },
  { title: 'plan view', sub: 'saucer + pylon sweep', tris, yaw: 0.001, elev: 1.35, dist: 44 },
];
const res = shot(out, panels);
console.log(JSON.stringify({ triangles: tris.length, meshes, tiers, parts, out: res.path }, null, 2));
