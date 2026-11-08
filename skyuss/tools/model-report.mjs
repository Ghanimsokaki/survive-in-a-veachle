// Read a 3D model's *internal structure* and try to work out what ship it is.
//
//   node skyuss/tools/model-report.mjs --in model.obj
//   node skyuss/tools/model-report.mjs --in ship.glb --length 641
//   node skyuss/tools/model-report.mjs --in model.obj --json
//
// What it reads, without any 3D package:
//   OBJ — object/group/smoothing/material names, per-object triangle counts and
//         bounding boxes, UV/material usage, overall dimensions and facing.
//   GLB — node/mesh/material names from the glTF JSON chunk, per-node counts and
//         the accessor min/max boxes (no geometry decode needed).
//
// .blend and .fbx are *not* supported: .blend is Blender's own undocumented binary
// format and .fbx needs a converter; export an OBJ or GLB from Blender first.
//
// The class matcher compares the model's dimensions with skyuss/data/ship-classes.json
// and reports the closest hulls with a percentage error, plus everything it can
// infer (scale, aspect, which axis the nose points down).
import fs from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const DB_PATH = join(here, '..', 'data', 'ship-classes.json');

const r3 = (v) => Math.round(v * 1000) / 1000;

function boxOf(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((v) => (Number.isFinite(v) ? v : 0));
  return { min, max, size };
}

/** Parse an OBJ and collect its internal architecture. */
export function structureOBJ(text) {
  const verts = [];
  const objects = new Map();          // name -> { tris, materials:Set, verts:Set }
  const materials = new Set();
  let current = '(unnamed)';
  let smoothing = new Set();
  let hasUV = 0;
  let hasNormals = 0;
  let groupCount = 0;
  const lines = text.split(/\r?\n/);
  const bump = (name) => {
    if (!objects.has(name)) objects.set(name, { tris: 0, materials: new Set(), verts: new Set() });
    return objects.get(name);
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      verts.push([Number(p[1]) || 0, Number(p[2]) || 0, Number(p[3]) || 0]);
    } else if (line.startsWith('vt ')) {
      hasUV++;
    } else if (line.startsWith('vn ')) {
      hasNormals++;
    } else if (line.startsWith('o ') || line.startsWith('g ')) {
      current = raw.trim().split(/\s+/).slice(1).join(' ') || '(unnamed)';
      groupCount++;
      bump(current);
    } else if (line.startsWith('usemtl ') || line.startsWith('usemtl')) {
      const name = raw.trim().split(/\s+/)[1] || '(none)';
      materials.add(name);
      bump(current).materials.add(name);
    } else if (line.startsWith('s ')) {
      smoothing.add(raw.trim().slice(2));
    } else if (line.startsWith('f ')) {
      const parts = line.split(/\s+/).slice(1);
      const idx = [];
      for (const tok of parts) {
        const n = parseInt(tok.split('/')[0], 10);
        if (Number.isFinite(n) && n !== 0) idx.push(n < 0 ? verts.length + n : n - 1);
      }
      if (idx.length < 3) continue;
      const o = bump(current);
      o.tris += idx.length - 2;                 // fan triangulation
      for (const i of idx) o.verts.add(i);
    }
  }

  const objs = [...objects.entries()]
    .map(([name, o]) => {
      const pts = [...o.verts].map((i) => verts[i]).filter(Boolean);
      const box = pts.length ? boxOf(pts) : { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
      return {
        name,
        triangles: o.tris,
        vertices: o.verts.size,
        materials: [...o.materials],
        size: box.size.map(r3),
      };
    })
    .filter((o) => o.triangles > 0)
    .sort((a, b) => b.triangles - a.triangles);

  const overall = boxOf(verts);
  return {
    format: 'obj',
    counts: {
      vertices: verts.length, triangles: objs.reduce((a, o) => a + o.triangles, 0),
      objects: objs.length, groups: groupCount, materials: materials.size,
      uvs: hasUV, normals: hasNormals, smoothingGroups: smoothing.size,
    },
    materials: [...materials],
    objects: objs,
    size: overall.size.map(r3),
  };
}

/** Parse a GLB's JSON chunk: names, node tree, per-mesh counts and accessor boxes. */
export function structureGLB(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return null;   // 'glTF'
  const version = buf.readUInt32LE(4);
  let offset = 12;
  let json = null;
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));      // 'JSON'
    offset += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) return null;

  const accessors = json.accessors || [];
  const meshes = json.meshes || [];
  const nodes = json.nodes || [];
  const materials = (json.materials || []).map((m) => m.name || '(unnamed)');

  const objects = [];
  meshes.forEach((m, mi) => {
    let tris = 0;
    let verts = 0;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const prim of m.primitives || []) {
      const posAcc = prim.attributes && prim.attributes.POSITION !== undefined ? accessors[prim.attributes.POSITION] : null;
      if (posAcc && posAcc.min && posAcc.max) {
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], posAcc.min[i]);
          max[i] = Math.max(max[i], posAcc.max[i]);
        }
        verts += posAcc.count || 0;
      }
      if (prim.indices !== undefined && accessors[prim.indices]) tris += Math.floor((accessors[prim.indices].count || 0) / 3);
      else if (posAcc) tris += Math.floor((posAcc.count || 0) / 3);
    }
    objects.push({
      name: m.name || `mesh_${mi}`,
      triangles: tris,
      vertices: verts,
      materials: [...new Set((m.primitives || []).map((p) => (p.material !== undefined ? materials[p.material] : '(none)')))],
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((v) => (Number.isFinite(v) ? r3(v) : 0)),
    });
  });
  objects.sort((a, b) => b.triangles - a.triangles);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const o of objects) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], -o.size[i] / 2);
      max[i] = Math.max(max[i], o.size[i] / 2);
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((v) => (Number.isFinite(v) ? r3(v) : 0));

  return {
    format: 'glb',
    gltfVersion: version,
    generator: (json.asset && json.asset.generator) || null,
    counts: {
      vertices: objects.reduce((a, o) => a + o.vertices, 0),
      triangles: objects.reduce((a, o) => a + o.triangles, 0),
      objects: objects.length,
      nodes: nodes.length,
      materials: materials.length,
      uvs: (json.meshes || []).some((m) => (m.primitives || []).some((p) => p.attributes && p.attributes.TEXCOORD_0 !== undefined)) ? 1 : 0,
      normals: (json.meshes || []).some((m) => (m.primitives || []).some((p) => p.attributes && p.attributes.NORMAL !== undefined)) ? 1 : 0,
    },
    materials,
    nodeNames: nodes.map((n) => n.name).filter(Boolean).slice(0, 40),
    objects,
    size,
  };
}

/** Describe the orientation and proportions of a hull from its bounding box. */
export function shapeOf(size) {
  const [x, y, z] = size;
  const longest = Math.max(x, y, z);
  const axis = x === longest ? 'x' : z === longest ? 'z' : 'y';
  return {
    longestAxis: axis,
    spanToLength: longest ? r3((axis === 'x' ? z : x) / longest) : 0,
    heightToLength: longest ? r3(y / longest) : 0,
    flatness: longest ? r3(y / longest) : 0,
    note: axis === 'z'
      ? 'longest axis is Z — the game flies along +Z, so this needs no rotation'
      : axis === 'x'
        ? 'longest axis is X — the loader would fit the span; rotate it to face +Z'
        : 'longest axis is Y — this looks like an upright model, not a hull',
  };
}

/** Score every hull in the database against measured dimensions. */
export function matchClasses(size, db, opts = {}) {
  const hulls = (db && db.hulls) || [];
  const [x, y, z] = size;
  const longest = Math.max(x, y, z);
  const second = [x, y, z].filter((v) => v !== longest).sort((a, b) => b - a)[0] || 0;
  const scale = opts.length ? opts.length / longest : 1;   // model units → metres
  const measured = { length: longest * scale, span: second * scale, height: Math.min(x, y, z) * scale };
  // Ratios travel without a scale, so they are the honest signal on an export whose
  // units are unknown. Lengths only score once --length says what scale it is.
  const ratios = { span: measured.span / measured.length, height: measured.height / measured.length };
  const mode = opts.length ? 'dimensions' : 'proportions';

  const matches = hulls.map((h) => {
    const dbRatios = { span: h.span ? h.span / h.length : null, height: h.height ? h.height / h.length : null };
    const errSpanRatio = dbRatios.span === null ? null : Math.abs(dbRatios.span - ratios.span) / Math.max(0.05, dbRatios.span);
    const errHRatio = dbRatios.height === null ? null : Math.abs(dbRatios.height - ratios.height) / Math.max(0.05, dbRatios.height);
    const errLen = mode === 'dimensions' ? Math.abs(h.length - measured.length) / h.length : null;
    const parts = mode === 'dimensions'
      ? [errLen, errSpanRatio, errHRatio]
      : [errSpanRatio, errHRatio];
    const clean = parts.filter((v) => v !== null);
    const err = clean.length ? clean.reduce((a, v) => a + v, 0) / clean.length : 1;
    return {
      name: h.name,
      era: h.era || '',
      dbLength: h.length,
      lengthError: errLen === null ? null : Math.round(errLen * 1000) / 10,
      spanRatioError: errSpanRatio === null ? null : Math.round(errSpanRatio * 1000) / 10,
      score: Math.round(Math.max(0, 1 - err) * 1000) / 10,
    };
  }).sort((a, b) => b.score - a.score).slice(0, opts.top || 4);
  return {
    mode,
    unitsAssumedMetres: mode === 'dimensions',
    scaleApplied: r3(scale),
    measured,
    ratios: { span: r3(ratios.span), height: r3(ratios.height) },
    matches,
  };
}

/** Human-readable report. */
export function formatReport(file, structure, match) {
  const out = [];
  const c = structure.counts;
  out.push(`model ── ${basename(file)}  (${structure.format.toUpperCase()})`);
  if (structure.generator) out.push(`  generated by        ${structure.generator}`);
  out.push(`  geometry            ${c.triangles.toLocaleString()} tris · ${c.vertices.toLocaleString()} verts`);
  out.push(`  internal objects    ${c.objects}` + (c.groups ? ` · ${c.groups} o/g groups` : '') + (c.nodes ? ` · ${c.nodes} glTF nodes` : ''));
  out.push(`  materials           ${c.materials}` + (structure.materials || []).slice(0, 8).map((m) => ` "${m}"`).join(''));
  out.push(`  attributes          ${c.uvs ? 'UVs' : 'no UVs'} · ${c.normals ? 'normals' : 'no normals'}` +
    (c.smoothingGroups ? ` · ${c.smoothingGroups} smoothing groups` : ''));
  const [x, y, z] = structure.size;
  out.push(`  bounding box        ${x} × ${y} × ${z} units`);
  if ((structure.objects || []).length) {
    out.push('  architecture:');
    for (const o of structure.objects.slice(0, 12)) {
      out.push(`    ${o.name.padEnd(22).slice(0, 22)} ${String(o.triangles).padStart(7)} tris  ${o.size.join(' × ')}` +
        (o.materials.length ? `  [${o.materials.join(', ')}]` : ''));
    }
    if (structure.objects.length > 12) out.push(`    … ${structure.objects.length - 12} more`);
  }
  if ((structure.nodeNames || []).length) {
    out.push(`  node names          ${structure.nodeNames.slice(0, 12).join(', ')}${structure.nodeNames.length > 12 ? ' …' : ''}`);
  }
  const shape = shapeOf(structure.size);
  out.push(`  orientation         longest axis ${shape.longestAxis.toUpperCase()} — ${shape.note}`);
  out.push(`  proportions         span/length ${shape.spanToLength}, height/length ${shape.heightToLength}`);

  out.push('');
  out.push('class match ── ' + (match.mode === 'dimensions'
    ? 'scaled against skyuss/data/ship-classes.json'
    : 'proportions against skyuss/data/ship-classes.json (no --length given, so scale is ignored)'));
  const m = match.measured;
  out.push(`  measured            length ${r3(m.length)} · span ${r3(m.span)} · height ${r3(m.height)} units`);
  if (match.ratios) out.push(`  proportions         span/length ${match.ratios.span} · height/length ${match.ratios.height}`);
  if (!match.matches.length) {
    out.push(`  ${match.note || 'no candidate hulls'}`);
    return out.join('\n');
  }
  for (const cand of match.matches) {
    const extra = cand.lengthError === null
      ? `span ratio off ${cand.spanRatioError}%`
      : `length ${cand.dbLength} m · off ${cand.lengthError}%`;
    out.push(`  ${String(cand.score).padStart(5)}%  ${cand.name.padEnd(42)} ${extra}`);
  }
  if (match.mode === 'proportions') {
    out.push('  pass --length <metres> once you know the scale and it will score sizes instead');
  }
  out.push('');
  out.push('  The score is a dimension fit, not a promise: a fan redesign at the wrong scale');
  out.push('  will still land next to its class. Names inside the file (objects, materials,');
  out.push('  node names above) are the stronger evidence when they exist.');
  return out.join('\n');
}

/** Read a file and produce { structure, match, report }. */
export function reportFile(path, opts = {}) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const db = JSON.parse(fs.readFileSync(opts.db || DB_PATH, 'utf8'));
  let structure = null;
  if (ext === 'obj') structure = structureOBJ(fs.readFileSync(path, 'utf8'));
  else if (ext === 'glb') structure = structureGLB(fs.readFileSync(path));
  else if (ext === 'gltf') {
    const json = JSON.parse(fs.readFileSync(path, 'utf8'));
    structure = structureGLB(Buffer.concat([
      Buffer.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]),
      (() => { const b = Buffer.alloc(8); b.writeUInt32LE(0, 0); return b; })(),
    ])) || null;
    if (!structure) {
      structure = {
        format: 'gltf',
        generator: (json.asset && json.asset.generator) || null,
        counts: { vertices: 0, triangles: 0, objects: (json.meshes || []).length, nodes: (json.nodes || []).length, materials: (json.materials || []).length, uvs: 0, normals: 0 },
        materials: (json.materials || []).map((x) => x.name || '(unnamed)'),
        objects: (json.meshes || []).map((mm) => ({ name: mm.name || '(unnamed)', triangles: 0, vertices: 0, materials: [], size: [0, 0, 0] })),
        size: [0, 0, 0],
      };
    }
  } else {
    const hint = ext === 'blend' ? '.blend is Blender\'s own binary format — export OBJ/GLB from Blender'
      : ext === 'fbx' ? '.fbx needs a converter — export OBJ/GLB from Blender (or run FBX Converter / Blender CLI)'
        : `unsupported extension .${ext}`;
    throw new Error(hint);
  }
  if (!structure) throw new Error('could not read that file as ' + ext);
  let match;
  if (!structure.counts.triangles && ext === 'gltf') {
    match = { unitsAssumedMetres: false, measured: { length: 0, span: 0, height: 0 }, matches: [], note: 'a .gltf keeps its geometry in a separate .bin — pass the .glb instead' };
  } else {
    match = matchClasses(structure.size, db, { length: opts.length });
  }
  return { structure, match, report: formatReport(path, structure, match) };
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name, def) => {
    const i = args.indexOf('--' + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
  };
  const file = arg('in', null);
  if (!file) {
    console.error('usage: node skyuss/tools/model-report.mjs --in <model.obj|model.glb> [--length <metres>] [--json]');
    console.error('       (.blend and .fbx must be exported to OBJ or GLB first)');
    process.exit(2);
  }
  const src = resolve(file.replace(/^~(?=$|\/)/, process.env.HOME || '~'));
  if (!fs.existsSync(src)) {
    console.error('no such file: ' + src);
    process.exit(2);
  }
  try {
    const lengthArg = arg('length', null);
    const res = reportFile(src, { length: lengthArg ? Number(lengthArg) : null });
    if (args.includes('--json')) console.log(JSON.stringify(res, null, 2));
    else console.log(res.report);
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(1);
  }
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) main();
