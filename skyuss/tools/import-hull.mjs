// Import a hull the player owns into the drop folder, ready for the shipyard.
//
// The game only ships a dependency-free OBJ reader, so this tool takes an OBJ.
// If your file is .blend / .fbx / .glb, export it from Blender first:
//   File ▸ Export ▸ Wavefront (.obj)   — "Selection only" + "Apply modifiers"
//
// Usage:
//   node skyuss/tools/import-hull.mjs --in ~/Downloads/dispatcher.obj --hull aurora
//   node skyuss/tools/import-hull.mjs --in model.obj --hull kang --name kang.obj
//   node skyuss/tools/import-hull.mjs --in model.obj --hull kang --preview shots/kang.png
//
// It validates the mesh (triangles, UVs, bounding box), copies it to
// skyuss/assets/premium/<name>.obj — a git-ignored folder — and prints what the
// game will do next.
import fs from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOBJ, PREMIUM_FILES, HULL_MODELS } from '../js/premium.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const src = arg('in', null);
const hull = arg('hull', 'aurora');
if (!src) {
  console.error('usage: node skyuss/tools/import-hull.mjs --in <model.obj> [--hull aurora|kang] [--name file.obj] [--preview out.png]');
  process.exit(2);
}
const srcPath = resolve(src.replace(/^~(?=$|\/)/, process.env.HOME || '~'));
if (!fs.existsSync(srcPath)) {
  console.error('no such file: ' + srcPath);
  process.exit(2);
}
if (!/\.obj$/i.test(srcPath)) {
  console.error(`this reader only understands OBJ, got ${basename(srcPath)}`);
  console.error('in Blender: File ▸ Export ▸ Wavefront (.obj), then run this again');
  process.exit(2);
}

const raw = fs.readFileSync(srcPath, 'utf8');
const data = parseOBJ(raw);
if (!data) {
  console.error('that OBJ has no faces the reader could use (empty export?)');
  process.exit(2);
}

// bounding box straight off the parsed corners
let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (let i = 0; i < data.positions.length; i += 3) {
  const x = data.positions[i], y = data.positions[i + 1], z = data.positions[i + 2];
  minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
}
const size = { x: +(maxX - minX).toFixed(2), y: +(maxY - minY).toFixed(2), z: +(maxZ - minZ).toFixed(2) };
const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.z >= size.y ? 'z' : 'y';

const wanted = (PREMIUM_FILES[hull] || PREMIUM_FILES.aurora)[0];
const outName = arg('name', basename(wanted));
const outDir = join(root, 'skyuss', 'assets', 'premium');
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(srcPath, join(outDir, outName));

const model = HULL_MODELS[hull] || {};
console.log(JSON.stringify({
  imported: join('skyuss/assets/premium', outName),
  hull,
  triangles: data.triangles,
  vertices: data.vertices,
  uvs: data.uvCount,
  textured: !!data.uvs,
  sizeUnits: size,
  longestAxis: axis,
  fittedLengthMetres: model.length || 30,
  note: axis === 'z'
    ? 'longest axis is Z — matches the flight axis, no rotation needed'
    : `longest axis is ${axis.toUpperCase()}: the loader fits that axis to the hull length, so check the preview points nose-first`,
}, null, 2));

if (!data.uvs) {
  console.log('\nwarning: no UVs in this OBJ — the hull will render in a flat colour.');
}

const preview = arg('preview', null);
if (preview) {
  console.log('\nrender a preview with:\n  node skyuss/tools/hull-preview.mjs --obj ' +
    join('skyuss/assets/premium', outName) + ' --out ' + preview);
}
console.log('\nnext: reload the game, open the shipyard (Y) and buy/fly that hull.');
