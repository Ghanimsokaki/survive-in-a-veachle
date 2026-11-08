/**
 * reaver.js — the hostile capital ship, designed here.
 *
 * The player's dreadnought is meant to be the USS Vengeance mesh the owner
 * bought; the *enemy* big ship is deliberately our own design, so nothing in the
 * repository depends on a licence we do not hold. It is built from primitives
 * the same way the Kang-class hull is, which keeps it commit-safe and lets the
 * smoke test count its parts.
 *
 * Shape language, so it reads as the *other* side at a glance:
 *   · forward mandibles that frame a spinal cannon, instead of a saucer
 *   · symmetric armour shoulders and a stepped dorsal tower
 *   · four exposed engine bells with a hot red core
 *   · a ventral hangar maw that glows when it launches
 *
 * Nose points +Z, matching the player ship and `makePirate()`, so `rotation.y`
 * means the same thing for every actor in the scene.
 */

export const REAVER_MATS = {
  armor: { color: '#59626e', metalness: 0.3, roughness: 0.52 },
  plate: { color: '#6d7683', metalness: 0.26, roughness: 0.58 },
  dark: { color: '#2c3238', metalness: 0.2, roughness: 0.75 },
  trim: { color: '#b2402c', metalness: 0.3, roughness: 0.42 },
};

/**
 * Build one Reaver dreadnought.
 * @param {object} THREE three.js namespace
 * @param {{size?: number, seed?: number, glowColor?: string}} opts
 * @returns {THREE.Group} group with userData {kind, parts, glow, glowMats, core, lights, size}
 */
export function buildReaverDreadnought(THREE, { size = 4.5, seed = 7, glowColor = '#ff3d2e' } = {}) {
  // the kit below is drawn in metres at 1 unit; scale it so size 4.5 is a ~31 m capital ship,
  // the same footprint `makePirate()` gives a 4.5-size raider
  const u = (size / 4.5) * 2.4;
  const g = new THREE.Group();
  const parts = { mandibles: [], shoulders: [], nozzles: [], lights: [], greebles: [], ribs: [], spires: [] };

  const mats = {};
  for (const [k, v] of Object.entries(REAVER_MATS)) {
    mats[k] = new THREE.MeshStandardMaterial({ ...v, flatShading: true });
  }
  const glowMat = new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.8 });
  const coreMat = new THREE.MeshStandardMaterial({
    color: '#2a0f08', emissive: glowColor, emissiveIntensity: 2.4, roughness: 0.3, flatShading: true,
  });

  const add = (geom, mat, x, y, z, rx = 0, ry = 0, rz = 0, bucket = null) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x * u, y * u, z * u);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    if (bucket) bucket.push(m);
    return m;
  };
  const box = (w, h, d, mat, x, y, z, rx, ry, rz, bucket) =>
    add(new THREE.BoxGeometry(w * u, h * u, d * u), mat, x, y, z, rx, ry, rz, bucket);

  /* ---------------------------------------------------------------- spine */
  // three tapering blocks: heavy stern, deep midship, narrow prow
  box(3.6, 1.7, 3.4, mats.armor, 0, 0, -2.1);
  box(3.2, 1.55, 3.6, mats.plate, 0, 0.08, 0.7);
  box(2.2, 1.25, 3.1, mats.armor, 0, 0.06, 3.6);
  box(1.7, 0.75, 5.6, mats.dark, 0, -0.85, 0.9);          // ventral keel
  box(0.78, 0.55, 5.2, mats.plate, 0, 0.86, 1.1);          // dorsal ridge
  box(0.5, 0.34, 2.2, mats.trim, 0, 0.5, 4.3);
  // chamfer plates that tie the blocks together
  box(4.1, 0.34, 1.1, mats.dark, 0, 0.72, -1.4);
  box(3.6, 0.3, 1.0, mats.dark, 0, 0.62, 1.9);
  box(2.5, 0.26, 0.9, mats.dark, 0, 0.52, 4.4);

  /* ------------------------------------------------------------ nose spike */
  box(3.5, 0.95, 1.6, mats.armor, 0, 0.1, 2.5);            // bow head
  box(2.9, 0.4, 0.7, mats.trim, 0, 0.62, 2.2);
  const spike = new THREE.ConeGeometry(0.85 * u, 2.8 * u, 4);
  add(spike, mats.trim, 0, 0, 6.1, Math.PI / 2, 0, Math.PI / 4);
  add(new THREE.ConeGeometry(0.5 * u, 1.6 * u, 4), mats.dark, 0, -0.62, 5.1, Math.PI / 2, 0, Math.PI / 4);

  /* ------------------------------------------------------------- mandibles */
  // two forward claws that bracket the spinal cannon
  for (const side of [-1, 1]) {
    box(0.78, 0.72, 4.4, mats.armor, side * 1.6, 0.04, 4.2, 0, side * 0.06, 0, parts.mandibles);
    box(0.4, 0.3, 4.0, mats.dark, side * 1.18, 0.04, 4.2, 0, side * 0.06, 0, parts.mandibles);
    box(0.62, 0.5, 1.5, mats.trim, side * 1.44, 0.0, 6.3, 0, side * -0.12, 0, parts.mandibles);
    box(0.09, 0.12, 2.0, glowMat, side * 1.98, 0.06, 4.4, 0, side * 0.06, 0);     // outer light trench
    box(0.5, 0.18, 1.1, mats.dark, side * 1.55, 0.34, 2.4);                       // hinge block
  }

  /* ---------------------------------------------------------- spinal cannon */
  add(new THREE.CylinderGeometry(0.34 * u, 0.3 * u, 4.6 * u, 8), mats.dark, 0, 0.02, 3.2, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.46 * u, 0.46 * u, 0.4 * u, 8), mats.trim, 0, 0.02, 5.1, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.5 * u, 0.5 * u, 0.28 * u, 8), mats.trim, 0, 0.02, 1.5, Math.PI / 2);
  const core = add(new THREE.SphereGeometry(0.3 * u, 10, 8), coreMat, 0, 0.02, 5.45);
  const halo = add(new THREE.SphereGeometry(0.26 * u, 12, 8), glowMat, 0, 0.02, 5.24);   // muzzle halo
  halo.material = glowMat;

  /* ------------------------------------------------------------- shoulders */
  for (const side of [-1, 1]) {
    box(1.35, 0.5, 3.2, mats.plate, side * 2.1, 0.22, 0.1, 0, 0, side * 0.26, parts.shoulders);
    box(0.8, 0.3, 2.3, mats.armor, side * 2.28, 0.6, -0.3, 0, 0, side * 0.3, parts.shoulders);
    box(0.16, 0.14, 3.0, mats.trim, side * 2.72, 0.3, 0.1, 0, 0, side * 0.26);   // edge strip
    box(0.5, 0.4, 1.2, mats.dark, side * 1.9, 0.62, 1.7);
    // weapon pods under the shoulders
    box(0.72, 0.6, 1.5, mats.dark, side * 2.3, -0.35, 0.6);
    add(new THREE.CylinderGeometry(0.14 * u, 0.16 * u, 1.5 * u, 6), mats.trim, side * 2.3, -0.35, 1.5, Math.PI / 2);
  }

  /* ----------------------------------------------------------- dorsal tower */
  box(2.7, 1.0, 3.2, mats.armor, 0, 1.3, -1.5);            // hangar island
  box(2.2, 0.35, 3.4, mats.dark, 0, 1.85, -1.5);
  box(1.8, 0.85, 1.9, mats.plate, 0, 2.2, -1.9);           // stepped tower
  box(1.15, 0.6, 1.15, mats.armor, 0, 2.85, -2.0);         // bridge
  box(0.9, 0.16, 0.9, mats.trim, 0, 3.2, -2.0);
  add(new THREE.CylinderGeometry(0.05 * u, 0.05 * u, 1.8 * u, 5), mats.dark, -0.42, 3.65, -1.9, 0, 0, 0.1, parts.spires);
  add(new THREE.CylinderGeometry(0.05 * u, 0.05 * u, 1.3 * u, 5), mats.dark, 0.42, 3.4, -2.4, 0, 0, -0.14, parts.spires);
  // the tower's sensor eye
  add(new THREE.SphereGeometry(0.22 * u, 8, 6), glowMat, 0, 2.5, -1.32);   // bridge eye
  // asymmetric vanes (this is not a Federation silhouette)
  box(0.12, 1.1, 0.9, mats.trim, -1.35, 1.9, -2.4, 0, 0, 0.5);
  box(0.12, 0.8, 0.7, mats.trim, 1.3, 1.75, -2.7, 0, 0, -0.42);

  /* --------------------------------------------------------- engine block */
  box(4.2, 1.7, 1.3, mats.armor, 0, 0, -4.1);
  box(4.6, 0.42, 0.6, mats.plate, 0, 0.05, -4.65);
  for (const x of [-1.35, 1.35]) {
    for (const y of [-0.42, 0.42]) {
      add(new THREE.CylinderGeometry(0.42 * u, 0.5 * u, 1.0 * u, 8), mats.dark, x, y, -4.9, Math.PI / 2, 0, 0, parts.nozzles);
      add(new THREE.CylinderGeometry(0.34 * u, 0.34 * u, 0.16 * u, 8), glowMat, x, y, -5.45, Math.PI / 2, 0, 0, parts.nozzles);
    }
  }
  // exposed truss ribs over the stern
  for (let i = 0; i < 5; i += 1) {
    box(4.35, 0.1, 0.22, mats.plate, 0, 0.9, -3.0 - i * 0.55, 0, 0, 0, parts.ribs);
  }

  /* ------------------------------------------------------- ventral hangar maw */
  box(2.3, 0.5, 2.5, mats.dark, 0, -0.85, 0.3);
  box(1.9, 0.14, 2.0, glowMat, 0, -1.02, 0.3);
  for (const side of [-1, 1]) {
    box(0.24, 0.6, 2.6, mats.trim, side * 1.2, -0.85, 0.3);
    // forward landing claws
    add(new THREE.ConeGeometry(0.22 * u, 1.4 * u, 4), mats.dark, side * 0.95, -1.0, 2.4, 0.6, 0, side * 0.3);
  }

  /* -------------------------------------------------------- running lights */
  for (let i = 0; i < 6; i += 1) {
    const z = -2.6 + i * 1.15;
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.12 * u, 0.12 * u, 0.3 * u), glowMat, side * 1.86, 0.42, z, 0, 0, 0, parts.lights);
    }
  }

  /* -------------------------------------------------------------- greebles */
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 14; i += 1) {
    const w = 0.18 + rand() * 0.42;
    const h = 0.1 + rand() * 0.26;
    const d = 0.2 + rand() * 0.5;
    const x = (rand() - 0.5) * 3.0;
    const y = rand() > 0.5 ? 0.85 : -0.62;
    const z = -3.4 + rand() * 6.6;
    box(w, h, d, i % 3 === 0 ? mats.trim : mats.dark, x, y, z, 0, 0, 0, parts.greebles);
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = {
    kind: 'reaver',
    size,
    parts,
    glow: glowMat,
    glowMats: [glowMat, coreMat],
    core,
    lights: parts.lights,
    meshes: g.children.length,
  };
  return g;
}

/** How many meshes a given size yields — used by tests and the HUD-free preview. */
export function reaverMeshCount(THREE, size = 4.5) {
  let n = 0;
  buildReaverDreadnought(THREE, { size }).traverse((o) => { if (o.isMesh) n += 1; });
  return n;
}
