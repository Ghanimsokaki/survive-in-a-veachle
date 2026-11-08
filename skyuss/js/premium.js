// Loading bought / third-party hulls.
//
// Two sources, in priority order:
//
//  1. skyuss/assets/premium/avrora.obj — a hull the *player* bought (e.g. the
//     TurboSquid "Avrora"). The licence allows the mesh inside a game but not
//     redistribution, so that folder is git-ignored and empty in the repo.
//
//  2. skyuss/assets/models/quaternius/dispatcher.obj — "Dispatcher" from the
//     Quaternius Ultimate Spaceships Pack, CC0 1.0, committed with credit. This
//     is what the Aurora-class courier actually flies out of the box.
//
// With neither present the game keeps its procedural hull from js/aurora.js, so
// nothing here can break the game.
//
// No Three.js import: the caller passes THREE in, which keeps this testable in
// Node (the OBJ reader is pure string → typed array).

export const PREMIUM_DIR = 'assets/premium/';
export const PREMIUM_CANDIDATES = [
  'assets/premium/avrora.obj',
  'assets/premium/avrora.obj.txt',
  'assets/premium/aurora.obj',
];

/** Committed, licence-clean hulls. */
export const HULL_MODELS = {
  aurora: {
    id: 'aurora',
    name: 'Dispatcher',
    url: 'assets/models/quaternius/dispatcher.obj',
    texture: 'assets/models/quaternius/dispatcher_blue.jpg',
    length: 30,
    credit: 'Dispatcher — Quaternius Ultimate Spaceships Pack (CC0 1.0)',
    source: 'https://quaternius.com/packs/ultimatespaceships.html',
  },
};

/**
 * Minimal Wavefront OBJ reader: `v`, `vt` and `f` (with `v`, `v/vt` or `v//vn`
 * corners). Quads and n-gons are fan-triangulated, negative indices resolved.
 * Returns flat per-corner arrays ready for a BufferGeometry, or null.
 */
export function parseOBJ(text) {
  const verts = [];
  const tex = [];
  const corners = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      verts.push(Number(p[1]) || 0, Number(p[2]) || 0, Number(p[3]) || 0);
    } else if (line.startsWith('vt ')) {
      const p = line.split(/\s+/);
      tex.push(Number(p[1]) || 0, Number(p[2]) || 0);
    } else if (line.startsWith('f ')) {
      const parts = line.split(/\s+/).slice(1);
      const face = [];
      for (const tok of parts) {
        const seg = tok.split('/');
        const vi = parseInt(seg[0], 10);
        if (!Number.isFinite(vi) || vi === 0) continue;
        const ti = seg.length > 1 && seg[1] ? parseInt(seg[1], 10) : 0;
        face.push({
          v: vi < 0 ? verts.length / 3 + vi : vi - 1,
          t: ti > 0 ? ti - 1 : ti < 0 ? tex.length / 2 + ti : -1,
        });
      }
      for (let i = 1; i + 1 < face.length; i++) corners.push(face[0], face[i], face[i + 1]);
    }
  }
  if (!corners.length) return null;

  const n = corners.length;
  const positions = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  let hasUV = false;
  for (let i = 0; i < n; i++) {
    const c = corners[i];
    positions[i * 3] = verts[c.v * 3] || 0;
    positions[i * 3 + 1] = verts[c.v * 3 + 1] || 0;
    positions[i * 3 + 2] = verts[c.v * 3 + 2] || 0;
    if (c.t >= 0) {
      uvs[i * 2] = tex[c.t * 2] || 0;
      uvs[i * 2 + 1] = tex[c.t * 2 + 1] || 0;
      hasUV = true;
    }
  }
  return {
    positions,
    uvs: hasUV ? uvs : null,
    triangles: n / 3,
    vertices: verts.length / 3,
    uvCount: tex.length / 2,
  };
}

/** Turn parsed OBJ data into a mesh ready to hang on the ship group. */
export function objMesh(THREE, data, opts = {}) {
  if (!data) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  if (data.uvs) geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color || '#ffffff',
    map: opts.map || null,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.18,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = opts.name || 'hull-model';
  return mesh;
}

/** Centre a loaded mesh on the origin and scale its longest axis to `length`. */
function fitMesh(THREE, mesh, length) {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  mesh.scale.setScalar(length / longest);
  box.setFromObject(mesh);
  const centre = box.getCenter(new THREE.Vector3());
  mesh.position.sub(centre);
  return { size, scale: length / longest };
}

async function readText(fetchImpl, url) {
  const res = await fetchImpl(url, { cache: 'no-store' });
  if (!res || !res.ok) return null;
  const text = await res.text();
  return text && text.includes('f ') ? text : null;
}

/**
 * A hull the player bought and dropped in. No texture is assumed: the file may
 * reference maps this reader does not resolve, so it is lit as a plain hull.
 */
export async function loadPremium(THREE, opts = {}) {
  const fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return null;
  for (const url of opts.urls || PREMIUM_CANDIDATES) {
    try {
      const text = await readText(fetchImpl, url);
      if (!text) continue;
      const data = parseOBJ(text);
      if (!data) continue;
      const mesh = objMesh(THREE, data, { color: opts.color || '#c8d4e0', name: 'premium-hull' });
      const fit = fitMesh(THREE, mesh, opts.length || 30);
      return { mesh, source: url, triangles: data.triangles, scale: fit.scale, bought: true };
    } catch (err) {
      /* missing file, offline, unreadable — the stand-in hull keeps flying */
    }
  }
  return null;
}

/**
 * A committed CC0 hull (the Dispatcher courier). Loads its palette texture when
 * a `texLoader` is supplied, which the browser layer does.
 */
export async function loadCommittedHull(THREE, id = 'aurora', opts = {}) {
  const model = HULL_MODELS[id];
  if (!model) return null;
  const fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return null;
  try {
    const text = await readText(fetchImpl, opts.url || model.url);
    if (!text) return null;
    const data = parseOBJ(text);
    if (!data) return null;
    let map = null;
    if (opts.texLoader && model.texture) {
      try { map = opts.texLoader(model.texture); } catch (err) { map = null; }
    }
    const mesh = objMesh(THREE, data, { map, color: '#ffffff', name: 'hull-' + id });
    const fit = fitMesh(THREE, mesh, opts.length || model.length);
    return {
      mesh, source: model.url, texture: map ? model.texture : null,
      triangles: data.triangles, scale: fit.scale, credit: model.credit, name: model.name,
    };
  } catch (err) {
    return null;
  }
}
