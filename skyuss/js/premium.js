// Drop-in slot for a bought hull.
//
// A TurboSquid purchase may be used inside a game but the model file itself may
// not be redistributed, so the mesh never lives in this repo. Put it here and
// the game picks it up:
//
//   skyuss/assets/premium/avrora.obj     <- the bought "Avrora" hull (OBJ export)
//
// The folder is git-ignored on purpose. With no file present the game flies the
// procedural Aurora stand-in from js/aurora.js, so nothing breaks.

export const PREMIUM_DIR = 'assets/premium/';
export const PREMIUM_CANDIDATES = [
  'assets/premium/avrora.obj',
  'assets/premium/avrora.obj.txt',
  'assets/premium/aurora.obj',
];

/**
 * Minimal Wavefront OBJ reader: vertices, faces, fan-triangulated quads, negative
 * indices, `o`/`g` ignored. Enough for a static hull export.
 */
export function parseOBJ(text) {
  const verts = [];
  const tris = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      verts.push(Number(p[1]) || 0, Number(p[2]) || 0, Number(p[3]) || 0);
    } else if (line.startsWith('f ')) {
      const parts = line.split(/\s+/).slice(1);
      const idx = parts.map((tok) => {
        const n = parseInt(tok.split('/')[0], 10);
        if (!Number.isFinite(n) || n === 0) return -1;
        return n < 0 ? verts.length / 3 + n : n - 1;      // 1-based, negatives count back
      }).filter((n) => n >= 0);
      for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0], idx[i], idx[i + 1]);
    }
  }
  if (!tris.length) return null;
  const pos = new Float32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    const v = tris[i] * 3;
    pos[i * 3] = verts[v] || 0;
    pos[i * 3 + 1] = verts[v + 1] || 0;
    pos[i * 3 + 2] = verts[v + 2] || 0;
  }
  return { positions: pos, triangles: tris.length / 3, vertices: verts.length / 3 };
}

/** Turn parsed OBJ data into a lit mesh ready to hang on the ship group. */
export function objMesh(THREE, data, opts = {}) {
  if (!data) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color || '#c8d4e0',
    roughness: opts.roughness ?? 0.45,
    metalness: opts.metalness ?? 0.35,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'premium-hull';
  return mesh;
}

/**
 * Look for a bought hull on disk. Returns `{ mesh, source, triangles }` or null.
 * `fetch` is injectable so the headless tests can feed it a fake file.
 */
export async function loadPremium(THREE, opts = {}) {
  const fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return null;
  const urls = opts.urls || PREMIUM_CANDIDATES;
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { cache: 'no-store' });
      if (!res || !res.ok) continue;
      const text = await res.text();
      const data = parseOBJ(text);
      if (!data) continue;
      return { mesh: objMesh(THREE, data, opts), source: url, triangles: data.triangles };
    } catch (err) {
      /* no file, offline, wrong format — the stand-in ship keeps flying */
    }
  }
  return null;
}
