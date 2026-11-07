// Sky Fortress: a 12×12 holographic grid of sleek sci-fi platform pieces.
//
// Pure logic (placement rules, totals, turret fire) plus a Three.js mesh
// builder. The logic half is deliberately render-agnostic so it can be tested
// headlessly.

import { FORT, FORT_PIECES } from './config.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class SkyFort {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x; this.y = y; this.z = z;
    this.cells = new Map();          // "ix,iz" → cell
    this.hull = null;        // filled to hullMax by the first recompute
    this.shield = null;
    this.shieldMax = 0;
    this.cooldowns = new Map();      // turret key → seconds until next shot
    this.turretAngle = new Map();    // turret key → current aim yaw
    this.place(FORT.coreCell.ix, FORT.coreCell.iz, 'core', {}, { free: true });
  }

  key(ix, iz) { return ix + ',' + iz; }
  get(ix, iz) { return this.cells.get(this.key(ix, iz)) || null; }
  get size() { return FORT.size; }
  get count() { return this.cells.size; }

  worldPos(ix, iz) {
    const half = (FORT.size - 1) / 2;
    return {
      x: this.x + (ix - half) * FORT.cell,
      y: this.y,
      z: this.z + (iz - half) * FORT.cell,
    };
  }

  /** Why can / can't this piece go here? Returns { ok, reason }. */
  canPlace(ix, iz, kind, bank) {
    if (!Number.isInteger(ix) || !Number.isInteger(iz)) return { ok: false, reason: 'bad cell' };
    if (ix < 0 || iz < 0 || ix >= FORT.size || iz >= FORT.size) return { ok: false, reason: 'outside the grid' };
    if (!FORT_PIECES[kind]) return { ok: false, reason: 'unknown module' };
    if (this.get(ix, iz)) return { ok: false, reason: 'cell occupied' };
    if (this.count >= FORT.maxPieces) return { ok: false, reason: 'fortress at maximum size' };
    const touches = DIRS.some(([dx, dz]) => this.get(ix + dx, iz + dz));
    if (!touches) return { ok: false, reason: 'must connect to an existing deck' };
    const cost = FORT_PIECES[kind].cost || {};
    const missing = Object.entries(cost).filter(([k, v]) => ((bank && bank[k]) || 0) < v);
    if (missing.length) return { ok: false, reason: 'need ' + missing.map(([k, v]) => `${v} ${k}`).join(', ') };
    return { ok: true, reason: '' };
  }

  /** Place a piece and spend its cost from `bank`. */
  place(ix, iz, kind, bank = {}, opts = {}) {
    if (!opts.free) {
      const check = this.canPlace(ix, iz, kind, bank);
      if (!check.ok) return check;
      for (const [k, v] of Object.entries(FORT_PIECES[kind].cost || {})) bank[k] -= v;
    } else if (this.get(ix, iz)) {
      return { ok: false, reason: 'cell occupied' };
    }
    const def = kind === 'core' ? { label: 'Command Core', icon: '⭐' } : FORT_PIECES[kind];
    const cell = {
      ix, iz, kind,
      label: def.label, icon: def.icon,
      hp: kind === 'core' ? 400 : 120,
      hpMax: kind === 'core' ? 400 : 120,
      born: 0,
    };
    this.cells.set(this.key(ix, iz), cell);
    this.recompute();
    return { ok: true, reason: '', cell };
  }

  remove(ix, iz) {
    const c = this.get(ix, iz);
    if (!c) return { ok: false, reason: 'nothing there' };
    if (c.kind === 'core') return { ok: false, reason: 'the command core stays' };
    this.cells.delete(this.key(ix, iz));
    this.recompute();
    return { ok: true, cell: c };
  }

  /** Aggregate every piece into fortress-wide numbers + turret list. */
  recompute() {
    let shield = 0, hull = 300, turbolifts = 0;
    const turrets = [], yields = {}, kinds = {};
    for (const c of this.cells.values()) {
      const def = c.kind === 'core' ? { hull: 100 } : FORT_PIECES[c.kind];
      kinds[c.kind] = (kinds[c.kind] || 0) + 1;
      if (def.shield) shield += def.shield;
      if (def.hull) hull += def.hull;
      if (c.kind === 'turbolift') turbolifts += 1;
      if (def.yield) for (const [k, v] of Object.entries(def.yield)) yields[k] = (yields[k] || 0) + v;
      if (def.turret) turrets.push({ cell: c, def: def.turret });
    }
    const rangeMult = 1 + turbolifts * 0.12;
    const prevMax = this.shieldMax || 0;
    this.shieldMax = shield;
    if (this.shield == null) this.shield = shield;
    else this.shield = Math.min(shield, this.shield + Math.max(0, shield - prevMax));
    this.hullMax = hull;
    this.hull = Math.min(this.hull ?? hull, hull);
    this.turrets = turrets.map((t) => ({ ...t, range: t.def.range * rangeMult }));
    this.yields = yields;
    this.kinds = kinds;
    this.rangeMult = rangeMult;
    return this;
  }

  /** Passive mining — called with the real dt, returns the resources earned. */
  mine(dt) {
    const out = {};
    for (const [k, v] of Object.entries(this.yields || {})) out[k] = v * dt;
    return out;
  }

  /**
   * Aim every turret at the closest hostile and fire when ready.
   * `fire(from, to, damage, kind)` is supplied by the sim so bolts stay there.
   */
  update(dt, enemies, fire) {
    const powered = this.turrets.length > 0;
    for (const t of this.turrets) {
      const key = this.key(t.cell.ix, t.cell.iz);
      const pos = this.worldPos(t.cell.ix, t.cell.iz);
      let best = null; let bestD = t.range;
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        const d = Math.hypot(e.pos.x - pos.x, e.pos.y - pos.y, e.pos.z - pos.z);
        if (d < bestD) { bestD = d; best = e; }
      }
      const cd = (this.cooldowns.get(key) || 0) - dt;
      if (best) {
        const aim = Math.atan2(best.pos.x - pos.x, best.pos.z - pos.z);
        this.turretAngle.set(key, aim);
        if (cd <= 0) {
          this.cooldowns.set(key, t.def.interval);
          fire({ ...pos, y: pos.y + (t.def.missile ? 5.5 : 4) }, best, t.def.damage, t.def.missile ? 'missile' : 'phaser');
        }
      } else {
        this.cooldowns.set(key, Math.max(0, cd));
      }
    }
    return powered;
  }

  /** Siege damage lands on the shield first, then the hull. */
  damage(amount) {
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
    }
    if (amount > 0) this.hull -= amount;
    if (this.hull < 0) this.hull = 0;
    return this.hull <= 0;
  }

  repair(dt) {
    const rate = 2 + (this.kinds.habitat || 0) * 1.5;
    this.hull = Math.min(this.hullMax, this.hull + rate * dt);
    if (this.shieldMax > 0) this.shield = Math.min(this.shieldMax, this.shield + 4 * dt);
  }

  toJSON() {
    return {
      x: this.x, y: this.y, z: this.z, hull: this.hull,
      cells: [...this.cells.values()].map((c) => ({ ix: c.ix, iz: c.iz, kind: c.kind })),
    };
  }

  static fromJSON(d) {
    const f = new SkyFort(d.x || 0, d.y || 0, d.z || 0);
    f.cells.clear();
    for (const c of d.cells || []) f.place(c.ix, c.iz, c.kind, {}, { free: true });
    f.hull = d.hull ?? f.hullMax;
    f.recompute();
    return f;
  }
}

// ------------------------------------------------------------------- meshes
function mat(THREE, color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.5, metalness: opts.metalness ?? 0.7,
    emissive: opts.emissive ?? '#000000', emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
  });
}

/**
 * Build the whole fortress as a Group. Cheap enough to rebuild whenever a piece
 * is added (≤96 pieces), which keeps the code free of incremental bookkeeping.
 * `style` switches between the sleek hex platforms and voxel blocks.
 */
export function buildFort(THREE, fort, style = 'scifi') {
  return style === 'voxel' ? buildFortVoxel(THREE, fort) : buildFortScifi(THREE, fort);
}

function buildFortScifi(THREE, fort) {
  const root = new THREE.Group();
  root.name = 'skyfort';
  const parts = { turrets: [], pylons: [], crystals: [], platforms: [] };
  root.userData.parts = parts;

  const deckMat = mat(THREE, '#5c6672', { roughness: 0.42, metalness: 0.8 });
  const trimMat = mat(THREE, '#8fd8ff', { emissive: '#2d9bd6', emissiveIntensity: 1.3 });
  const accentMat = mat(THREE, '#f0b24a', { emissive: '#a06a12', emissiveIntensity: 0.8 });

  for (const cell of fort.cells.values()) {
    const p = fort.worldPos(cell.ix, cell.iz);
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    const r = FORT.cell * 0.56;

    // hex deck (sci-fi platform, not a voxel cube)
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 1.1, 6, 1), cell.kind === 'core' ? accentMat : deckMat);
    deck.rotation.y = Math.PI / 6;
    g.add(deck);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.92, 0.16, 8, 6), trimMat);
    rim.rotation.x = Math.PI / 2;
    rim.rotation.z = Math.PI / 6;
    rim.position.y = 0.62;
    g.add(rim);

    switch (cell.kind) {
      case 'core': {
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(3.4, 0), mat(THREE, '#9fe8ff', { emissive: '#38bdf8', emissiveIntensity: 1.6, transparent: true, opacity: 0.92 }));
        core.position.y = 5;
        g.add(core);
        parts.crystals.push(core);
        for (let i = 0; i < 3; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2 + i * 1.2, 0.14, 8, 40), trimMat);
          ring.rotation.x = Math.PI / 2 + i * 0.3;
          ring.position.y = 5;
          g.add(ring);
          parts.pylons.push(ring);
        }
        break;
      }
      case 'phaser':
      case 'missile': {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.1, 1.6, 10, 1), deckMat);
        base.position.y = 1.3;
        g.add(base);
        const head = new THREE.Group();
        head.position.y = 2.4;
        const barrel = new THREE.Mesh(
          cell.kind === 'missile'
            ? new THREE.BoxGeometry(2.6, 1.1, 3.2)
            : new THREE.CylinderGeometry(0.28, 0.28, 3.4, 8, 1),
          cell.kind === 'missile' ? accentMat : trimMat,
        );
        if (cell.kind !== 'missile') { barrel.rotation.x = Math.PI / 2; barrel.position.z = 1.2; }
        head.add(barrel);
        g.add(head);
        parts.turrets.push({ group: head, cell });
        break;
      }
      case 'shield': {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 5.4, 8, 1), deckMat);
        stem.position.y = 3.1;
        g.add(stem);
        const orb = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), mat(THREE, '#7fd4ff', { emissive: '#1d7fb8', emissiveIntensity: 1.8, transparent: true, opacity: 0.55 }));
        orb.position.y = 6.4;
        g.add(orb);
        const halo = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.12, 8, 30), trimMat);
        halo.rotation.x = Math.PI / 2;
        halo.position.y = 6.4;
        g.add(halo);
        parts.pylons.push(halo);
        break;
      }
      case 'refinery': {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.3, 4.4, 12, 1), deckMat);
        stack.position.y = 2.6;
        g.add(stack);
        const flame = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.4, 10), mat(THREE, '#ffb457', { emissive: '#ff8a1f', emissiveIntensity: 2 }));
        flame.position.y = 5.6;
        g.add(flame);
        parts.crystals.push(flame);
        break;
      }
      case 'matrix': {
        const dish = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.2, 1.2, 12, 1), deckMat);
        dish.position.y = 1.5;
        g.add(dish);
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 0), mat(THREE, '#c4a8ff', { emissive: '#7c5bff', emissiveIntensity: 2 }));
        crystal.position.y = 4;
        g.add(crystal);
        parts.crystals.push(crystal);
        break;
      }
      case 'habitat': {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(3.1, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(THREE, '#9fb4c7', { roughness: 0.3 }));
        dome.position.y = 0.7;
        g.add(dome);
        const band = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.12, 6, 26), trimMat);
        band.rotation.x = Math.PI / 2;
        band.position.y = 0.8;
        g.add(band);
        break;
      }
      case 'turbolift': {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 5, 12, 1, true), mat(THREE, '#a9d9ff', { transparent: true, opacity: 0.5, emissive: '#2d9bd6', emissiveIntensity: 1.1 }));
        tube.position.y = 3;
        g.add(tube);
        break;
      }
      default: {
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.68, 0.3, 6, 1), trimMat);
        plate.rotation.y = Math.PI / 6;
        plate.position.y = 0.72;
        g.add(plate);
      }
    }
    g.userData.cell = cell;
    root.add(g);
    parts.platforms.push(g);
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}

/** Holographic build grid — a plane of glowing cells + the highlight cube. */
export function buildFortGrid(THREE, fort) {
  const root = new THREE.Group();
  const half = (FORT.size - 1) / 2;
  const lineMat = new THREE.LineBasicMaterial({ color: '#59d8ff', transparent: true, opacity: 0.34 });
  const pts = [];
  for (let i = 0; i <= FORT.size; i++) {
    const a = -FORT.cell / 2, b = FORT.size * FORT.cell + a;
    const off = i * FORT.cell + a;
    pts.push(new THREE.Vector3(a, 0, off), new THREE.Vector3(b, 0, off));
    pts.push(new THREE.Vector3(off, 0, a), new THREE.Vector3(off, 0, b));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  root.add(new THREE.LineSegments(geo, lineMat));

  const highlight = new THREE.Mesh(
    new THREE.BoxGeometry(FORT.cell * 0.94, 1.2, FORT.cell * 0.94),
    new THREE.MeshBasicMaterial({ color: '#7ef0ff', transparent: true, opacity: 0.24 }),
  );
  highlight.position.y = 0.7;
  root.add(highlight);
  const ghost = new THREE.Mesh(
    new THREE.BoxGeometry(FORT.cell * 0.94, 0.2, FORT.cell * 0.94),
    new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.28 }),
  );
  ghost.position.y = 0.3;
  root.add(ghost);
  root.position.set(fort.x, fort.y, fort.z);
  root.userData.highlight = highlight;
  root.userData.ghost = ghost;
  root.userData.half = half;
  return root;
}

/**
 * VOXEL BLOCKS style — the same grid, pieces and rules, built out of chunky
 * cubes: a Minecraft-ish sky fortress instead of sleek starbase platforms.
 */
export function buildFortVoxel(THREE, fort) {
  const root = new THREE.Group();
  root.name = 'skyfort';
  root.style = 'voxel';
  const parts = { turrets: [], pylons: [], crystals: [], platforms: [] };
  root.userData.parts = parts;

  const PALETTE = {
    platform: '#6b7a8c', core: '#8f7ae0', phaser: '#7fa3c8', missile: '#b58a6a',
    shield: '#5f9fbf', refinery: '#8a7a68', matrix: '#8f6fd0', habitat: '#93a08f',
    turbolift: '#7fb6a0',
  };
  const S = FORT.cell * 0.88;
  const H = 2.4;
  const block = (x, y, z, w, h, d, color, opts = {}) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({
        color, roughness: opts.rough ?? 0.75, metalness: opts.metal ?? 0.25,
        emissive: opts.emissive ?? '#000000', emissiveIntensity: opts.ei ?? 1,
        transparent: !!opts.alpha, opacity: opts.alpha ?? 1, flatShading: true,
      }),
    );
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };

  for (const cell of fort.cells.values()) {
    const p = fort.worldPos(cell.ix, cell.iz);
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    root.add(g);
    const add = (mesh) => { g.add(mesh); return mesh; };

    const base = PALETTE[cell.kind] || PALETTE.platform;
    const deck = add(new THREE.Mesh(
      new THREE.BoxGeometry(S, H, S),
      new THREE.MeshStandardMaterial({ color: base, roughness: 0.8, metalness: 0.2, flatShading: true }),
    ));
    deck.position.y = H / 2;
    deck.castShadow = true; deck.receiveShadow = true;

    switch (cell.kind) {
      case 'core': {
        const tower = add(new THREE.Mesh(
          new THREE.BoxGeometry(S * 0.62, H * 2.6, S * 0.62),
          new THREE.MeshStandardMaterial({ color: '#b6a6ff', emissive: '#6d4bff', emissiveIntensity: 0.7, flatShading: true }),
        ));
        tower.position.y = H + H * 1.3;
        const crown = add(new THREE.Mesh(
          new THREE.BoxGeometry(S * 0.4, S * 0.4, S * 0.4),
          new THREE.MeshBasicMaterial({ color: '#d8ccff' }),
        ));
        crown.position.y = H * 3.9;
        parts.crystals.push(crown);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const spire = add(new THREE.Mesh(
            new THREE.BoxGeometry(1.2, H * 1.4, 1.2),
            new THREE.MeshBasicMaterial({ color: '#8f7ae0' }),
          ));
          spire.position.set(Math.cos(a) * S * 0.62, H + H * 0.7, Math.sin(a) * S * 0.62);
          parts.pylons.push(spire);
        }
        break;
      }
      case 'phaser':
      case 'missile': {
        const head = new THREE.Group();
        head.position.y = H;
        const seat = new THREE.Mesh(
          new THREE.BoxGeometry(S * 0.6, H * 0.8, S * 0.6),
          new THREE.MeshStandardMaterial({ color: '#4c5766', roughness: 0.7, flatShading: true }),
        );
        seat.position.y = H * 0.4;
        head.add(seat);
        const barrel = new THREE.Mesh(
          cell.kind === 'missile'
            ? new THREE.BoxGeometry(S * 0.5, H * 0.5, S * 0.8)
            : new THREE.BoxGeometry(S * 0.18, S * 0.18, S * 0.85),
          new THREE.MeshStandardMaterial({
            color: cell.kind === 'missile' ? '#c08a5a' : '#9fe6ff',
            emissive: cell.kind === 'missile' ? '#5a3512' : '#2d9bd6',
            emissiveIntensity: 0.9, flatShading: true,
          }),
        );
        barrel.position.set(0, H * 0.8, S * 0.3);
        head.add(barrel);
        add(head);
        parts.turrets.push({ group: head, cell });
        break;
      }
      case 'shield': {
        for (let i = 0; i < 3; i++) {
          const seg = add(new THREE.Mesh(
            new THREE.BoxGeometry(S * 0.42, H * 0.9, S * 0.42),
            new THREE.MeshStandardMaterial({ color: i % 2 ? '#6fa9cc' : '#5f9fbf', emissive: '#1d6f96', emissiveIntensity: 0.5, flatShading: true }),
          ));
          seg.position.y = H + i * H * 0.9;
        }
        const orb = add(new THREE.Mesh(
          new THREE.BoxGeometry(S * 0.5, S * 0.5, S * 0.5),
          new THREE.MeshBasicMaterial({ color: '#9fe6ff', transparent: true, opacity: 0.85 }),
        ));
        orb.position.y = H * 3.4;
        parts.pylons.push(orb);
        break;
      }
      case 'refinery': {
        const stack = add(new THREE.Mesh(
          new THREE.BoxGeometry(S * 0.55, H * 2.2, S * 0.55),
          new THREE.MeshStandardMaterial({ color: '#7d6a55', roughness: 0.9, flatShading: true }),
        ));
        stack.position.y = H + H * 1.1;
        const flame = add(new THREE.Mesh(
          new THREE.BoxGeometry(S * 0.3, S * 0.3, S * 0.3),
          new THREE.MeshBasicMaterial({ color: '#ffb457' }),
        ));
        flame.position.y = H * 3.4;
        parts.crystals.push(flame);
        break;
      }
      case 'matrix': {
        const block2 = add(new THREE.Mesh(
          new THREE.BoxGeometry(S * 0.55, S * 0.55, S * 0.55),
          new THREE.MeshStandardMaterial({ color: '#c4a8ff', emissive: '#7c5bff', emissiveIntensity: 1.4, flatShading: true }),
        ));
        block2.position.y = H + S * 0.35;
        parts.crystals.push(block2);
        break;
      }
      case 'habitat': {
        add(new THREE.Mesh(
          new THREE.BoxGeometry(S * 0.8, H * 0.9, S * 0.8),
          new THREE.MeshStandardMaterial({ color: '#a8b8a4', flatShading: true }),
        )).position.y = H * 1.45;
        add(new THREE.Mesh(
          new THREE.BoxGeometry(S * 0.5, H * 0.5, S * 0.5),
          new THREE.MeshStandardMaterial({ color: '#8b9a88', flatShading: true }),
        )).position.y = H * 2.1;
        break;
      }
      case 'turbolift': {
        add(new THREE.Mesh(
          new THREE.BoxGeometry(S * 0.3, H * 2.4, S * 0.3),
          new THREE.MeshStandardMaterial({ color: '#9fe6ff', transparent: true, opacity: 0.7, emissive: '#2d9bd6', emissiveIntensity: 0.8, flatShading: true }),
        )).position.y = H * 1.7;
        break;
      }
      default: {
        add(new THREE.Mesh(
          new THREE.BoxGeometry(S * 0.7, H * 0.4, S * 0.7),
          new THREE.MeshStandardMaterial({ color: '#8fa3b8', flatShading: true }),
        )).position.y = H * 1.2;
      }
    }
    g.userData.cell = cell;
    parts.platforms.push(g);
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}
