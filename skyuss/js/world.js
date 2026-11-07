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

export function generateWorld(seed = WORLD.seed) {
  const rng = mulberry32(seed);
  const rand = (a, b) => a + rng() * (b - a);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const world = { seed, islands: [], derelicts: [], storms: [] };

  const farFromCore = (x, z, r) => Math.hypot(x - WORLD.graveyard.x, z - WORLD.graveyard.z) > WORLD.graveyard.r + r;

  // ------------------------------------------------------------------ islands
  let guard = 0;
  while (world.islands.length < WORLD.islands && guard++ < 4000) {
    const r = rand(18, 52);
    const x = rand(-WORLD.cloudBand + r, WORLD.cloudBand - r);
    const z = rand(-WORLD.cloudBand + r, WORLD.cloudBand - r);
    if (!farFromCore(x, z, r + 30)) continue;
    if (world.islands.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 40)) continue;
    world.islands.push({
      id: 'island' + world.islands.length,
      name: ISLAND_NAMES[world.islands.length % ISLAND_NAMES.length],
      x, z,
      y: rand(-6, 34),
      r,
      kind: pick(['rock', 'rock', 'plateau', 'spire']),
      ruins: rng() > 0.45,
      seed: Math.floor(rng() * 1e9),
      looted: false,
      matrixNode: rng() > 0.6,
    });
  }

  // ---------------------------------------------------------------- derelicts
  for (let i = 0; i < WORLD.derelicts; i++) {
    const x = rand(-WORLD.cloudBand * 0.9, WORLD.cloudBand * 0.9);
    const z = rand(-WORLD.cloudBand * 0.9, WORLD.cloudBand * 0.9);
    world.derelicts.push({
      id: 'derelict' + i,
      name: pick(['USS Calloway', 'USS Meridian', 'USS Tannhäuser', 'SS Ypres', 'USS Gallant', 'USS Cerritos', 'USS Bellerophon']),
      x, z,
      y: rand(10, 70),
      rot: rand(0, Math.PI * 2),
      kind: pick(['saucer', 'wreck', 'barge']),
      scale: rand(0.8, 1.5),
      seed: Math.floor(rng() * 1e9),
      looted: false,
      matrix: 1 + Math.floor(rng() * 3),
    });
  }

  // ------------------------------------------------------------------- storms
  for (let i = 0; i < WORLD.storms; i++) {
    world.storms.push({
      id: 'storm' + i,
      x: rand(-WORLD.cloudBand * 0.85, WORLD.cloudBand * 0.85),
      z: rand(-WORLD.cloudBand * 0.85, WORLD.cloudBand * 0.85),
      y: rand(20, 90),
      r: rand(55, 110),
      power: rand(0.6, 1.5),
      phase: rand(0, Math.PI * 2),
    });
  }

  return world;
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

  const geo = new THREE.IcosahedronGeometry(island.r, 1);
  const pos = geo.attributes.position;
  const n = noise3(island.seed);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const bump = 1 + n(v.x * 0.06, v.y * 0.06, v.z * 0.06) * 0.18;
    v.multiplyScalar(bump);
    if (v.y < 0) v.y *= 1.9;          // long keel under the surface
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const rock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: island.kind === 'spire' ? '#5d5a6b' : '#6b6357',
    roughness: 0.95, metalness: 0.05, flatShading: true,
  }));
  rock.receiveShadow = true;
  rock.castShadow = true;
  g.add(rock);

  // mossy plateau on top
  if (island.kind !== 'spire') {
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(island.r * 0.72, island.r * 0.8, island.r * 0.22, 9, 1),
      new THREE.MeshStandardMaterial({ color: '#5d7f52', roughness: 1, flatShading: true }),
    );
    cap.position.y = island.r * 0.62;
    cap.receiveShadow = true;
    g.add(cap);
  }
  // shed boulders drifting below the keel
  const rng = mulberry32(island.seed + 7);
  for (let i = 0; i < 5; i++) {
    const br = island.r * (0.08 + rng() * 0.14);
    const rock2 = new THREE.Mesh(
      new THREE.IcosahedronGeometry(br, 0),
      new THREE.MeshStandardMaterial({ color: '#57524a', roughness: 1, flatShading: true }),
    );
    rock2.position.set((rng() - 0.5) * island.r * 1.6, -island.r * (0.9 + rng() * 0.8), (rng() - 0.5) * island.r * 1.6);
    rock2.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(rock2);
  }
  if (island.ruins) {
    const pylon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 2.6, island.r * 0.7, 6, 1),
      new THREE.MeshStandardMaterial({ color: '#8d93a0', metalness: 0.6, roughness: 0.5, flatShading: true }),
    );
    pylon.position.y = island.r * 0.95;
    pylon.castShadow = true;
    g.add(pylon);
    const beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.5, 0),
      new THREE.MeshBasicMaterial({ color: '#7ef0ff' }),
    );
    beacon.position.y = island.r * 1.35;
    g.add(beacon);
    g.userData.beacon = beacon;
  }
  if (island.matrixNode) {
    const node = new THREE.Mesh(
      new THREE.OctahedronGeometry(2.4, 0),
      new THREE.MeshStandardMaterial({ color: '#b9a4ff', emissive: '#6d4bff', emissiveIntensity: 1.6, roughness: 0.2 }),
    );
    node.position.set(island.r * 0.4, island.r * 0.85, 0);
    g.add(node);
    g.userData.matrixNode = node;
  }
  return g;
}

/** A dead starship: saucer section, snapped pylon, drifting debris. */
export function buildDerelict(THREE, d) {
  const g = new THREE.Group();
  g.name = d.id;
  g.position.set(d.x, d.y, d.z);
  g.rotation.set(0.2, d.rot, 0.16);
  g.scale.setScalar(d.scale);

  const hull = new THREE.MeshStandardMaterial({ color: '#8a929c', metalness: 0.75, roughness: 0.55, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: '#3b4149', metalness: 0.7, roughness: 0.6, flatShading: true });
  const hot = new THREE.MeshBasicMaterial({ color: '#ffb35c' });

  if (d.kind === 'saucer' || d.kind === 'wreck') {
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(7, 6.2, 1.6, 24, 1), hull);
    saucer.rotation.z = 0.22;
    g.add(saucer);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.9, 0.3, 8, 28), dark);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    const bridge = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hull);
    bridge.position.y = 1;
    g.add(bridge);
  }
  if (d.kind === 'wreck' || d.kind === 'barge') {
    const eng = new THREE.Mesh(new THREE.CapsuleGeometry(2.2, 9, 8, 14), hull);
    eng.rotation.z = Math.PI / 2;
    eng.position.set(0, -3, 2);
    g.add(eng);
    // one nacelle torn half away
    const nac = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 6, 8, 12), dark);
    nac.rotation.z = Math.PI / 2.6;
    nac.position.set(5, 2.4, 1);
    g.add(nac);
    const scar = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), hot);
    scar.position.set(2.4, -2.4, 1.4);
    g.add(scar);
  }
  if (d.kind === 'barge') {
    for (let i = 0; i < 3; i++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3.2, 6), dark);
      box.position.set(-4 + i * 4.4, -1 + i * 0.4, -4);
      box.rotation.y = i * 0.3;
      g.add(box);
    }
  }
  // debris field
  const rng = mulberry32(d.seed);
  for (let i = 0; i < 10; i++) {
    const s = 0.3 + rng() * 1.1;
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s * 1.3), rng() > 0.5 ? hull : dark);
    chunk.position.set((rng() - 0.5) * 26, (rng() - 0.5) * 14, (rng() - 0.5) * 26);
    chunk.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(chunk);
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff5f5f' }));
  beacon.position.set(0, 3.6, 0);
  g.add(beacon);
  g.userData.beacon = beacon;
  return g;
}

/** Ion storm: a charged particle volume with two counter-rotating rings. */
export function buildStorm(THREE, storm) {
  const g = new THREE.Group();
  g.position.set(storm.x, storm.y, storm.z);
  const rng = mulberry32(Math.floor(storm.phase * 1e6) + 17);
  const count = 900;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = storm.r * Math.cbrt(rng());
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * rng() - 1);
    arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    arr[i * 3 + 1] = r * Math.cos(phi) * 0.6;
    arr[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: '#a98bff', size: 1.6, transparent: true, opacity: 0.7, depthWrite: false,
  }));
  g.add(points);
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
