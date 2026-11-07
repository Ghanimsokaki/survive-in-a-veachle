// Procedural sky: floating islands, derelict starship wrecks and ion storms.
//
// Everything is seeded and deterministic, and the mesh builders only use plain
// geometry (no textures, no canvas) so the world can be generated and inspected
// in Node as well as in the browser.

import { WORLD } from './config.js';

// ------------------------------------------------------------------- random
export function mulberry32(a) {
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ISLAND_NAMES = [
  'Vapour Reach', 'The Ledge', 'Kestrel Rise', 'Salt Hollow', 'Nine Bells',
  'Amber Shelf', 'Old Meridian', 'The Broken Crown', 'Windward', 'Cinder Bank',
  'Lattice Point', 'Trade Wind', 'Grey Anchor', 'Halyard', 'Far Post', 'Nadir',
];

// ------------------------------------------------------------- open world cells
// The cloud sea is endless: each 320 m cell is generated from a hash of the
// seed and its grid coordinates, so the same place is always the same place
// without keeping the whole world in memory.
export const CELL = WORLD.cellSize || 320;

function hash2(seed, cx, cz) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (cx | 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (cz | 0), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return Math.imul(h ^ (h >>> 16), 0x27d4eb2f) >>> 0;
}

const DERELICT_NAMES = [
  'USS Calloway', 'USS Meridian', 'USS Tannhäuser', 'SS Ypres', 'USS Gallant',
  'USS Cerritos', 'USS Bellerophon', 'USS Hokkaido', 'USS Kalisz', 'SS Wendigo',
];

/** Everything that lives inside one cell, deterministic from (seed, cx, cz). */
export function generateCell(seed, cx, cz) {
  const rng = mulberry32(hash2(seed, cx, cz));
  const rand = (a, b) => a + rng() * (b - a);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const ox = cx * CELL, oz = cz * CELL;
  const cell = {
    key: cx + ',' + cz, cx, cz,
    islands: [], derelicts: [], storms: [],
  };
  const clearOfHome = (x, z, r) => Math.hypot(x, z) > WORLD.graveyard.r + r;

  const islandCount = rng() < 0.2 ? 1 : 2 + Math.floor(rng() * 3);
  for (let k = 0; k < islandCount; k++) {
    const r = rand(18, 52);
    const x = ox + rand(-CELL * 0.46, CELL * 0.46);
    const z = oz + rand(-CELL * 0.46, CELL * 0.46);
    const seedPart = hash2(seed ^ 0x51ed, cx * 31 + k, cz * 17);
    if (!clearOfHome(x, z, r + 30)) continue;
    cell.islands.push({
      id: `i:${cx}:${cz}:${k}`,
      cell: cell.key,
      name: ISLAND_NAMES[seedPart % ISLAND_NAMES.length],
      x, z,
      y: rand(-6, 34),
      r,
      kind: pick(['rock', 'rock', 'plateau', 'spire']),
      ruins: rng() > 0.45,
      seed: seedPart % 1e9,
      looted: false,
      matrixNode: rng() > 0.6,
    });
  }

  const derelictCount = rng() < 0.34 ? 0 : 1 + Math.floor(rng() * 2);
  for (let k = 0; k < derelictCount; k++) {
    const seedPart = hash2(seed ^ 0xa53f, cx * 13 + k, cz * 29);
    const x = ox + rand(-CELL * 0.44, CELL * 0.44);
    const z = oz + rand(-CELL * 0.44, CELL * 0.44);
    if (!clearOfHome(x, z, 40)) continue;
    cell.derelicts.push({
      id: `d:${cx}:${cz}:${k}`,
      cell: cell.key,
      name: DERELICT_NAMES[seedPart % DERELICT_NAMES.length],
      x, z,
      y: rand(10, 70),
      rot: rand(0, Math.PI * 2),
      kind: pick(['saucer', 'wreck', 'barge']),
      scale: rand(0.8, 1.5),
      seed: seedPart % 1e9,
      looted: false,
      matrix: 1 + (seedPart % 3),
    });
  }

  const stormCount = rng() < 0.45 ? 0 : 1;
  for (let k = 0; k < stormCount; k++) {
    cell.storms.push({
      id: `s:${cx}:${cz}:${k}`,
      cell: cell.key,
      x: ox + rand(-CELL * 0.4, CELL * 0.4),
      z: oz + rand(-CELL * 0.4, CELL * 0.4),
      y: rand(20, 90),
      r: rand(55, 110),
      phase: rand(0, Math.PI * 2),
      seed: hash2(seed ^ 0x1d7, cx, cz + k) % 1e9,
    });
  }
  return cell;
}

/**
 * A sliding window of cells around the ship. `update(pos)` regenerates only
 * when the ship crosses into a new cell; `view` is the flat list the sim and
 * the renderer read. Cells are cached and pruned, so memory stays flat even if
 * you fly for hours.
 */
export class WorldStream {
  constructor(seed = WORLD.seed, radius = WORLD.viewRadius ?? 1) {
    this.seed = seed;
    this.radius = radius;
    this.cache = new Map();
    this.looted = new Set();
    this.cx = null;
    this.cz = null;
    this.view = { seed, islands: [], derelicts: [], storms: [], cx: 0, cz: 0 };
    this.generated = 0;
  }

  cell(cx, cz) {
    const key = cx + ',' + cz;
    let c = this.cache.get(key);
    if (!c) {
      c = generateCell(this.seed, cx, cz);
      this.generated++;
      this.cache.set(key, c);
      this.applyTo(c);
    }
    return c;
  }

  applyTo(cell) {
    if (!this.looted.size) return;
    for (const o of cell.islands) if (this.looted.has(o.id)) o.looted = true;
    for (const o of cell.derelicts) if (this.looted.has(o.id)) o.looted = true;
  }

  applyLooted() {
    for (const c of this.cache.values()) this.applyTo(c);
  }

  /** Permanent "already stripped" flag: cells come and go, this does not. */
  markLooted(id) {
    this.looted.add(id);
    this.applyLooted();
    return id;
  }

  cellAt(pos) {
    return { cx: Math.round(pos.x / CELL), cz: Math.round(pos.z / CELL) };
  }

  update(pos, radius = this.radius) {
    const { cx, cz } = this.cellAt(pos);
    if (cx === this.cx && cz === this.cz && radius === this.radius) return this.view;
    this.cx = cx; this.cz = cz; this.radius = radius;
    const islands = [], derelicts = [], storms = [];
    for (let i = -radius; i <= radius; i++) {
      for (let k = -radius; k <= radius; k++) {
        const c = this.cell(cx + i, cz + k);
        islands.push(...c.islands);
        derelicts.push(...c.derelicts);
        storms.push(...c.storms);
      }
    }
    this.view = { seed: this.seed, cx, cz, radius, islands, derelicts, storms };
    this.prune();
    return this.view;
  }

  /** Drop cells that fell out of the window (plus a ring of slack). */
  prune() {
    if (this.cx == null) return;
    const keep = this.radius + 1;
    for (const [key, c] of this.cache) {
      if (Math.abs(c.cx - this.cx) > keep || Math.abs(c.cz - this.cz) > keep) this.cache.delete(key);
    }
  }

  /** Live cells, in a stable order, for the renderer. */
  get cells() {
    return [...this.cache.values()].filter((c) =>
      Math.abs(c.cx - (this.cx || 0)) <= this.radius && Math.abs(c.cz - (this.cz || 0)) <= this.radius)
      .sort((a, b) => a.cz - b.cz || a.cx - b.cx);
  }

  stats() {
    return {
      cells: this.cache.size,
      islands: this.view.islands.length,
      derelicts: this.view.derelicts.length,
      storms: this.view.storms.length,
      looted: this.looted.size,
    };
  }
}

/** Legacy helper: the 3x3 region around the origin, as a plain world object. */
export function generateWorld(seed = WORLD.seed, radius = 1) {
  const stream = new WorldStream(seed, radius);
  const view = stream.update({ x: 0, y: 0, z: 0 });
  return { seed, islands: view.islands, derelicts: view.derelicts, storms: view.storms };
}

export function nearestIsland(world, pos, maxDist = Infinity) {
  let best = null, bd = maxDist;
  for (const i of world.islands) {
    const d = Math.hypot(i.x - pos.x, i.y - pos.y, i.z - pos.z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function nearestDerelict(world, pos, maxDist = Infinity) {
  let best = null, bd = maxDist;
  for (const d of world.derelicts) {
    if (d.looted) continue;
    const dist = Math.hypot(d.x - pos.x, d.y - pos.y, d.z - pos.z);
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}

export function stormAt(world, pos) {
  for (const s of world.storms) {
    if (Math.hypot(s.x - pos.x, s.y - pos.y, s.z - pos.z) < s.r) return s;
  }
  return null;
}

// ------------------------------------------------------------------- meshes
function noise3(seed) {
  const rng = mulberry32(seed);
  return (x, y, z) => Math.sin(x * 1.7 + rng() * 0.001 + seed) * Math.cos(y * 1.3) * Math.sin(z * 1.1);
}

/** A chunk of floating rock with a mossy cap and a few shed boulders. */
export function buildIsland(THREE, island) {
  const g = new THREE.Group();
  g.name = island.id;
  g.position.set(island.x, island.y, island.z);

  // ---------------------------------------------------------------- rock body
  // Two octaves of noise over a subdivided icosahedron, with vertex colours so
  // the cliff faces read as strata and the sunward shelves as moss.
  const detail = island.r > 30 ? 2 : 1;
  const geo = new THREE.IcosahedronGeometry(island.r, detail);
  const pos = geo.attributes.position;
  const n = noise3(island.seed);
  const n2 = noise3(island.seed + 913);
  const v = new THREE.Vector3();
  const colours = new Float32Array(pos.count * 3);
  const rockA = new THREE.Color(island.kind === 'spire' ? '#7d7889' : '#968c7c');
  const rockB = new THREE.Color(island.kind === 'spire' ? '#575366' : '#6b6355');
  const mossA = new THREE.Color('#5f8a55');
  const mossB = new THREE.Color('#7aa164');
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const bump = 1 + n(v.x * 0.055, v.y * 0.055, v.z * 0.055) * 0.24
      + n2(v.x * 0.14, v.z * 0.14, v.y * 0.1) * 0.07;
    v.multiplyScalar(bump);
    if (v.y < 0) v.y *= 1.9;          // long keel under the surface
    pos.setXYZ(i, v.x, v.y, v.z);
    const h = v.y / island.r;
    const band = 0.5 + 0.5 * Math.sin(h * 9 + n(v.x * 0.1, v.y * 0.1, v.z * 0.1) * 3);
    tmp.copy(rockA).lerp(rockB, band * 0.75);
    if (h > 0.42 && island.kind !== 'spire') tmp.lerp(h > 0.7 ? mossB : mossA, Math.min(1, (h - 0.42) * 2.4));
    colours[i * 3] = tmp.r;
    colours[i * 3 + 1] = tmp.g;
    colours[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  const rock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0.04, flatShading: true,
  }));
  rock.receiveShadow = true;
  rock.castShadow = true;
  g.add(rock);

  const rng = mulberry32(island.seed + 7);

  // mossy plateau on top, ringed by broken spurs
  if (island.kind !== 'spire') {
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(island.r * 0.68, island.r * 0.8, island.r * 0.2, 11, 1),
      new THREE.MeshStandardMaterial({ color: '#6d9459', roughness: 1, flatShading: true }),
    );
    cap.position.y = island.r * 0.64;
    cap.receiveShadow = true;
    g.add(cap);
    // spurs and trees are instanced: dozens of props for two draw calls
    const spurCount = 4 + Math.floor(rng() * 3);
    const spurs = new THREE.InstancedMesh(
      new THREE.ConeGeometry(island.r * 0.09, island.r * 0.26, 5, 1),
      new THREE.MeshStandardMaterial({ color: '#726a5d', roughness: 1, flatShading: true }),
      spurCount,
    );
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < spurCount; i++) {
      const a = rng() * Math.PI * 2;
      const h = 0.6 + rng() * 0.9;
      e.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5);
      q.setFromEuler(e);
      m4.compose(
        new THREE.Vector3(Math.cos(a) * island.r * 0.62, island.r * 0.6 + island.r * 0.13 * h, Math.sin(a) * island.r * 0.62),
        q,
        new THREE.Vector3(1, h, 1),
      );
      spurs.setMatrixAt(i, m4);
    }
    spurs.castShadow = true;
    g.add(spurs);

    const treeCount = 5 + Math.floor(rng() * 4);
    const trees = new THREE.InstancedMesh(
      new THREE.ConeGeometry(island.r * 0.04, island.r * 0.16, 5, 1),
      new THREE.MeshStandardMaterial({ color: '#43703e', roughness: 1, flatShading: true }),
      treeCount,
    );
    for (let i = 0; i < treeCount; i++) {
      const a = rng() * Math.PI * 2;
      const r = island.r * (0.06 + rng() * 0.5);
      const h = 0.6 + rng() * 0.8;
      q.setFromEuler(e.set(0, rng() * 3, 0));
      m4.compose(
        new THREE.Vector3(Math.cos(a) * r, island.r * 0.72 + island.r * 0.08 * h, Math.sin(a) * r),
        q,
        new THREE.Vector3(1, h, 1),
      );
      trees.setMatrixAt(i, m4);
    }
    g.add(trees);
  }

  // shed boulders drifting below the keel (one instanced draw call)
  {
    const count = 7;
    const boulders = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(island.r * 0.1, 0),
      new THREE.MeshStandardMaterial({ color: '#6a6357', roughness: 1, flatShading: true }),
      count,
    );
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      const scale = 0.5 + rng() * 1.1;
      q.setFromEuler(e.set(rng() * 3, rng() * 3, rng() * 3));
      m4.compose(
        new THREE.Vector3((rng() - 0.5) * island.r * 1.8, -island.r * (0.85 + rng() * 0.9), (rng() - 0.5) * island.r * 1.8),
        q,
        new THREE.Vector3(scale, scale, scale),
      );
      boulders.setMatrixAt(i, m4);
    }
    g.add(boulders);
  }

  // ------------------------------------------------------------------ ruins
  if (island.ruins) {
    const stone = new THREE.MeshStandardMaterial({ color: '#a9b0bb', metalness: 0.35, roughness: 0.6, flatShading: true });
    const cols = 3 + Math.floor(rng() * 3);
    const ringR = island.r * 0.34;
    for (let i = 0; i < cols; i++) {
      const a = (i / cols) * Math.PI * 2 + rng() * 0.4;
      const h = island.r * (0.16 + rng() * 0.26);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(island.r * 0.035, island.r * 0.045, h, 6, 1), stone);
      col.position.set(Math.cos(a) * ringR, island.r * 0.7 + h / 2, Math.sin(a) * ringR);
      col.rotation.z = (rng() - 0.5) * 0.35;
      col.castShadow = true;
      g.add(col);
    }
    // broken lintel across two of the columns
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(island.r * 0.5, island.r * 0.03, island.r * 0.05), stone);
    lintel.position.set(0, island.r * 0.9, ringR * 0.9);
    lintel.rotation.y = 0.2;
    g.add(lintel);
    const beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(Math.max(1.2, island.r * 0.055), 0),
      new THREE.MeshBasicMaterial({ color: '#7ef0ff' }),
    );
    beacon.position.y = island.r * 1.15;
    g.add(beacon);
    g.userData.beacon = beacon;
  }

  if (island.matrixNode) {
    const node = new THREE.Mesh(
      new THREE.OctahedronGeometry(Math.max(2, island.r * 0.07), 0),
      new THREE.MeshStandardMaterial({ color: '#b9a4ff', emissive: '#6d4bff', emissiveIntensity: 1.6, roughness: 0.2 }),
    );
    node.position.set(island.r * 0.4, island.r * 0.85, 0);
    g.add(node);
    g.userData.matrixNode = node;
  }
  g.userData.kind = island.kind;
  return g;
}

/** A dead starship: buckelled saucer, snapped nacelle, lit windows, debris. */
export function buildDerelict(THREE, d) {
  const g = new THREE.Group();
  g.name = d.id;
  g.position.set(d.x, d.y, d.z);
  g.rotation.set(0.2, d.rot, 0.16);
  g.scale.setScalar(d.scale);

  const hull = new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.3, roughness: 0.55, flatShading: true });
  const plate = new THREE.MeshStandardMaterial({ color: '#7d8794', metalness: 0.28, roughness: 0.62, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: '#4a525c', metalness: 0.3, roughness: 0.62, flatShading: true });
  const hot = new THREE.MeshBasicMaterial({ color: '#ffb35c' });
  const lit = new THREE.MeshBasicMaterial({ color: '#ffe6a6' });
  const rng = mulberry32(d.seed);

  if (d.kind === 'saucer' || d.kind === 'wreck') {
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(7, 6.1, 1.6, 32, 1), hull);
    saucer.rotation.z = 0.22;
    g.add(saucer);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), plate);
    dome.position.y = 0.7;
    dome.rotation.z = 0.22;
    g.add(dome);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.9, 0.26, 8, 32), dark);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = 0.22;
    g.add(ring);
    const bridge = new THREE.Mesh(new THREE.SphereGeometry(1.7, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), plate);
    bridge.position.y = 4.1;
    g.add(bridge);
    // cabins still burning: one thin lit ring reads as a whole deck of windows
    const lights = new THREE.Mesh(
      new THREE.CylinderGeometry(6.92, 6.92, 0.16, 28, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffe6a6', transparent: true, opacity: 0.55 }),
    );
    lights.rotation.z = 0.22;
    lights.position.y = 0.2;
    g.add(lights);
    // torn plating peeling off the rim
    const tears = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.16, 1.4), plate, 3);
    const tm = new THREE.Matrix4();
    const tq = new THREE.Quaternion();
    const te = new THREE.Euler();
    for (let i = 0; i < 3; i++) {
      const a = rng() * Math.PI * 2;
      tq.setFromEuler(te.set((rng() - 0.5) * 0.9, a, (rng() - 0.5) * 0.9));
      tm.compose(
        new THREE.Vector3(Math.cos(a) * 5.4, 0.75 + rng() * 0.4, Math.sin(a) * 5.4),
        tq,
        new THREE.Vector3(1, 1, 1),
      );
      tears.setMatrixAt(i, tm);
    }
    g.add(tears);
  }
  if (d.kind === 'wreck' || d.kind === 'barge') {
    const eng = new THREE.Mesh(new THREE.CapsuleGeometry(2.2, 9, 10, 18), hull);
    eng.rotation.z = Math.PI / 2;
    eng.position.set(0, -3, 2);
    g.add(eng);
    const bands = new THREE.InstancedMesh(new THREE.TorusGeometry(2.25, 0.09, 6, 24), dark, 3);
    const bm = new THREE.Matrix4();
    const bq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    for (let i = 0; i < 3; i++) {
      bm.compose(new THREE.Vector3(-2.4 + i * 2.4, -3, 2), bq, new THREE.Vector3(1, 1, 1));
      bands.setMatrixAt(i, bm);
    }
    g.add(bands);
    // one nacelle torn half away, still glowing at the break
    const nac = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 5.4, 8, 14), dark);
    nac.rotation.z = Math.PI / 2.6;
    nac.position.set(5, 2.4, 1);
    g.add(nac);
    const bussard = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), new THREE.MeshBasicMaterial({ color: '#8a5a4a' }));
    bussard.position.set(7.4, 4.6, 1);
    g.add(bussard);
    const scar = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), hot);
    scar.position.set(2.4, -2.4, 1.4);
    g.add(scar);
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 2.6), hot);
    vent.position.set(-1.6, -1.2, 3.2);
    g.add(vent);
  }
  if (d.kind === 'barge') {
    for (let i = 0; i < 3; i++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3.2, 6), i % 2 ? plate : dark);
      box.position.set(-4 + i * 4.4, -1 + i * 0.4, -4);
      box.rotation.y = i * 0.3;
      g.add(box);
    }
  }

  // debris field: one instanced draw call for the whole cloud of chunks
  {
    const count = 12;
    const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.6, 1.3), plate, count);
    const dm = new THREE.Matrix4();
    const dq = new THREE.Quaternion();
    const de = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      const size = 0.3 + rng() * 1.1;
      dq.setFromEuler(de.set(rng() * 3, rng() * 3, rng() * 3));
      dm.compose(
        new THREE.Vector3((rng() - 0.5) * 26, (rng() - 0.5) * 14, (rng() - 0.5) * 26),
        dq,
        new THREE.Vector3(size, size, size),
      );
      debris.setMatrixAt(i, dm);
    }
    g.add(debris);
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff5f5f' }));
  beacon.position.set(0, 4.6, 0);
  g.add(beacon);
  g.userData.beacon = beacon;
  return g;
}

/** Ion storm: a charged particle volume with two counter-rotating rings. */
export function buildStorm(THREE, storm) {
  const g = new THREE.Group();
  g.name = storm.id || 'storm';
  g.position.set(storm.x, storm.y, storm.z);
  const rng = mulberry32(Math.floor(storm.phase * 1e6) + 17);

  const shell = (count, radius, size, color, opacity) => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = radius * Math.cbrt(rng());
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(2 * rng() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.cos(phi) * 0.6;
      arr[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color, size, transparent: true, opacity, depthWrite: false,
    }));
    return pts;
  };

  const points = shell(900, storm.r, 1.7, '#a98bff', 0.7);
  const inner = shell(320, storm.r * 0.55, 1.15, '#d9c8ff', 0.55);
  g.add(points, inner);

  // a charged core
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(storm.r * 0.16, 16, 12),
    new THREE.MeshBasicMaterial({ color: '#c9a6ff', transparent: true, opacity: 0.4, depthWrite: false }),
  );
  g.add(core);

  // lightning: random chords across the volume
  const bolts = [];
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2, b = rng() * Math.PI * 2;
    const r1 = storm.r * (0.35 + rng() * 0.5), r2 = storm.r * (0.35 + rng() * 0.5);
    bolts.push(
      Math.cos(a) * r1, (rng() - 0.5) * storm.r * 0.5, Math.sin(a) * r1,
      Math.cos(b) * r2, (rng() - 0.5) * storm.r * 0.5, Math.sin(b) * r2,
    );
  }
  const boltGeo = new THREE.BufferGeometry();
  boltGeo.setAttribute('position', new THREE.Float32BufferAttribute(bolts, 3));
  const boltLines = new THREE.LineSegments(boltGeo, new THREE.LineBasicMaterial({
    color: '#e8e0ff', transparent: true, opacity: 0.5,
  }));
  g.add(boltLines);

  const ringA = new THREE.Mesh(
    new THREE.TorusGeometry(storm.r * 0.7, 0.5, 6, 44),
    new THREE.MeshBasicMaterial({ color: '#7c5bff', transparent: true, opacity: 0.5 }),
  );
  ringA.rotation.x = Math.PI / 2;
  const ringB = new THREE.Mesh(
    new THREE.TorusGeometry(storm.r * 0.95, 0.35, 6, 44),
    new THREE.MeshBasicMaterial({ color: '#59d8ff', transparent: true, opacity: 0.35 }),
  );
  ringB.rotation.set(Math.PI / 2.4, 0.4, 0);
  g.add(ringA, ringB);
  g.userData.ringA = ringA;
  g.userData.ringB = ringB;
  g.userData.points = points;
  g.userData.inner = inner;
  g.userData.core = core;
  g.userData.bolts = boltLines;
  return g;
}

/** The command core beacon that marks your spawn / home fortress. */
export function buildHomeBeacon(THREE) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(26, 30, 4, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: '#4ad2ff', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
  );
  g.add(base);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(28, 0.6, 6, 48),
    new THREE.MeshBasicMaterial({ color: '#7ef0ff', transparent: true, opacity: 0.55 }),
  );
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}
