// The Aurora-class courier — the hull you buy with credits earned flying the world.
//
// It is modelled nose-first along +Z to match the flight model, so unlike the
// Enterprise it needs no flipped body group. It exposes the same `userData.parts`
// contract as buildEnterprise(), so the renderer animates it with the same code.
//
// When the player drops the TurboSquid "Avrora" OBJ into skyuss/assets/premium/,
// premium.js parses it and `setPremium()` swaps the procedural skin for the real
// mesh while keeping the engine glows and running lights.

const HULL = '#4d80a8';
const HULL_LIGHT = '#8bb8d8';
const TRIM = '#e8b478';
const GLASS = '#16303f';
const ENGINE_GLOW = ['#7fe6ff', '#9fd0ff', '#b79cff', '#ffb066', '#ffffff'];
const ENGINE_CORE = ['#d8fbff', '#e6f1ff', '#efe4ff', '#ffe2c4', '#ffffff'];

export function buildAurora(THREE, ship) {
  const st = (ship && ship.stats) || {};
  const tier = (ship && ship.tiers && ship.tiers.nacelles) || 0;
  const speedScale = (st.maxSpeed || 34) / 34;

  const root = new THREE.Group();
  root.name = 'aurora';
  const body = new THREE.Group();
  body.name = 'aurora-hull';
  root.add(body);

  const parts = {
    nacelles: [], banks: [], dish: null, torpedo: null, shieldBubble: null, lights: [],
    impulse: [], grilles: [], exhaust: [], runningLights: [], shuttlebay: null,
  };
  root.userData.parts = parts;
  root.userData.hull = 'aurora';

  const hullMat = new THREE.MeshStandardMaterial({
    color: HULL, roughness: 0.52, metalness: 0.28, flatShading: false,
  });
  const lightMat = new THREE.MeshStandardMaterial({
    color: HULL_LIGHT, roughness: 0.44, metalness: 0.34,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: TRIM, roughness: 0.36, metalness: 0.62,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: '#2b3d4d', roughness: 0.62, metalness: 0.3,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: GLASS, roughness: 0.12, metalness: 0.7,
    emissive: new THREE.Color('#5fd0ff'), emissiveIntensity: 0.22,
    transparent: true, opacity: 0.86,
  });
  const glowMat = () => new THREE.MeshStandardMaterial({
    color: ENGINE_CORE[tier], emissive: new THREE.Color(ENGINE_GLOW[tier]),
    emissiveIntensity: 2.6, transparent: true, opacity: 0.92,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  const add = (geo, mat, x = 0, y = 0, z = 0, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // ---------------------------------------------------------------- fuselage
  const profile = [
    [0, -15.2], [1.0, -14.4], [2.1, -11.0], [2.75, -6.0], [2.95, -1.0],
    [2.8, 3.4], [2.2, 7.6], [1.35, 10.8], [0.45, 13.2], [0, 14.2],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const hull = new THREE.Mesh(new THREE.LatheGeometry(profile, 26), hullMat);
  hull.rotation.x = Math.PI / 2;          // lay the lathe axis along +Z
  body.add(hull);

  // dorsal spine
  const spine = add(new THREE.BoxGeometry(1.15, 0.55, 17.5), lightMat, 0, 2.35, -2.2);
  spine.rotation.x = -0.02;
  // ventral keel
  add(new THREE.BoxGeometry(0.9, 0.45, 12.5), darkMat, 0, -2.45, -3.0);

  // ------------------------------------------------------------- bow prongs
  // two swept blades that give the courier its arrowhead read
  for (const s of [-1, 1]) {
    const prong = add(new THREE.BoxGeometry(0.95, 0.62, 12.2), lightMat, s * 3.9, -0.15, 4.2);
    prong.rotation.y = s * 0.17;                        // forward-swept blade
    prong.rotation.z = s * 0.12;
    // titanium edge along the leading side
    const edge = add(new THREE.BoxGeometry(0.22, 0.16, 11.6), trimMat, s * 4.42, 0.14, 4.3);
    edge.rotation.y = s * 0.17;
    edge.rotation.z = s * 0.12;
    // prong tip light, sitting exactly on the blade tip
    const tip = add(new THREE.SphereGeometry(0.3, 10, 8), glowMat(), s * 5.92, 0.02, 10.25);
    tip.userData.tip = true;
    parts.runningLights.push(tip);
    // phaser bank tucked under the blade
    const bank = add(new THREE.BoxGeometry(0.5, 0.3, 2.0), trimMat, s * 2.9, -1.5, 5.6);
    bank.visible = false;
    parts.banks.push(bank);
  }

  // ---------------------------------------------------------------- cockpit
  const canopy = add(new THREE.SphereGeometry(1.75, 18, 14), glassMat, 0, 1.55, 6.4);
  canopy.scale.set(0.95, 0.55, 1.75);
  // canopy frame
  add(new THREE.TorusGeometry(1.62, 0.09, 6, 22), trimMat, 0, 1.62, 7.9).rotation.x = Math.PI / 2;

  // ---------------------------------------------------------------- engines
  for (const s of [-1, 1]) {
    const x = s * 2.75;
    // nacelle body
    const nac = add(new THREE.CylinderGeometry(1.18, 1.05, 8.4, 18), lightMat, x, -0.55, -9.4);
    nac.rotation.x = Math.PI / 2;
    parts.nacelles.push(nac);
    // housing collar
    const collar = add(new THREE.CylinderGeometry(1.34, 1.34, 1.5, 18), darkMat, x, -0.55, -6.2);
    collar.rotation.x = Math.PI / 2;
    // intake ring at the front of the nacelle
    const intake = add(new THREE.TorusGeometry(1.1, 0.14, 8, 20), trimMat, x, -0.55, -5.4);
    // glowing grille along the flank
    const grille = add(new THREE.BoxGeometry(0.34, 0.16, 6.2), glowMat(), x + s * 1.0, 0.35, -9.6);
    grille.material.opacity = 0.7;
    parts.grilles.push(grille);
    // exhaust disc
    const exhaust = add(new THREE.CircleGeometry(0.95, 20), glowMat(), x, -0.55, -13.6);
    exhaust.rotation.y = Math.PI;
    parts.exhaust.push(exhaust);
    // pylon holding the nacelle to the hull
    const pylon = add(new THREE.BoxGeometry(1.9, 0.32, 3.2), lightMat, s * 1.9, -0.4, -7.4);
    pylon.rotation.z = s * 0.12;
    // impulse port on the stern
    const imp = add(new THREE.SphereGeometry(0.42, 10, 8), glowMat(), s * 1.15, 0.4, -13.0);
    parts.impulse.push(imp);
  }

  // ------------------------------------------------------------------- fins
  const fin = add(new THREE.BoxGeometry(0.32, 2.9, 5.6), hullMat, 0, 3.1, -9.2);
  fin.rotation.x = 0.16;
  add(new THREE.BoxGeometry(0.26, 0.5, 4.6), trimMat, 0, 4.35, -9.5).rotation.x = 0.16;
  const vfin = add(new THREE.BoxGeometry(0.3, 1.9, 4.2), darkMat, 0, -3.0, -8.6);
  vfin.rotation.x = -0.2;

  // -------------------------------------------------------- torpedo launcher
  const tube = add(new THREE.CylinderGeometry(0.34, 0.3, 3.0, 14), darkMat, 0, -0.15, 12.4);
  tube.rotation.x = Math.PI / 2;
  const muzzle = add(new THREE.CircleGeometry(0.3, 14), trimMat, 0, -0.15, 13.9);
  muzzle.visible = false;
  parts.torpedo = muzzle;

  // ------------------------------------------------------------- hull lights
  // windows down both flanks, so the silhouette reads at distance
  for (let i = 0; i < 7; i++) {
    const z = 5.2 - i * 2.1;
    for (const s of [-1, 1]) {
      const w = add(new THREE.SphereGeometry(0.14, 6, 5), glowMat(), s * (2.55 - i * 0.06), 0.7, z);
      w.material.opacity = 0.85;
      parts.lights.push(w);
    }
  }
  // running lights: port red, starboard green, plus a mast strobe
  const port = add(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: '#ff5b6b', emissive: new THREE.Color('#ff2b45'), emissiveIntensity: 2.4 }), -2.95, 0.1, -1.2);
  const starboard = add(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: '#6bffa8', emissive: new THREE.Color('#2bff86'), emissiveIntensity: 2.4 }), 2.95, 0.1, -1.2);
  const strobe = add(new THREE.SphereGeometry(0.18, 8, 6), glowMat(), 0, 4.7, -9.6);
  parts.runningLights.push(port, starboard, strobe);

  // ------------------------------------------------------------ shield bubble
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(14.5, 26, 18),
    new THREE.MeshBasicMaterial({
      color: '#6fd7ff', transparent: true, opacity: 0.08,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  bubble.visible = false;
  root.add(bubble);
  parts.shieldBubble = bubble;

  // subtle scale so a refitted courier reads bigger on screen
  root.scale.setScalar(0.92 + 0.06 * tier);
  root.userData.speedScale = speedScale;

  /**
   * Swap the procedural skin for a real mesh (the bought TurboSquid hull).
   * The glows, shield bubble and lights stay, so gameplay reads the same.
   */
  root.userData.setPremium = (mesh, opts = {}) => {
    if (!mesh) return false;
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const target = opts.length || 30;                      // metres nose to stern
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const k = target / longest;
    mesh.scale.setScalar(k);
    box.setFromObject(mesh);
    const centre = box.getCenter(new THREE.Vector3());
    mesh.position.sub(centre);                             // centre on the hull origin
    body.visible = false;                                  // hide the placeholder
    root.add(mesh);
    root.userData.premium = true;
    return true;
  };

  return root;
}
