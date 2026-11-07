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
  constructor(tiers, opts = {}) {
    this.tiers = { saucer: 0, nacelles: 0, deflector: 0, weapons: 0 };
    if (tiers) Object.assign(this.tiers, tiers);
    // hull class bought in the shipyard; refits apply on top of it
    this.hullClass = opts.hullClass || 'enterprise';
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

  /**
   * UPGRADE ALL: buy every refit you can afford, component by component, while
   * the bank holds out. Returns what went in so the UI can show it off.
   */
  upgradeAll(bank) {
    const installed = [];
    const spent = {};
    let guard = 0;
    let progressed = true;
    while (progressed && guard++ < COMPONENTS.length * (MAX_TIER + 1)) {
      progressed = false;
      for (const c of COMPONENTS) {
        const next = this.next(c);
        if (!next || !this.canAfford(next.cost, bank || {})) continue;
        for (const [k, v] of Object.entries(next.cost)) {
          bank[k] -= v;
          spent[k] = (spent[k] || 0) + v;
        }
        this.tiers[c] += 1;
        installed.push({ component: c, tier: this.tiers[c], name: next.name });
        progressed = true;
      }
    }
    if (installed.length) this.recompute();
    return { installed, spent, ok: installed.length > 0 };
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
    // the bought hull changes the airframe under the same refit tree
    if (this.hullClass === 'aurora') {
      this.stats.maxSpeed *= 1.28;
      this.stats.turnRate *= 1.22;
      this.stats.fireRate *= 1.15;
      this.stats.hull = Math.round(this.stats.hull * 0.82);
    }
    return this.stats;
  }

  totalTier() { return COMPONENTS.reduce((n, c) => n + this.tiers[c], 0); }

  toJSON() { return { tiers: { ...this.tiers }, hullClass: this.hullClass }; }
  static fromJSON(d) { return new Enterprise(d && d.tiers, { hullClass: d && d.hullClass }); }
}

// ------------------------------------------------------------------ palettes
// Each refit looks different on screen — that is the "cinematic tier" promise.
const HULL_TONES = ['#d3dce5', '#e0e5ec', '#c7d0da', '#b2bcc7', '#9faab6'];
const ACCENTS = ['#f6c453', '#f6c453', '#e0e7ef', '#cfd6de', '#ff5b6e'];
const NACELLE_GLOW = ['#57c7ff', '#57c7ff', '#7c5bff', '#ff4d6d', '#7cf0ff'];
const NACELLE_CORE = ['#dff3ff', '#dff3ff', '#e6dcff', '#ffe1e6', '#e8ffff'];

function standard(THREE, color, opts = {}) {
  // NOTE: the scene has no environment map, so high metalness would render the
  // hull almost black (PBR metal has nothing to reflect). Keep it low and let
  // the hemisphere + sun lights do the work.
  return new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.52, metalness: opts.metalness ?? 0.28,
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
  // the hull is modelled dish-first along -Z; the flight model moves along +Z,
  // so the whole body hangs off a flipped group and the ship flies nose-first.
  const body = new THREE.Group();
  body.name = 'hull';
  body.rotation.y = Math.PI;
  root.add(body);
  const parts = {
    nacelles: [], banks: [], dish: null, torpedo: null, shieldBubble: null, lights: [],
    impulse: [], grilles: [], exhaust: [], runningLights: [], shuttlebay: null,
  };
  root.userData.parts = parts;

  const hullMat = standard(THREE, hullColor, { roughness: 0.46, metalness: 0.3 });
  const panelMat = standard(THREE, HULL_TONES[Math.min(HULL_TONES.length - 1, t.saucer + 1)], { roughness: 0.58, metalness: 0.24 });
  const darkMat = standard(THREE, '#4a5666', { roughness: 0.62, metalness: 0.3 });
  const accentMat = standard(THREE, accent, { roughness: 0.34, metalness: 0.4, emissive: accent, emissiveIntensity: 0.22 });
  const windowMat = glow(THREE, '#ffe3a8', 0.95);
  const add = (mesh, parent = body) => { parent.add(mesh); return mesh; };

  // ------------------------------------------------------------ proportions
  const R = 7.6 * st.saucerScale;          // saucer radius
  const SCH = -5.4;                        // saucer centre, forward of the origin
  const SY = 1.32;                         // saucer mid-plane height
  const HR = 2.05;                         // engineering hull radius
  const HY = -3.6;                         // engineering hull centre height
  const HL = 10.8 + t.saucer * 0.7;        // engineering hull length
  const HZ = 5.6;                          // engineering hull centre, aft
  const NY = HY + 4.7 + t.nacelles * 0.08; // nacelle centre height
  const NX = R * 0.98 + 2.35;              // nacelle centre, outboard
  const NZ = HZ + 3.6;                     // nacelle centre, aft
  const NL = 9.2 * st.nacelleScale;        // nacelle length
  const NR = 0.9 * st.nacelleScale;        // nacelle radius

  // ---------------------------------------------------------------- saucer
  // A lathed profile gives the class its real silhouette: a domed B-deck
  // plateau, a sharp rim and an undercut lower hull — not a flat disc.
  const saucer = new THREE.Group();
  saucer.name = 'saucer';
  saucer.position.set(0, SY, SCH);
  const profile = [
    [0.00, 1.60], [0.22, 1.60], [0.36, 1.57], [0.42, 1.44],
    [0.56, 1.35], [0.70, 1.18], [0.82, 0.96], [0.92, 0.62],
    [0.995, 0.40], [1.00, 0.26], [1.00, 0.02], [0.985, -0.06], [0.94, -0.20],
    [0.84, -0.42], [0.68, -0.66], [0.48, -0.84], [0.24, -0.94], [0.00, -0.98],
  ].map(([r, y]) => new THREE.Vector2(r * R, y * (R / 7.6)));
  const saucerHull = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), hullMat);
  saucer.add(saucerHull);

  // rim band + undercut shadow line
  const rimBand = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.001, R * 1.001, 0.16 * (R / 7.6), 96, 1, true), accentMat);
  rimBand.position.y = 0.14 * (R / 7.6);
  saucer.add(rimBand);
  const rimLip = new THREE.Mesh(new THREE.TorusGeometry(R * 0.955, 0.075 * (R / 7.6), 8, 72), darkMat);
  rimLip.rotation.x = Math.PI / 2;
  rimLip.position.y = -0.06 * (R / 7.6);
  saucer.add(rimLip);

  // concentric deck seams: cheap detail that reads as hull plating from afar
  for (const seamR of [0.30, 0.62, 0.78]) {
    const seam = new THREE.Mesh(new THREE.TorusGeometry(R * seamR, 0.022 * (R / 7.6), 6, 72), darkMat);
    seam.rotation.x = Math.PI / 2;
    // follow the lathe profile so the seam lies on the skin
    let y = 1.6;
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1], b = profile[i];
      if (seamR * R <= b.x || i === profile.length - 1) { y = b.y + 0.015 * (R / 7.6); break; }
    }
    seam.position.y = y;
    saucer.add(seam);
  }

  // B-deck plateau: the raised deck the bridge sits on
  const plateau = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.44, R * 0.50, 0.30 * (R / 7.6), 56, 1), hullMat);
  plateau.position.y = 1.66 * (R / 7.6);
  saucer.add(plateau);
  const plateauRing = new THREE.Mesh(new THREE.TorusGeometry(R * 0.47, 0.045 * (R / 7.6), 8, 64), accentMat);
  plateauRing.rotation.x = Math.PI / 2;
  plateauRing.position.y = 1.79 * (R / 7.6);
  saucer.add(plateauRing);

  // bridge module + dome + sensor pod
  const bridge = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.19, R * 0.22, 0.22 * (R / 7.6), 32, 1), hullMat);
  bridge.position.y = 1.93 * (R / 7.6);
  saucer.add(bridge);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R * 0.185, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), panelMat);
  dome.position.y = 2.04 * (R / 7.6);
  saucer.add(dome);
  const sensorPod = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.05, R * 0.06, 0.1 * (R / 7.6), 12, 1), darkMat);
  sensorPod.position.set(0, 2.16 * (R / 7.6), 0);
  saucer.add(sensorPod);

  // impulse engine block on the aft edge of the saucer
  const impulseHouse = new THREE.Mesh(new THREE.BoxGeometry(R * 0.52, 0.3 * (R / 7.6), 0.9 * (R / 7.6)), panelMat);
  impulseHouse.position.set(0, 1.12 * (R / 7.6), R * 0.80);
  saucer.add(impulseHouse);
  for (let i = 0; i < 2; i++) {
    const port = new THREE.Mesh(new THREE.BoxGeometry(R * 0.2, 0.16 * (R / 7.6), 0.1), glow(THREE, '#ff8a4c', 0.92));
    port.position.set((i ? 1 : -1) * R * 0.13, 1.12 * (R / 7.6), R * 0.80 + 0.46 * (R / 7.6));
    saucer.add(port);
    parts.impulse.push(port);
  }

  // phaser bank strips spread around the rim as banks unlock (360° coverage)
  const bankCount = st.banks;
  for (let i = 0; i < bankCount; i++) {
    const a = (i / bankCount) * Math.PI * 2;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.16, 0.34), glow(THREE, '#8ef2ff'));
    strip.position.set(Math.cos(a) * R * 0.965, 0.34 * (R / 7.6), Math.sin(a) * R * 0.965);
    strip.rotation.y = -a;
    strip.rotation.z = 0.1;
    saucer.add(strip);
    parts.banks.push(strip);
  }

  // lit window rows: two thin solid rings read as hundreds of cabins
  for (let i = 0; i < 2; i++) {
    const rowR = R * (0.80 + i * 0.10);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(rowR, rowR, 0.075 * (R / 7.6), 64, 1, true), windowMat);
    band.position.y = (0.52 + i * 0.01) * (R / 7.6);
    saucer.add(band);
    parts.lights.push(band);
  }
  // a handful of individual windows on the plateau face
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.09, 0.06), windowMat);
    w.position.set(Math.cos(a) * R * 0.52, 1.52 * (R / 7.6), Math.sin(a) * R * 0.52);
    w.rotation.y = -a;
    saucer.add(w);
  }
  body.add(saucer);

  // ------------------------------------------------------------------ neck
  // tapered pylon-neck sloping down and aft from the saucer to the hull.
  // Slim and blade-like: a fat wedge here buries the whole silhouette.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.95, 3.9, 4, 1), hullMat);
  neck.rotation.y = Math.PI / 4;
  neck.rotation.x = -0.5;
  neck.scale.set(1, 1, 1.55);
  neck.position.set(0, -0.95, 1.9);
  neck.name = 'neck';
  add(neck);
  // leading edge fairing that runs into the saucer
  const neckFin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 2.6), panelMat);
  neckFin.rotation.x = -0.5;
  neckFin.position.set(0, -0.35, 0.7);
  add(neckFin);
  const neckWindow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.9), windowMat);
  neckWindow.rotation.x = -0.52;
  neckWindow.position.set(0, -0.6, 0.9);
  add(neckWindow);
  parts.lights.push(neckWindow);

  // ------------------------------------------------------ engineering hull
  const eng = new THREE.Group();
  eng.name = 'engineering';
  eng.position.set(0, HY, HZ);
  const hullBody = new THREE.Mesh(new THREE.CapsuleGeometry(HR, HL, 14, 28), hullMat);
  hullBody.rotation.x = Math.PI / 2;
  eng.add(hullBody);

  // dorsal spine and plating bands break up the capsule
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.34, HL * 0.9), panelMat);
  spine.position.set(0, HR * 0.92, 0);
  eng.add(spine);
  for (let i = 0; i < 3; i++) {
    const bandR = HR * 1.005;
    const plate = new THREE.Mesh(new THREE.TorusGeometry(bandR, 0.055, 8, 40), darkMat);
    plate.rotation.x = Math.PI / 2;
    plate.position.z = -HL * 0.34 + i * (HL * 0.32);
    eng.add(plate);
  }
  // hull window rows
  for (let i = 0; i < 2; i++) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(HR * 1.004, HR * 1.004, 0.07, 40, 1, true), windowMat);
    band.rotation.x = Math.PI / 2;
    band.position.z = -HL * 0.05 + i * 0.6;
    eng.add(band);
    parts.lights.push(band);
  }

  // deflector housing at the bow of the hull
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(HR * 0.95, HR * 1.06, 1.15, 32, 1), panelMat);
  housing.rotation.x = Math.PI / 2;
  housing.position.z = -HL / 2 - 0.35;
  eng.add(housing);
  const housingRing = new THREE.Mesh(new THREE.TorusGeometry(HR * 0.97, 0.09, 8, 32), darkMat);
  housingRing.position.z = -HL / 2 - 0.9;
  eng.add(housingRing);

  // shuttlebay at the stern: recessed bay, two lit doors
  const bay = new THREE.Group();
  bay.position.set(0, 0.15, HL / 2 + HR * 0.55);
  const bayFrame = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.3, 0.5), panelMat);
  bay.add(bayFrame);
  for (let i = 0; i < 2; i++) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.95, 0.12), glow(THREE, '#ffd66b', 0.85));
    door.position.set((i ? 1 : -1) * 0.46, 0, 0.3);
    bay.add(door);
  }
  const bayLamp = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.1), glow(THREE, '#9df2ff'));
  bayLamp.position.set(0, 0.7, 0.3);
  bay.add(bayLamp);
  eng.add(bay);
  parts.shuttlebay = bay;

  // deflector dish: radius, ring count and colour all change with the tier
  const dishGroup = new THREE.Group();
  dishGroup.position.set(0, 0.05, -HL / 2 - 0.95);
  const dr = 1.08 * st.dishScale;
  const dishBack = new THREE.Mesh(new THREE.CylinderGeometry(dr * 1.12, dr * 1.12, 0.26, 32, 1), darkMat);
  dishBack.rotation.x = Math.PI / 2;
  dishGroup.add(dishBack);
  const dishFace = new THREE.Mesh(new THREE.SphereGeometry(dr, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2.3), glow(THREE, '#7fd8ff', 0.95));
  dishFace.rotation.x = -Math.PI / 2;
  dishFace.position.z = -0.12;
  dishGroup.add(dishFace);
  for (let i = 0; i < 1 + t.deflector; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(dr * (0.42 + i * 0.19), 0.075, 8, 34), glow(THREE, '#d5f6ff', 0.9));
    ring.position.z = -0.22 - i * 0.1;
    dishGroup.add(ring);
  }
  parts.dish = dishGroup;
  eng.add(dishGroup);
  body.add(eng);

  // ---------------------------------------------------------------- pylons
  const pylons = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const rootPt = new THREE.Vector3(side * HR * 0.7, HY + 0.75, HZ + 1.0);
    const tipPt = new THREE.Vector3(side * (NX - NR * 0.3), NY - NR * 0.75, NZ + 0.35);
    const dir = tipPt.clone().sub(rootPt);
    const len = dir.length();
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.5, len, 4, 1), hullMat);
    pylon.scale.z = 1.9;
    pylon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    pylon.position.copy(rootPt).addScaledVector(dir, 0.5);
    pylon.name = 'pylon' + i;
    add(pylon);
    pylons.push(pylon);
  }

  // -------------------------------------------------------------- nacelles
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const nac = new THREE.Group();
    nac.name = 'nacelle' + i;
    nac.position.set(side * NX, NY, NZ);

    // body
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(NR * 0.96, NR, NL, 28, 1), hullMat);
    tube.rotation.x = Math.PI / 2;
    nac.add(tube);
    // front collar
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(NR * 1.04, NR * 1.02, 0.35, 28, 1), panelMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = -NL / 2 + 1.5;
    nac.add(collar);

    // bussard collector (forward) — the orange-red intake
    const bussard = new THREE.Mesh(new THREE.SphereGeometry(NR * 0.98, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), glow(THREE, '#ff7340', 0.95));
    bussard.rotation.x = -Math.PI / 2;
    bussard.position.z = -NL / 2;
    nac.add(bussard);
    for (let c = 0; c < 3; c++) {
      const cage = new THREE.Mesh(new THREE.TorusGeometry(NR * (0.72 - c * 0.14), 0.035, 6, 24), darkMat);
      cage.position.z = -NL / 2 + 0.22 + c * 0.34;
      nac.add(cage);
    }

    // warp coils, brighter and more numerous with each refit
    const coils = [];
    const coilCount = 2 + t.nacelles;
    for (let c = 0; c < coilCount; c++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(NR * 1.02, 0.1, 8, 26), glow(THREE, nacGlow, 0.9));
      coil.position.z = -NL * 0.06 + c * (NL * 0.5 / coilCount);
      nac.add(coil);
      coils.push(coil);
    }
    // warp grille: a long glowing panel on the outboard flank
    const grille = new THREE.Mesh(
      new THREE.CylinderGeometry(NR * 1.03, NR * 1.03, NL * 0.62, 24, 1, true, side > 0 ? -0.55 : Math.PI - 0.55, 1.1),
      new THREE.MeshBasicMaterial({ color: nacGlow, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    grille.rotation.x = Math.PI / 2;
    grille.position.z = NL * 0.06;
    nac.add(grille);
    parts.grilles.push(grille);

    // stern cap + exhaust glow
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(NR * 1.02, NR * 0.72, 0.9, 24, 1), panelMat);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = NL / 2 + 0.2;
    nac.add(cap);
    const exhaust = new THREE.Mesh(new THREE.CircleGeometry(NR * 0.6, 24), glow(THREE, nacCore, 0.9));
    exhaust.position.z = NL / 2 + 0.66;
    nac.add(exhaust);
    parts.exhaust.push(exhaust);

    const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), glow(THREE, '#ffffff'));
    strobe.position.set(0, NR * 1.05, NL * 0.18);
    nac.add(strobe);
    parts.runningLights.push({ mesh: strobe, period: 1.4, phase: i * 0.7, color: '#ffffff' });

    parts.nacelles.push({ group: nac, coils, bussard });
    body.add(nac);
  }

  // --------------------------------------------------------- running lights
  const port = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), glow(THREE, '#ff4b4b'));
  port.position.set(-R * 0.97, 0.3, SCH);
  add(port);
  parts.runningLights.push({ mesh: port, period: 1.1, phase: 0, color: '#ff4b4b' });
  const starboard = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), glow(THREE, '#5cff9d'));
  starboard.position.set(R * 0.97, 0.3, SCH);
  add(starboard);
  parts.runningLights.push({ mesh: starboard, period: 1.1, phase: 0.55, color: '#5cff9d' });
  const mast = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), glow(THREE, '#ffffff'));
  mast.position.set(0, 2.2 * (R / 7.6) + SY, SCH);
  add(mast);
  parts.runningLights.push({ mesh: mast, period: 1.6, phase: 0.2, color: '#ffffff' });

  // --------------------------------------------------------------- weapons
  if (t.weapons >= 2) {
    // photon torpedo launcher in the neck fairing
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.7, 16, 1), darkMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, -0.55, SCH + R * 0.62);
    add(tube);
    const muzzle = new THREE.Mesh(new THREE.CircleGeometry(0.27, 16), glow(THREE, '#ffd166'));
    muzzle.position.set(0, -0.55, SCH + R * 0.62 - 0.87);
    add(muzzle);
    parts.torpedo = muzzle;
  }
  if (t.weapons >= 3) {
    // quantum spire array — four dorsal emitters
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.3, 8), glow(THREE, '#c0a8ff'));
      spire.position.set(Math.cos(a) * R * 0.55, 1.95 * (R / 7.6) + SY, SCH + Math.sin(a) * R * 0.55);
      add(spire);
    }
  }
  if (t.weapons >= 4) {
    // retractable pulse cannons under the saucer rim
    for (let i = 0; i < 2; i++) {
      const a = i ? 0.9 : -0.9;
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 1.5, 10, 1), darkMat);
      gun.rotation.x = Math.PI / 2;
      gun.position.set(Math.sin(a) * R * 0.7, SY - 0.55, SCH - Math.cos(a) * R * 0.7);
      add(gun);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), glow(THREE, '#ff9ad5'));
      tip.position.set(Math.sin(a) * R * 0.7, SY - 0.55, SCH - Math.cos(a) * R * 0.7 - 0.75);
      add(tip);
      parts.banks.push(tip);
    }
  }

  // ------------------------------------------------------- shield bubble
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(17 * (1 + t.deflector * 0.04), 28, 18),
    new THREE.MeshBasicMaterial({ color: '#5fb8ff', transparent: true, opacity: 0.09, wireframe: true, depthWrite: false }),
  );
  bubble.position.y = -0.6;
  bubble.visible = false;
  add(bubble);
  parts.shieldBubble = bubble;

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.userData.size = { saucerRadius: R, length: HZ + NL / 2 - (SCH - R) };
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
