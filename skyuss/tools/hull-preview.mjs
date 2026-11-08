// Offline preview of a loaded hull (the CC0 courier, or a bought model).
//
// The painter's-algorithm rasteriser in preview-lib has no texture sampling, so
// this bakes the model's palette texture into vertex colours (sampled at each
// vertex's UV) and then renders it exactly like the rest of the previews.
//
// Usage:
//   node skyuss/tools/hull-preview.mjs [--hull aurora] [--out shots/aurora-class.png]
//                                      [--obj path/to/file.obj] [--tex path/to/texture.jpg]
//
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { THREE, trianglesOf, shot } from './preview-lib.mjs';
import { parseOBJ, objMesh, HULL_MODELS } from '../js/premium.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const hullId = arg('hull', 'aurora');
const model = HULL_MODELS[hullId] || HULL_MODELS.aurora;
const objPath = arg('obj', join(root, 'skyuss', model.url));
const texPath = arg('tex', join(root, 'skyuss', model.texture));
const out = arg('out', 'shots/hull-preview.png');

const data = parseOBJ(fs.readFileSync(objPath, 'utf8'));
if (!data) throw new Error('could not parse ' + objPath);
const mesh = objMesh(THREE, data, {});

// fit exactly like the game: longest axis -> model.length, centred
const length = model.length || 30;
let box = new THREE.Box3().setFromObject(mesh);
let size = box.getSize(new THREE.Vector3());
mesh.scale.setScalar(length / Math.max(size.x, size.y, size.z));
box = new THREE.Box3().setFromObject(mesh);
mesh.position.sub(box.getCenter(new THREE.Vector3()));
size = box.getSize(new THREE.Vector3());

// bake the texture into vertex colours for the flat rasteriser
let textured = false;
if (fs.existsSync(texPath)) {
  const img = await loadImage(texPath);
  const S = 512;
  const cv = createCanvas(S, S);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, S, S);
  const px = ctx.getImageData(0, 0, S, S).data;
  const pos = mesh.geometry.attributes.position;
  const uv = mesh.geometry.attributes.uv;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const u = uv ? uv.getX(i) : 0.5;
    const v = uv ? uv.getY(i) : 0.5;
    const x = Math.min(S - 1, Math.max(0, Math.round(u * (S - 1))));
    const y = Math.min(S - 1, Math.max(0, Math.round((1 - v) * (S - 1))));
    const o = (y * S + x) * 4;
    col[i * 3] = px[o] / 255;
    col[i * 3 + 1] = px[o + 1] / 255;
    col[i * 3 + 2] = px[o + 2] / 255;
  }
  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  mesh.material.vertexColors = true;
  mesh.material.color.set('#ffffff');
  textured = true;
}

const tris = trianglesOf(mesh, false);
const sub = `${model.name} · ${data.triangles} tris · ${textured ? 'textured' : 'no texture'}`;
const panels = [
  { title: 'bow three-quarter', sub, tris, yaw: 0.8, elev: 0.34, dist: 34 },
  { title: 'stern three-quarter', sub, tris, yaw: 0.8 + Math.PI, elev: 0.4, dist: 34 },
  { title: 'side elevation', sub: `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} m`, tris, yaw: Math.PI / 2, elev: 0.06, dist: 33 },
  { title: 'plan view', sub: 'nose at +Z (the flight axis)', tris, yaw: 0.001, elev: 1.28, dist: 33 },
];
const res = shot(out, panels);
console.log(JSON.stringify({
  hull: hullId, model: model.name, credit: model.credit,
  triangles: data.triangles, vertices: data.vertices, uvs: data.uvCount, textured,
  size: { x: +size.x.toFixed(1), y: +size.y.toFixed(1), z: +size.z.toFixed(1) },
  out: res.path,
}, null, 2));
