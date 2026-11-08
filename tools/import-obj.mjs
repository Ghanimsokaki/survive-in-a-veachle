// Convert a Kenney OBJ + its colour-map atlas into flat-shaded faces this
// software renderer can draw.
//
//   node tools/import-obj.mjs
//
// Kenney's kits ship one material whose texture is a palette atlas; every face
// carries UVs into it. We sample the atlas once per face and bake the colour
// into the face, so the game needs no textures at runtime.
//
// Source: Kenney "Holiday Kit 2.0" (www.kenney.nl), CC0 1.0 — see
// assets/models/kenney/License.txt. Re-run this script to regenerate the
// generated modules after editing the normalisation numbers.
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const SRC = new URL('../assets/models/kenney/', import.meta.url);
const OUT = new URL('../js/models/', import.meta.url);

const JOBS = [
  // The kit also ships train-wagon.obj (closed carriage) and
  // train-wagon-flat.obj (open flatbed). Drop them into
  // assets/models/kenney/ and add a job here to use them.
  {
    obj: 'train-locomotive.obj', out: 'locomotive.js', name: 'LOCOMOTIVE_MESH',
    size: { len: 4.6, width: 2.6, height: 3.9 },
    minArea: 0.00004,
  },
];

function parseObj(text) {
  const verts = [];
  const uvs = [];
  const faces = [];
  let useMtl = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const sp = line.split(/\s+/);
    if (sp[0] === 'v') verts.push([+sp[1], +sp[2], +sp[3]]);
    else if (sp[0] === 'vt') uvs.push([+sp[1], +sp[2]]);
    else if (sp[0] === 'usemtl') useMtl = sp[1];
    else if (sp[0] === 'f') {
      const vs = [], ts = [];
      for (let i = 1; i < sp.length; i++) {
        const parts = sp[i].split('/');
        vs.push(verts[parseInt(parts[0], 10) - 1]);
        if (parts[1]) ts.push(uvs[parseInt(parts[1], 10) - 1]);
      }
      // triangulate (fan) — Kenney exports quads and triangles
      const ids = sp.slice(1).map((p2) => parseInt(p2.split('/')[0], 10) - 1);
      for (let i = 1; i + 1 < vs.length; i++) {
        faces.push({
          v: [vs[0], vs[i], vs[i + 1]],
          ids: [ids[0], ids[i], ids[i + 1]],
          t: ts.length === vs.length ? [ts[0], ts[i], ts[i + 1]] : null,
          mtl: useMtl,
        });
      }
    }
  }
  return { verts, uvs, faces };
}

// Two coplanar triangles that share an edge are one quad. Merging them roughly
// halves the face count the software renderer has to sort and fill, which is
// the difference between "+21% frame time" and "+10%".
function mergeQuads(faces, keyOf, colourOf) {
  const buckets = new Map();
  faces.forEach((f, i) => {
    const k = keyOf(f);
    if (!k) return;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  });
  const used = new Array(faces.length).fill(false);
  const out = [];
  for (const idxs of buckets.values()) {
    for (let a = 0; a < idxs.length; a++) {
      const ia = idxs[a];
      if (used[ia]) continue;
      const ta = faces[ia];
      let merged = null;
      for (let b = a + 1; b < idxs.length && !merged; b++) {
        const ib = idxs[b];
        if (used[ib]) continue;
        const tb = faces[ib];
        // find the two shared vertices
        const sharedA = [], onlyA = [], onlyB = [];
        for (let k = 0; k < 3; k++) {
          const v = ta.ids[k];
          if (tb.ids.includes(v)) sharedA.push(v); else onlyA.push(v);
        }
        for (let k = 0; k < 3; k++) {
          const v = tb.ids[k];
          if (!ta.ids.includes(v)) onlyB.push(v);
        }
        if (sharedA.length !== 2 || onlyA.length !== 1 || onlyB.length !== 1) continue;
        // opposite winding on the shared edge keeps the normal consistent
        const ea = ta.ids.indexOf(sharedA[0]);
        const ea2 = ta.ids.indexOf(sharedA[1]);
        const eb = tb.ids.indexOf(sharedA[0]);
        const eb2 = tb.ids.indexOf(sharedA[1]);
        const sameDir = (ea + 1) % 3 === ea2 && (eb + 1) % 3 === eb2;
        if (sameDir) continue;
        const order = [onlyA[0], sharedA[0], onlyB[0], sharedA[1]];
        const byId = new Map();
        ta.ids.forEach((id, k) => byId.set(id, ta.v[k]));
        tb.ids.forEach((id, k) => byId.set(id, tb.v[k]));
        merged = {
          v: order.map((id) => byId.get(id)), ids: order, t: null, mtl: ta.mtl,
          colour: colourOf ? colourOf(ta) : null,
        };
        used[ib] = true;
      }
      out.push(merged || ta);
      used[ia] = true;
    }
  }
  return out;
}

function bounds(verts) {
  const b = { x0: 1e9, y0: 1e9, z0: 1e9, x1: -1e9, y1: -1e9, z1: -1e9 };
  for (const v of verts) {
    b.x0 = Math.min(b.x0, v[0]); b.x1 = Math.max(b.x1, v[0]);
    b.y0 = Math.min(b.y0, v[1]); b.y1 = Math.max(b.y1, v[1]);
    b.z0 = Math.min(b.z0, v[2]); b.z1 = Math.max(b.z1, v[2]);
  }
  return b;
}

const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v)))
  .toString(16).padStart(2, '0')).join('');

async function main() {
  const img = await loadImage(new URL('colormap.png', SRC));
  const cv = createCanvas(img.width, img.height);
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, img.width, img.height).data;
  const sample = (u, v) => {
    // OBJ UV origin is bottom-left, image data is top-left
    const x = Math.max(0, Math.min(img.width - 1, Math.round(u * (img.width - 1))));
    const y = Math.max(0, Math.min(img.height - 1, Math.round((1 - v) * (img.height - 1))));
    const i = (y * img.width + x) * 4;
    return hex(px[i], px[i + 1], px[i + 2]);
  };

  fs.mkdirSync(OUT, { recursive: true });
  const report = [];
  for (const job of JOBS) {
    const text = fs.readFileSync(new URL(job.obj, SRC), 'utf8');
    const { verts, faces } = parseObj(text);
    const b = bounds(verts);
    const srcLen = Math.max(b.x1 - b.x0, b.z1 - b.z0);
    const srcWidth = Math.min(b.x1 - b.x0, b.z1 - b.z0);
    const scale = job.size.len / srcLen;
    const alongX = (b.x1 - b.x0) >= (b.z1 - b.z0);

    // centre on x/z, drop onto y = 0, scale to the car
    const cxs = (b.x0 + b.x1) / 2, czs = (b.z0 + b.z1) / 2;
    const map = (v) => {
      let x = v[0] - cxs, z = v[2] - czs;
      if (!alongX) [x, z] = [z, -x];          // longest side ends up along +x
      return [x * scale, (v[1] - b.y0) * scale, z * scale];
    };

    const qkey = (f) => {
      if (!f.t) return null;
      const p0 = f.v.map(map);
      const ax = p0[1][0] - p0[0][0], ay = p0[1][1] - p0[0][1], az = p0[1][2] - p0[0][2];
      const bx = p0[2][0] - p0[0][0], by = p0[2][1] - p0[0][1], bz = p0[2][2] - p0[0][2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const d = nx * p0[0][0] + ny * p0[0][1] + nz * p0[0][2];
      const u = (f.t[0][0] + f.t[1][0] + f.t[2][0]) / 3;
      const v = (f.t[0][1] + f.t[1][1] + f.t[2][1]) / 3;
      return `${nx.toFixed(2)}|${ny.toFixed(2)}|${nz.toFixed(2)}|${d.toFixed(2)}|${sample(u, v)}`;
    };
    const merged = mergeQuads(faces, qkey, (f) => {
      const u = (f.t[0][0] + f.t[1][0] + f.t[2][0]) / 3;
      const v = (f.t[0][1] + f.t[1][1] + f.t[2][1]) / 3;
      return sample(u, v);
    });
    const keep = [];
    let dropped = 0;
    for (const f of merged) {
      const p = f.v.map(map);
      const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
      const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const area = 0.5 * Math.hypot(nx, ny, nz);
      if (area < job.minArea) { dropped++; continue; }
      let colour = f.colour || '#8a8a8a';
      if (!f.colour && f.t) {
        const u = (f.t[0][0] + f.t[1][0] + f.t[2][0]) / 3;
        const v = (f.t[0][1] + f.t[1][1] + f.t[2][1]) / 3;
        colour = sample(u, v);
      }
      keep.push({ p, colour });
    }

    const dims = {
      len: (Math.max(...keep.map((f) => Math.max(...f.p.map((q) => q[0])))) -
        Math.min(...keep.map((f) => Math.min(...f.p.map((q) => q[0]))))).toFixed(2),
      width: (Math.max(...keep.map((f) => Math.max(...f.p.map((q) => q[2])))) -
        Math.min(...keep.map((f) => Math.min(...f.p.map((q) => q[2]))))).toFixed(2),
      height: (Math.max(...keep.map((f) => Math.max(...f.p.map((q) => q[1]))))
      ).toFixed(2),
    };

    const body = keep.map((f) => {
      const tri = f.p.map((q) => `[${q.map((n) => +n.toFixed(3)).join(',')}]`).join(',');
      return `  [[${tri}],'${f.colour}'],`;
    }).join('\n');
    const mod = `// GENERATED by tools/import-obj.mjs — do not edit by hand.
// Source: Kenney "Holiday Kit 2.0" (www.kenney.nl), CC0 1.0.
// ${job.obj}: triangulated, colour-map sampled, centred and scaled to
// ${dims.len} x ${dims.width} x ${dims.height} car units. ${keep.length} faces
// (${dropped} sub-pixel facets dropped).
export const ${job.name} = [
${body}
];
`;
    fs.writeFileSync(new URL(job.out, OUT), mod);
    report.push(`${job.obj} -> js/models/${job.out}: ${keep.length} faces, ${dims.len} x ${dims.width} x ${dims.height}`);
  }
  console.log(report.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
