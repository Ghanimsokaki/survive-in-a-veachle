// The modular USS Enterprise.
//
// `Enterprise` owns the tier array and all derived stats; `buildEnterprise`
// turns those tiers into an actual Three.js object graph. Nothing in this file
// touches a WebGL context, so it can be exercised headlessly (see
// tools/skyuss-smoke.mjs) — geometry and materials are plain CPU objects until
// a renderer draws them.

import { SHIP_UPGRADES, SHIP_TIERS, SHIP_BASE } from './config.js';

export const COMPONENTS = ['saucer', 'nacelles', 'deflector', 'weapons'];
export const MAX_TIER = 4;

export class Enterprise {
  constructor(tiers) {
    this.tiers = { saucer: 0, nacelles: 0, deflector: 0, weapons: 0 };
    if (tiers) Object.assign(this.tiers, tiers);
    this.stats = {};
    this.recompute();
  }

  tier(component) { return this.tiers[component] || 0; }

  /** def for the tier we are on, and the one we could buy next (null at max) */
  current(component) { return SHIP_UPGRADES[component][this.tiers[component]]; }
  next(component) {
    const t = this.tiers[component];
    return t >= MAX_TIER ? null : SHIP_UPGRADES[component][t + 1];
  }

  nextCost(component) {
    const n = this.next(component);
    return n ? { ...n.cost } : null;
  }

  canAfford(cost, bank) {
    if (!cost) return false;
    return Object.entries(cost).every(([k, v]) => (bank[k] || 0) >= v);
  }

  /**
   * The public upgrade API: upgradeShip('weapons') → spends from `bank`.
   * Returns { ok, reason, tier, name } so the UI can toast something useful.
   */
  upgradeShip(component, bank) {
    if (!COMPONENTS.includes(component)) return { ok: false, reason: 'unknown component' };
    const next = this.next(component);
    if (!next) return { ok: false, reason: 'already at the final refit', tier: this.tiers[component] };
    if (!this.canAfford(next.cost, bank || {})) return { ok: false, reason: 'not enough resources' };
    for (const [k, v] of Object.entries(next.cost)) bank[k] -= v;
    this.tiers[component] += 1;
    this.recompute();
    return { ok: true, tier: this.tiers[component], name: next.name, component };
  }

  /** Derive every gameplay stat from the installed tiers. */
  recompute() {
    const saucer = SHIP_UPGRADES.saucer[this.tiers.saucer];
    const nac = SHIP_UPGRADES.nacelles[this.tiers.nacelles];
    const def = SHIP_UPGRADES.deflector[this.tiers.deflector];
    const wep = SHIP_UPGRADES.weapons[this.tiers.weapons];
    this.stats = {
      hull: SHIP_BASE.hull + this.tiers.saucer * 90 + this.tiers.deflector * 40,
      energy: SHIP_BASE.energy + this.tiers.deflector * 12,
      energyRegen: SHIP_BASE.energyRegen + this.tiers.deflector * 1.5,
      maxSpeed: nac.maxSpeed,
      turnRate: nac.turnRate,
      warpCd: nac.warpCd,
      crew: saucer.crew,
      banks: saucer.banks,
      maxShields: def.maxShields + saucer.shieldCap,
      shieldRegen: def.regen,
      tractor: def.tractor,
      weaponDamage: wep.weaponDamage,
      fireRate: wep.fireRate,
      lockCone: wep.lockCone,
      torpedoes: this.tiers.weapons >= 2,
      // presentation scale for the renderer
      saucerScale: 1 + this.tiers.saucer * 0.085,
      nacelleScale: 1 + this.tiers.nacelles * 0.11,
      dishScale: 1 + this.tiers.deflector * 0.13,
      refit: this.tiers.saucer + this.tiers.nacelles + this.tiers.deflector + this.tiers.weapons,
    };
    return this.stats;
  }

  totalTier() { return COMPONENTS.reduce((n, c) => n + this.tiers[c], 0); }

  toJSON() { return { tiers: { ...this.tiers } }; }
  static fromJSON(d) { return new Enterprise(d && d.tiers); }
}

// ------------------------------------------------------------------ palettes
// Each refit looks different on screen — that is the "cinematic tier" promise.
const HULL_TONES = ['#c9d3dd', '#d8dde4', '#b9c2cc', '#9aa4ae', '#8b95a1'];
const ACCENTS = ['#f6c453', '#f6c453', '#e0e7ef', '#cfd6de', '#ff5b6e'];
const NACELLE_GLOW = ['#57c7ff', '#57c7ff', '#7c5bff', '#ff4d6d', '#7cf0ff'];
const NACELLE_CORE = ['#dff3ff', '#dff3ff', '#e6dcff', '#ffe1e6', '#e8ffff'];

function standard(THREE, color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.45, metalness: opts.metalness ?? 0.65,
    emissive: opts.emissive ?? '#000000', emissiveIntensity: opts.emissiveIntensity ?? 1,
    flatShading: !!opts.flat,
  });
}

function glow(THREE, color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false });
}

/**
 * Build (or rebuild) the Enterprise mesh for the installed tiers.
 * Returns a Group carrying `userData.parts` — live references the renderer
 * animates (nacelle glow pulse, phaser bank muzzle points, dish spin).
 */
export function buildEnterprise(THREE, ship) {
  const t = ship.tiers;
  const st = ship.stats;
  const hullColor = HULL_TONES[t.saucer];
  const accent = ACCENTS[t.saucer];
  const nacGlow = NACELLE_GLOW[t.nacelles];
  const nacCore = NACELLE_CORE[t.nacelles];

  const root = new THREE.Group();
  root.name = 'enterprise';
  const parts = {
    nacelles: [], banks: [], dish: null, torpedo: null, shieldBubble: null, lights: [],
  };
  root.userData.parts = parts;

  const hullMat = standard(THREE, hullColor, { roughness: 0.38, metalness: 0.7 });
  const darkMat = standard(THREE, '#3c4652', { roughness: 0.55, metalness: 0.6 });
  const accentMat = standard(THREE, accent, { roughness: 0.35, metalness: 0.8, emissive: accent, emissiveIntensity: 0.12 });

  const add = (mesh, parent = root) => { parent.add(mesh); return mesh; };

  // ---------------------------------------------------------------- saucer
  const saucer = new THREE.Group();
  saucer.name = 'saucer';
  const sr = 7.4 * st.saucerScale;
  const saucerBody = add(new THREE.Mesh(new THREE.CylinderGeometry(sr, sr * 0.92, 1.5, 48, 1), hullMat), saucer);
  saucerBody.position.y = 1.1;
  const rim = add(new THREE.Mesh(new THREE.TorusGeometry(sr * 0.99, 0.34, 10, 56), accentMat), saucer);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.1;
  const upper = add(new THREE.Mesh(new THREE.CylinderGeometry(sr * 0.55, sr * 0.95, 1.1, 40, 1), hullMat), saucer);
  upper.position.y = 2.3;
  const bridge = add(new THREE.Mesh(new THREE.SphereGeometry(sr * 0.24, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), hullMat), saucer);
  bridge.position.y = 2.95;
  // an extra command tier appears with every saucer refit
  for (let i = 0; i < t.saucer; i++) {
    const ring = add(new THREE.Mesh(new THREE.CylinderGeometry(sr * (0.72 - i * 0.07), sr * (0.78 - i * 0.07), 0.5, 32, 1), i % 2 ? darkMat : hullMat), saucer);
    ring.position.y = 3.15 + i * 0.42;
  }
  // phaser bank strips spread around the rim as banks unlock (360° coverage)
  const bankCount = st.banks;
  for (let i = 0; i < bankCount; i++) {
    const a = (i / bankCount) * Math.PI * 2;
    const strip = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 0.42), glow(THREE, '#8ef2ff')), saucer);
    strip.position.set(Math.cos(a) * sr * 0.94, 0.55, Math.sin(a) * sr * 0.94);
    strip.rotation.y = -a;
    parts.banks.push(strip);
  }
  add(saucer);

  // ------------------------------------------------------------------ neck
  const neck = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.4, 3.2), darkMat));
  neck.position.set(0, -0.9, 1.1);
  neck.rotation.x = -0.16;

  // ------------------------------------------------- engineering hull + dish
  const eng = new THREE.Group();
  eng.name = 'engineering';
  const hullLen = 9.4 + t.saucer * 0.5;
  const hullR = 2.35;
  const body = add(new THREE.Mesh(new THREE.CapsuleGeometry(hullR, hullLen, 12, 24), hullMat), eng);
  body.rotation.x = Math.PI / 2;
  body.position.set(0, -2.7, 0.6);
  const belly = add(new THREE.Mesh(new THREE.CylinderGeometry(hullR * 0.72, hullR * 0.5, 3.2, 20, 1), darkMat), eng);
  belly.rotation.x = Math.PI / 2;
  belly.position.set(0, -4.2, -1.4);

  // deflector dish: radius, ring count and colour all change with the tier
  const dishGroup = new THREE.Group();
  dishGroup.position.set(0, -3.1, -3.1);
  const dr = 1.15 * st.dishScale;
  const dishBack = add(new THREE.Mesh(new THREE.CylinderGeometry(dr * 1.08, dr * 1.08, 0.3, 28, 1), darkMat), dishGroup);
  dishBack.rotation.x = Math.PI / 2;
  const dishFace = add(new THREE.Mesh(new THREE.SphereGeometry(dr, 26, 16, 0, Math.PI * 2, 0, Math.PI / 2.4), glow(THREE, '#7fd8ff')), dishGroup);
  dishFace.rotation.x = -Math.PI / 2;
  dishFace.position.z = -0.1;
  for (let i = 0; i < 1 + t.deflector; i++) {
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(dr * (0.45 + i * 0.18), 0.09, 8, 30), glow(THREE, '#d5f6ff')), dishGroup);
    ring.rotation.x = 0;
    ring.position.z = -0.2 - i * 0.12;
  }
  parts.dish = dishGroup;
  eng.add(dishGroup);
  add(eng);

  // ------------------------------------------------------------- nacelles
  const nacCount = 2;
  for (let i = 0; i < nacCount; i++) {
    const side = i === 0 ? -1 : 1;
    const nac = new THREE.Group();
    nac.name = 'nacelle' + i;
    const nl = 7.6 * st.nacelleScale;
    const nr = 0.95 * st.nacelleScale;
    const x = side * (5.4 + t.nacelles * 0.42);
    const y = 1.9 + t.nacelles * 0.1;
    const z = 2.2;

    // variable-geometry pylons sweep up with the refits
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.34, 1.5), darkMat);
    pylon.position.set(side * 4.4, 0.55, z - 0.4);
    pylon.rotation.z = -side * (0.34 + t.nacelles * 0.05);
    pylon.rotation.y = side * 0.12;
    nac.add(pylon);

    const tube = new THREE.Mesh(new THREE.CapsuleGeometry(nr, nl, 10, 20), hullMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(x, y, z);
    nac.add(tube);

    // glowing warp coils, brighter with each tier
    const coils = 2 + t.nacelles;
    for (let c = 0; c < coils; c++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(nr * 1.02, 0.12, 8, 22), glow(THREE, nacGlow));
      coil.position.set(x, y, z + 1.4 - c * (nl / (coils + 0.4)));
      nac.add(coil);
    }
    const bussard = new THREE.Mesh(new THREE.SphereGeometry(nr * 0.92, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), glow(THREE, nacCore));
    bussard.rotation.x = -Math.PI / 2;
    bussard.position.set(x, y, z + nl / 2 + 0.2);
    nac.add(bussard);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(nr * 0.95, nr * 0.7, 0.9, 18, 1), accentMat);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(x, y, z - nl / 2 - 0.2);
    nac.add(cap);

    parts.nacelles.push({ group: nac, coils: nac.children.filter((m) => m.material && m.material.isMeshBasicMaterial), bussard });
    add(nac);
  }

  // --------------------------------------------------------------- weapons
  if (t.weapons >= 2) {
    // photon torpedo launcher under the saucer
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.6, 14, 1), darkMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, -0.9, sr * 0.55);
    add(tube);
    const muzzle = new THREE.Mesh(new THREE.CircleGeometry(0.34, 14), glow(THREE, '#ffd166'));
    muzzle.position.set(0, -0.9, sr * 0.55 + 0.82);
    muzzle.rotation.y = Math.PI;
    add(muzzle);
    parts.torpedo = muzzle;
  }
  if (t.weapons >= 3) {
    // quantum spire array — four dorsal emitters
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.5, 8), glow(THREE, '#c0a8ff'));
      spire.position.set(Math.cos(a) * sr * 0.62, 3.1, Math.sin(a) * sr * 0.62);
      add(spire);
    }
  }
  // windows: tiny emissive studs; more of them as the crew grows
  const winCount = 14 + st.crew * 3;
  for (let i = 0; i < winCount; i++) {
    const a = (i / winCount) * Math.PI * 2;
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.1), glow(THREE, '#ffe9b0'));
    w.position.set(Math.cos(a) * sr * 0.93, 0.85 + (i % 3) * 0.12, Math.sin(a) * sr * 0.93);
    w.rotation.y = -a;
    add(w);
    parts.lights.push(w);
  }

  // ------------------------------------------------------- shield bubble
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(15 * (1 + t.deflector * 0.05), 24, 16),
    new THREE.MeshBasicMaterial({ color: '#5fb8ff', transparent: true, opacity: 0.09, wireframe: true, depthWrite: false }),
  );
  bubble.position.y = 0.4;
  bubble.visible = false;
  add(bubble);
  parts.shieldBubble = bubble;

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.userData.size = { saucerRadius: sr, length: hullLen + 8 };
  return root;
}

/** Convenience: everything the tier screen needs to draw a row. */
export function tierRows(ship) {
  return COMPONENTS.map((c) => {
    const def = SHIP_TIERS[c];
    return {
      component: c,
      label: def.label,
      icon: def.icon,
      desc: def.desc,
      tier: ship.tier(c),
      max: MAX_TIER,
      name: ship.current(c).name,
      nextName: ship.next(c) ? ship.next(c).name : null,
      cost: ship.nextCost(c),
      stats: Object.fromEntries(def.keys.map((k) => [k, ship.stats[k]])),
    };
  });
}
