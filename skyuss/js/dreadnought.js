// Kang-class dreadnought — the second hull the shipyard sells, and the stand-in
// that flies until the player drops their own bought mesh into
// skyuss/assets/premium/ (see js/premium.js).
//
// Same contract as buildEnterprise()/buildAurora(): nose down +Z, userData.parts
// with nacelles/banks/grilles/exhaust/impulse/runningLights/shieldBubble, so the
// renderer animates every hull with one code path.

const HULL = '#4a4f57';
const HULL_LIGHT = '#6d747e';
const ARMOUR = '#33383f';
const TRIM = '#b1543f';
const GLOW = '#ff7a4d';
const CORE = '#ffd9b0';

export function buildDreadnought(THREE, ship) {
  const tier = (ship && ship.tiers && ship.tiers.nacelles) || 0;

  const root = new THREE.Group();
  root.name = 'dreadnought';
  const body = new THREE.Group();
  body.name = 'kang-hull';
  root.add(body);

  const parts = {
    nacelles: [], banks: [], dish: null, torpedo: null, shieldBubble: null, lights: [],
    impulse: [], grilles: [], exhaust: [], runningLights: [], shuttlebay: null,
  };
  root.userData.parts = parts;
  root.userData.hull = 'kang';

  const mats = {
    hull: new THREE.MeshStandardMaterial({ color: HULL, roughness: 0.62, metalness: 0.35 }),
    light: new THREE.MeshStandardMaterial({ color: HULL_LIGHT, roughness: 0.5, metalness: 0.42 }),
    armour: new THREE.MeshStandardMaterial({ color: ARMOUR, roughness: 0.72, metalness: 0.3 }),
    trim: new THREE.MeshStandardMaterial({ color: TRIM, roughness: 0.4, metalness: 0.55 }),
  };
  const glow = () => new THREE.MeshStandardMaterial({
    color: CORE, emissive: new THREE.Color(GLOW), emissiveIntensity: 2.2,
    transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  });

  const add = (geo, mat, x = 0, y = 0, z = 0, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // ---------------------------------------------------------------- main spine
  // A long armoured keel with a blunt ram bow: heavy, not graceful.
  const spine = add(new THREE.BoxGeometry(7.4, 4.2, 34), mats.hull, 0, 0, -1);
  spine.geometry.translate(0, 0, 0);
  // bow: chamfered wedge
  const bow = add(new THREE.ConeGeometry(4.6, 9, 4), mats.armour, 0, 0, 18.5);
  bow.rotation.x = Math.PI / 2;
  bow.rotation.z = Math.PI / 4;
  // dorsal armour plates
  for (let i = 0; i < 4; i++) {
    add(new THREE.BoxGeometry(6.2, 0.6, 5.4), mats.armour, 0, 2.4, 9 - i * 7.4);
  }
  // ventral keel
  add(new THREE.BoxGeometry(4.2, 1.2, 26), mats.armour, 0, -2.7, -2);

  // ------------------------------------------------------------- bridge tower
  const tower = add(new THREE.BoxGeometry(5.2, 3.4, 6.4), mats.light, 0, 3.8, -6);
  add(new THREE.BoxGeometry(4.4, 1.1, 5.2), mats.armour, 0, 5.7, -6.4);
  const bridge = add(new THREE.SphereGeometry(1.5, 14, 10), mats.trim, 0, 6.5, -7.2);
  bridge.scale.set(1.5, 0.55, 1.1);

  // ------------------------------------------------------------- side pods
  for (const s of [-1, 1]) {
    const pod = add(new THREE.BoxGeometry(4.6, 3.2, 20), mats.light, s * 8.2, -0.6, -4);
    add(new THREE.BoxGeometry(1.2, 0.7, 16), mats.armour, s * 8.2, 1.4, -4);
    // heavy banks along each pod
    for (let i = 0; i < 3; i++) {
      const bank = add(new THREE.BoxGeometry(0.7, 0.7, 2.4), mats.trim, s * 8.2, -1.9, 2 - i * 5.2);
      bank.visible = false;
      parts.banks.push(bank);
    }
    // pod running lights
    const nav = add(new THREE.SphereGeometry(0.3, 8, 6), glow(), s * 8.2, 1.9, 5.6);
    parts.runningLights.push(nav);
    // pod strut
    const strut = add(new THREE.BoxGeometry(4.2, 1.2, 3.2), mats.armour, s * 5.2, -0.6, 2);
    strut.rotation.z = s * 0.1;
  }

  // ---------------------------------------------------------------- nacelles
  // three of them: two outboard on swept pylons, one on the dorsal spine
  const layout = [
    { x: -12.6, y: 1.2, pylon: 1 },
    { x: 12.6, y: 1.2, pylon: 1 },
    { x: 0, y: 6.2, pylon: 0 },
  ];
  for (const L of layout) {
    const nac = add(new THREE.CylinderGeometry(1.7, 1.45, 15, 16), mats.light, L.x, L.y, -16);
    nac.rotation.x = Math.PI / 2;
    parts.nacelles.push(nac);
    // bussard-style intake
    const intake = add(new THREE.SphereGeometry(1.55, 14, 10), glow(), L.x, L.y, -8.4);
    intake.scale.set(1, 1, 0.7);
    // armoured cladding over the coil section
    add(new THREE.CylinderGeometry(1.9, 1.9, 7.5, 12, 1, true), mats.armour, L.x, L.y, -16.5).rotation.x = Math.PI / 2;
    // exhaust disc
    const ex = add(new THREE.CircleGeometry(1.35, 18), glow(), L.x, L.y, -23.6);
    ex.rotation.y = Math.PI;
    parts.exhaust.push(ex);
    // grille strip down the flank
    const grille = add(new THREE.BoxGeometry(0.4, 0.2, 11), glow(), L.x + Math.sign(L.x || 1) * 1.5, L.y + 0.5, -16);
    grille.material.opacity = 0.65;
    parts.grilles.push(grille);
    if (L.pylon) {
      const py = add(new THREE.BoxGeometry(Math.abs(L.x) - 4, 0.7, 4.6), mats.armour, L.x / 2, L.y - 0.4, -12);
      py.rotation.z = Math.sign(L.x) * 0.12;
    }
  }

  // -------------------------------------------------------- forward batteries
  // two torpedo tubes are the part you actually aim
  for (const s of [-1, 1]) {
    const tube = add(new THREE.CylinderGeometry(0.55, 0.5, 4.4, 12), mats.armour, s * 2.0, -0.6, 15.5);
    tube.rotation.x = Math.PI / 2;
  }
  const muzzle = add(new THREE.CircleGeometry(0.9, 14), glow(), 0, -0.6, 18.2);
  muzzle.visible = false;
  parts.torpedo = muzzle;
  // dorsal turret cluster
  for (let i = 0; i < 2; i++) {
    const turret = add(new THREE.CylinderGeometry(1.1, 1.3, 1.0, 10), mats.trim, (i - 0.5) * 2.6, 3.0, 2.5);
    parts.banks.push(turret);
    turret.visible = false;
  }

  // ------------------------------------------------------------ impulse ports
  for (const s of [-1, 1]) {
    const imp = add(new THREE.SphereGeometry(0.6, 10, 8), glow(), s * 2.2, 1.1, -18.4);
    parts.impulse.push(imp);
  }

  // -------------------------------------------------------------- hull lights
  for (let i = 0; i < 6; i++) {
    const z = 12 - i * 4.2;
    for (const s of [-1, 1]) {
      const w = add(new THREE.SphereGeometry(0.16, 6, 5), glow(), s * 3.6, 0.4, z);
      w.material.opacity = 0.8;
      parts.lights.push(w);
    }
  }
  const port = add(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshStandardMaterial({
    color: '#ff5b6b', emissive: new THREE.Color('#ff2b45'), emissiveIntensity: 2.2,
  }), -4.1, 0.8, -1);
  const starboard = add(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshStandardMaterial({
    color: '#6bffa8', emissive: new THREE.Color('#2bff86'), emissiveIntensity: 2.2,
  }), 4.1, 0.8, -1);
  parts.runningLights.push(port, starboard);

  // ------------------------------------------------------------ shield bubble
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(30, 26, 18),
    new THREE.MeshBasicMaterial({
      color: '#ffb27a', transparent: true, opacity: 0.07,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  bubble.visible = false;
  root.add(bubble);
  parts.shieldBubble = bubble;

  root.scale.setScalar(1.05 + 0.05 * tier);

  // hull skin hides when a real mesh loads; the glows keep burning
  const structural = new Set([mats.hull, mats.light, mats.armour, mats.trim]);
  root.userData.setPremium = (mesh, opts = {}) => {
    if (!mesh) return false;
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const target = opts.length || 62;
    mesh.scale.setScalar(target / (Math.max(size.x, size.y, size.z) || 1));
    box.setFromObject(mesh);
    mesh.position.sub(box.getCenter(new THREE.Vector3()));
    if (opts.rotY) mesh.rotation.y += opts.rotY;
    body.traverse((o) => { if (o.isMesh && structural.has(o.material)) o.visible = false; });
    root.add(mesh);
    root.userData.premium = true;
    return true;
  };

  return root;
}
