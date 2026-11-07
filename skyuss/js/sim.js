// The simulation. No Three.js, no DOM — pure state + maths, so the whole game
// loop (flight, combat, sieges, mining, upgrades, the abyss) can be run and
// tested headlessly. js/main.js only draws what lives here.

import { Enterprise } from './enterprise.js';
import { SkyFort } from './fort.js';
import { generateWorld, nearestDerelict, nearestIsland, stormAt } from './world.js';
import { WORLD, PIRATE_TYPES, SIEGE, SCAVENGE, FORT } from './config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

export class SkyGame {
  constructor(opts = {}) {
    this.seed = opts.seed ?? WORLD.seed;
    this.world = generateWorld(this.seed);
    this.ship = new Enterprise(opts.tiers);
    this.fort = new SkyFort(0, 8, 0);
    // a starter deck around the core: two platforms and one turret
    for (const [ix, iz, kind] of [[6, 5, 'platform'], [6, 7, 'platform'], [5, 6, 'phaser']]) {
      this.fort.place(ix, iz, kind, {}, { free: true });
    }
    this.fort.hull = this.fort.hullMax;
    this.fort.shield = this.fort.shieldMax;

    this.bank = { titanium: 220, dilithium: 70, matrix: 1 };
    this.cargo = { titanium: 0, dilithium: 0, matrix: 0 };
    this.cargoMax = 240;

    this.t = 0;
    this.screen = 'playing';
    this.events = [];
    this.log = [];

    this.pos = { x: 0, y: 62, z: 210 };
    this.yaw = Math.PI;          // facing home
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.vertical = 0;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.aim = { x: 0, y: 0, z: -1 };

    this.hull = this.ship.stats.hull;
    this.shields = this.ship.stats.maxShields;
    this.energy = this.ship.stats.energy;
    this.shieldTimer = 0;        // seconds since last hit
    this.fireCd = 0;
    this.torpCd = 0;
    this.warpCd = 0;
    this.warpActive = 0;
    this.boost = 0;

    this.enemies = [];
    this.bolts = [];
    this.pickups = [];
    this.sparks = [];            // renderer-only particle hints
    this.effects = [];           // {kind,x,y,z,size,life,maxLife} — pure data VFX
    // monotonic counters: the renderer diffs these to fire audio + particles
    this.fx = { shots: 0, torps: 0, kills: 0, hits: 0, warps: 0, builds: 0, loot: 0, alarms: 0 };
    this.siegeTimer = SIEGE.firstAt;
    this.pirateTimer = 26;
    this.siegeWave = 0;
    this.stats = { kills: 0, mined: 0, looted: 0, deposit: 0, deaths: 0, sieges: 0 };
    this.buildMode = false;
    this.enemySeq = 0;
    // player preferences (persisted): fortress art style, aim assist, touch UI
    this.settings = { style: 'scifi', aimAssist: true, touch: 'auto' };
  }

  /** Push a short-lived visual effect (rendered by main.js, faded here). */
  fxBurst(kind, x, y, z, size = 1, life = 0.7) {
    this.effects.push({ kind, x, y, z, size, life, maxLife: life });
    if (this.effects.length > 90) this.effects.shift();
  }

  emit(type, text, extra = {}) {
    const e = { type, text, t: this.t, ...extra };
    this.events.push(e);
    if (this.events.length > 40) this.events.shift();
    return e;
  }

  // ------------------------------------------------------------- derived info
  get forward() {
    const cp = Math.cos(this.pitch);
    return {
      x: Math.sin(this.yaw) * cp,
      y: Math.sin(this.pitch),
      z: Math.cos(this.yaw) * cp,
    };
  }
  get abyss() { return this.pos.y < WORLD.safeFloor; }
  get cargoTotal() { return this.cargo.titanium + this.cargo.dilithium + this.cargo.matrix * 20; }
  get nearFort() { return Math.hypot(this.pos.x - this.fort.x, this.pos.y - this.fort.y, this.pos.z - this.fort.z) <= FORT.depositRange; }
  get nearDerelict() { return nearestDerelict(this.world, this.pos, SCAVENGE.derelictRange); }
  get nearIsland() { return nearestIsland(this.world, this.pos, SCAVENGE.islandRange + 60); }

  // ------------------------------------------------------------------ upgrade
  /** Sets a preference (style / aimAssist / touch) and reports the new value. */
  setSetting(key, value) {
    if (!(key in this.settings)) return undefined;
    this.settings[key] = value;
    if (key === 'aimAssist') {
      this.lockedEnemy = value ? this.findLock() : null;
      this.aimEnemy = null;
    }
    this.emit('', key === 'style'
      ? `Fortress style: <b>${value === 'voxel' ? 'VOXEL BLOCKS' : 'SCI-FI PLATFORMS'}</b>`
      : key === 'aimAssist'
        ? `Weapons: <b>${value ? 'AUTO-LOCK ASSIST' : 'FULLY MANUAL AIM'}</b>`
        : `Touch controls: <b>${value}</b>`);
    return this.settings[key];
  }

  toggleStyle() {
    return this.setSetting('style', this.settings.style === 'voxel' ? 'scifi' : 'voxel');
  }

  toggleAim() {
    return this.setSetting('aimAssist', !this.settings.aimAssist);
  }

  upgradeAll() {
    const res = this.ship.upgradeAll(this.bank);
    if (res.ok) {
      this.hull = Math.max(this.hull, this.ship.stats.hull * 0.9);
      this.shields = this.ship.stats.maxShields;
      const names = res.installed.map((i) => i.name).join(', ');
      this.emit('good', `Refit sweep: ${res.installed.length} upgrade${res.installed.length > 1 ? 's' : ''} — ${names}.`);
      this.fxRefit = (this.fxRefit || 0) + 1;
      this.fxBurst('warp', this.pos.x, this.pos.y, this.pos.z, 4, 1.0);
    } else {
      this.emit('warn', 'Nothing affordable — bank more titanium and dilithium.');
    }
    return res;
  }

  upgrade(component) {
    const res = this.ship.upgradeShip(component, this.bank);
    if (res.ok) {
      this.emit('good', `${res.name} installed on the ${component}.`);
      // refits refill shields/hull proportionally
      this.hull = Math.max(this.hull, this.ship.stats.hull * 0.9);
      this.shields = this.ship.stats.maxShields;
    } else {
      this.emit('bad', `Cannot upgrade ${component}: ${res.reason}.`);
    }
    return res;
  }

  // ----------------------------------------------------------------- building
  placePiece(ix, iz, kind) {
    const res = this.fort.place(ix, iz, kind, this.bank);
    if (res.ok) {
      this.fx.builds += 1;
      const p = this.fort.worldPos(ix, iz);
      this.fxBurst('build', p.x, p.y + 2, p.z, 2, 0.6);
      this.emit('good', `${res.cell.label} online.`);
    } else this.emit('warn', res.reason);
    return res;
  }

  /**
   * BUILD ALL: keep filling every free cell that touches the existing deck with
   * `kind` until the fortress is full or the bank runs dry. Returns how many
   * pieces went up (and why it stopped).
   */
  placeAll(kind, limit = 40) {
    if (!this.fort || !this.fort.size) return { ok: false, placed: 0, reason: 'no fortress' };
    const size = this.fort.size;
    let placed = 0;
    let stopped = 'no space';
    for (let pass = 0; pass < size * size && placed < limit; pass++) {
      let any = false;
      for (let ix = 0; ix < size; ix++) {
        for (let iz = 0; iz < size; iz++) {
          if (placed >= limit) break;
          const check = this.fort.canPlace(ix, iz, kind, this.bank);
          if (!check.ok) {
            if (/resources/.test(check.reason)) stopped = 'out of resources';
            continue;
          }
          const res = this.fort.place(ix, iz, kind, this.bank);
          if (!res.ok) continue;
          placed += 1;
          any = true;
          this.fx.builds += 1;
          const p = this.fort.worldPos(ix, iz);
          this.fxBurst('build', p.x, p.y + 2, p.z, 2, 0.6);
        }
      }
      if (!any) break;
    }
    if (placed > 0) this.emit('good', `Bulk build: ${placed} × ${kind} online.`);
    else this.emit('warn', `Nothing built — ${stopped}.`);
    return { ok: placed > 0, placed, reason: stopped };
  }

  removePiece(ix, iz) {
    const res = this.fort.remove(ix, iz);
    if (res.ok) {
      // refund half
      this.bank.titanium += Math.floor((res.cell.kind === 'platform' ? 20 : 10));
      this.emit('', `${res.cell.label} recycled.`);
    }
    return res;
  }

  // ---------------------------------------------------------------- scavenging
  interact() {
    if (this.nearFort && this.cargoTotal > 0) return this.deposit();
    const d = this.nearDerelict;
    if (d) {
      const r = (a) => Math.round(a[0] + Math.random() * (a[1] - a[0]));
      const loot = {
        titanium: r(SCAVENGE.derelictLoot.titanium),
        dilithium: r(SCAVENGE.derelictLoot.dilithium),
        matrix: d.matrix,
      };
      d.looted = true;
      this.stats.looted += 1;
      this.addCargo(loot);
      this.fx.loot += 1;
      this.fxBurst('loot', d.x, d.y, d.z, 4, 0.9);
      this.emit('good', `${d.name} stripped: +${loot.titanium} Ti · +${loot.dilithium} Di · +${loot.matrix} matrix`);
      return { ok: true, kind: 'loot', loot };
    }
    const island = this.nearIsland;
    if (island && !island.looted) {
      island.looted = true;
      const loot = {
        titanium: Math.round(SCAVENGE.islandLoot.titanium[0] + Math.random() * 40),
        dilithium: Math.round(SCAVENGE.islandLoot.dilithium[0] + Math.random() * 20),
        matrix: island.matrixNode ? 1 : 0,
      };
      this.addCargo(loot);
      this.emit('good', `${island.name} surveyed: +${loot.titanium} Ti · +${loot.dilithium} Di`);
      return { ok: true, kind: 'mine', loot };
    }
    if (this.nearFort) {
      this.emit('warn', 'Nothing to deposit — go strip a derelict.');
      return { ok: false, reason: 'empty cargo' };
    }
    this.emit('warn', 'Nothing within tractor range.');
    return { ok: false, reason: 'nothing in range' };
  }

  addCargo(loot) {
    for (const k of ['titanium', 'dilithium', 'matrix']) {
      const add = loot[k] || 0;
      if (!add) continue;
      const weight = k === 'matrix' ? 20 : 1;
      const space = Math.max(0, this.cargoMax - this.cargoTotal);
      const take = Math.min(add, Math.floor(space / weight));
      this.cargo[k] += take;
    }
    if (this.cargoTotal >= this.cargoMax) this.emit('warn', 'Cargo hold full — return to the fort.');
  }

  deposit() {
    const banked = { ...this.cargo };
    for (const k of Object.keys(banked)) this.bank[k] += banked[k];
    this.stats.deposit += banked.titanium + banked.dilithium;
    this.cargo = { titanium: 0, dilithium: 0, matrix: 0 };
    this.emit('good', `Deposited ${banked.titanium} Ti · ${banked.dilithium} Di${banked.matrix ? ` · ${banked.matrix} matrix` : ''}.`);
    return { ok: true, kind: 'deposit', banked };
  }

  // ------------------------------------------------------------------ combat
  canFire() {
    return this.fireCd <= 0 && this.energy >= 3 && this.screen === 'playing';
  }

  /** Returns the bolt it fired, or null. `locked` bores in on the nearest hostile. */
  fire() {
    if (!this.canFire()) return null;
    const st = this.ship.stats;
    this.fireCd = 1 / st.fireRate;
    this.energy -= 3;
    const assisted = this.settings.aimAssist !== false;
    const dir = (assisted && this.aimEnemy) || this.aim;
    const origin = {
      x: this.pos.x + this.forward.x * 9,
      y: this.pos.y + this.forward.y * 9,
      z: this.pos.z + this.forward.z * 9,
    };
    const bolt = {
      owner: 'ship',
      kind: 'phaser',
      pos: origin,
      vel: {
        x: dir.x * 260, y: dir.y * 260, z: dir.z * 260,
      },
      damage: st.weaponDamage,
      life: 2.2,
      homing: assisted ? (this.lockedEnemy || null) : null,
      color: '#8ef2ff',
    };
    this.bolts.push(bolt);
    this.fx.shots += 1;
    this.fxBurst('muzzle', origin.x, origin.y, origin.z, 1.4, 0.18);
    return bolt;
  }

  fireTorpedo() {
    if (!this.ship.stats.torpedoes) return null;
    if (this.torpCd > 0 || this.energy < 20) return null;
    this.torpCd = 3.2;
    this.energy -= 20;
    const assisted = this.settings.aimAssist !== false;
    const dir = (assisted && this.aimEnemy) || this.aim;
    const bolt = {
      owner: 'ship',
      kind: 'torpedo',
      pos: { x: this.pos.x, y: this.pos.y - 2, z: this.pos.z },
      vel: { x: dir.x * 190, y: dir.y * 190, z: dir.z * 190 },
      damage: this.ship.stats.weaponDamage * 4,
      life: 3.2,
      homing: assisted ? (this.lockedEnemy || null) : null,
      color: '#ffd166',
      splash: 26,
    };
    this.bolts.push(bolt);
    this.fx.torps += 1;
    this.fxBurst('muzzle', this.pos.x, this.pos.y - 2, this.pos.z, 2.2, 0.22);
    return bolt;
  }

  warp() {
    if (this.warpCd > 0 || this.energy < 25) return false;
    this.warpCd = this.ship.stats.warpCd;
    this.energy -= 25;
    this.warpActive = 1.1;
    this.shieldTimer = 0;
    this.fx.warps += 1;
    this.fxBurst('warp', this.pos.x, this.pos.y, this.pos.z, 6, 0.9);
    this.emit('', 'Warp dash!');
    return true;
  }

  /** Nearest hostile inside the lock cone (or null) — the auto-lock assist. */
  findLock() {
    if (this.settings && this.settings.aimAssist === false) return null;
    const fwd = this.forward;
    let best = null, bestScore = -1;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const dx = e.pos.x - this.pos.x, dy = e.pos.y - this.pos.y, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d;
      const coneCos = Math.cos(0.55 + this.ship.stats.lockCone);
      if (dot < coneCos) continue;
      const score = dot - d / 2000;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  aimAt(target) {
    const dx = target.pos.x - this.pos.x;
    const dy = target.pos.y - this.pos.y;
    const dz = target.pos.z - this.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / d, y: dy / d, z: dz / d };
  }

  damageShip(amount, from) {
    this.shieldTimer = 0;
    let left = amount;
    if (this.shields > 0) {
      const absorbed = Math.min(this.shields, left);
      this.shields -= absorbed;
      left -= absorbed;
    }
    if (left > 0) this.hull -= left;
    this.hitFlash = 0.35;
    this.fx.hits += 1;
    this.fxBurst('hit', this.pos.x, this.pos.y, this.pos.z, 2, 0.4);
    if (this.hull <= 0) this.destroyShip(from);
  }

  destroyShip() {
    if (this.screen !== 'playing') return;
    this.stats.deaths += 1;
    this.cargo = { titanium: 0, dilithium: 0, matrix: 0 };
    this.hull = this.ship.stats.hull;
    this.shields = 0;
    this.fxBurst('boom', this.pos.x, this.pos.y, this.pos.z, 6, 1.4);
    this.fx.alarms += 1;
    this.pos = { x: this.fort.x, y: this.fort.y + 40, z: this.fort.z + 120 };
    this.speed = 0;
    this.emit('bad', 'Hull breach — tractor-beamed back to the fortress. Cargo lost.');
  }

  // ---------------------------------------------------------------- hostiles
  spawnEnemy(type, pos) {
    const def = PIRATE_TYPES[type] || PIRATE_TYPES.skiff;
    const e = {
      id: 'e' + (++this.enemySeq),
      type, def,
      hp: def.hp, hpMax: def.hp,
      pos: pos || { x: this.pos.x + 160, y: this.pos.y + 10, z: this.pos.z + 160 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      cd: Math.random() * def.rate,
      target: 'ship',
      dead: false,
    };
    this.enemies.push(e);
    return e;
  }

  spawnWave(count, targetIsFort = false) {
    const types = ['skiff', 'skiff', 'raider'];
    if (this.siegeWave >= 2) types.push('siege');
    if (this.siegeWave >= 4) types.push('dread');
    const base = targetIsFort ? this.fort : this.pos;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random();
      const dist = 260 + Math.random() * 120;
      const e = this.spawnEnemy(types[Math.floor(Math.random() * types.length)], {
        x: base.x + Math.cos(a) * dist,
        y: base.y + (Math.random() - 0.5) * 60,
        z: base.z + Math.sin(a) * dist,
      });
      e.target = targetIsFort ? 'fort' : 'ship';
    }
    this.emit('bad', targetIsFort ? 'SIEGE: hostile fleet inbound on the fortress!' : 'Pirate squadron on your tail.');
  }

  // ------------------------------------------------------------------ flight
  applyInput(input, dt) {
    const st = this.ship.stats;
    const warpMult = this.warpActive > 0 ? 3.4 : 1;
    const yawRate = st.turnRate * (this.warpActive > 0 ? 0.35 : 1);
    this.yaw += (input.yaw || 0) * yawRate * dt;
    this.pitch += (input.pitch || 0) * yawRate * 0.72 * dt;
    this.pitch = clamp(this.pitch, -1.15, 1.15);
    if (!input.pitch) this.pitch = lerp(this.pitch, 0, Math.min(1, dt * 0.9));
    // bank into turns for the camera + renderer
    this.roll = lerp(this.roll, -(input.yaw || 0) * 0.6 - (input.roll || 0) * 0.4, Math.min(1, dt * 3));

    const wantBoost = !!input.boost && this.energy > 1;
    this.boost = lerp(this.boost, wantBoost ? 1 : 0, Math.min(1, dt * 4));
    if (wantBoost) this.energy = Math.max(0, this.energy - 18 * dt);
    const targetSpeed = (input.forward ? st.maxSpeed : input.back ? -st.maxSpeed * 0.35 : 0) * (1 + this.boost * 0.9);
    this.speed = lerp(this.speed, targetSpeed, Math.min(1, dt * 1.6));
    this.vertical = lerp(this.vertical, ((input.up ? 1 : 0) - (input.down ? 1 : 0)) * 26, Math.min(1, dt * 3));

    const f = this.forward;
    if (this.warpActive > 0) {
      this.warpActive = Math.max(0, this.warpActive - dt);
      const push = st.maxSpeed * 3.4 * (this.warpActive / 1.1);
      this.velocity = { x: f.x * push, y: f.y * push, z: f.z * push };
    } else {
      this.velocity = { x: f.x * this.speed, y: f.y * this.speed + this.vertical, z: f.z * this.speed };
    }
    this.pos.x += this.velocity.x * dt;
    this.pos.y += this.velocity.y * dt;
    this.pos.z += this.velocity.z * dt;

    // soft walls of the playable volume
    const lim = WORLD.cloudBand;
    if (Math.abs(this.pos.x) > lim) { this.pos.x = Math.sign(this.pos.x) * lim; this.emit('warn', 'You are reaching the edge of the cloud sea.'); }
    if (Math.abs(this.pos.z) > lim) { this.pos.z = Math.sign(this.pos.z) * lim; }
    this.pos.y = Math.min(this.pos.y, 420);
  }

  // ------------------------------------------------------------------- frame
  update(dt, input = {}) {
    if (this.screen !== 'playing') return;
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const st = this.ship.stats;

    this.applyInput(input, dt);

    // energy + shield regen
    this.energy = Math.min(st.energy, this.energy + st.energyRegen * dt);
    this.shieldTimer += dt;
    if (this.shieldTimer > 4) this.shields = Math.min(st.maxShields, this.shields + st.shieldRegen * dt);

    // timers
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.torpCd = Math.max(0, this.torpCd - dt);
    this.warpCd = Math.max(0, this.warpCd - dt);
    this.hitFlash = Math.max(0, (this.hitFlash || 0) - dt);

    // storms chew the shields, the abyss chews everything
    const storm = stormAt(this.world, this.pos);
    this.inStorm = storm;
    if (storm) {
      this.shields = Math.max(0, this.shields - 9 * storm.power * dt);
      this.energy = Math.max(0, this.energy - 4 * storm.power * dt);
    }
    if (this.abyss) {
      const depth = Math.max(0, WORLD.safeFloor - this.pos.y);
      const dmg = (12 + depth * 0.55) * dt;
      // crushing atmospheric pressure ignores deflector shields
      this.hull -= dmg;
      this.hitFlash = 0.3;
      if (this.hull <= 0) this.destroyShip();
      if (this.pos.y < WORLD.abyssY) {
        this.hull = 0;
        this.destroyShip();
        this.emit('bad', 'THE ABYSS TOOK YOU. The sky does not give second chances.');
      }
    }

    // lock-on assist
    this.lockedEnemy = this.findLock();
    this.aimEnemy = this.lockedEnemy ? this.aimAt(this.lockedEnemy) : null;

    if (input.fire && this.canFire()) this.fire();
    if (input.torpedo) this.fireTorpedo();

    this.updateEnemies(dt);
    this.updateBolts(dt);
    this.updateFort(dt);
    this.updatePickups(dt);
    this.updateSieges(dt);

    for (const e of this.effects) e.life -= dt;
    if (this.effects.length) this.effects = this.effects.filter((e) => e.life > 0);

    // passive income while away from the fort
    const mined = this.fort.mine(dt);
    for (const [k, v] of Object.entries(mined)) {
      this.bank[k] = (this.bank[k] || 0) + v;
      this.stats.mined += v;
    }
  }

  updateFort(dt) {
    this.fort.repair(dt);
    this.fort.update(dt, this.enemies, (from, target, damage, kind) => {
      const dx = target.pos.x - from.x, dy = target.pos.y - from.y, dz = target.pos.z - from.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const speed = kind === 'missile' ? 150 : 240;
      this.bolts.push({
        owner: 'fort',
        kind: kind || 'phaser',
        pos: { ...from },
        vel: { x: (dx / d) * speed, y: (dy / d) * speed, z: (dz / d) * speed },
        damage,
        life: 4,
        homing: target,
        color: kind === 'missile' ? '#ffb457' : '#8ef2ff',
      });
    });
  }

  updateEnemies(dt) {
    for (const e of this.enemies) {
      if (e.hp <= 0) { e.fade = (e.fade || 0) - dt; continue; }
      const goal = e.target === 'fort' ? { x: this.fort.x, y: this.fort.y + 10, z: this.fort.z } : this.pos;
      const dx = goal.x - e.pos.x, dy = goal.y - e.pos.y, dz = goal.z - e.pos.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      e.yaw = Math.atan2(dx, dz);
      const want = e.def.range * 0.8;
      const dir = dist > want ? 1 : -0.35;
      const sp = e.def.speed;
      e.pos.x += (dx / dist) * sp * dir * dt;
      e.pos.y += (dy / dist) * sp * dir * dt + Math.sin(this.t * 1.4 + e.pos.x * 0.01) * 2 * dt;
      e.pos.z += (dz / dist) * sp * dir * dt;

      e.cd -= dt;
      if (e.cd <= 0 && dist < e.def.range) {
        e.cd = e.def.rate;
        const tgt = e.target === 'fort' ? { x: this.fort.x, y: this.fort.y + 6, z: this.fort.z } : this.pos;
        const bx = tgt.x - e.pos.x, by = tgt.y - e.pos.y, bz = tgt.z - e.pos.z;
        const bd = Math.hypot(bx, by, bz) || 1;
        this.bolts.push({
          owner: 'enemy',
          kind: 'plasma',
          pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z },
          vel: { x: (bx / bd) * 190, y: (by / bd) * 190, z: (bz / bd) * 190 },
          damage: e.def.damage,
          life: 3.4,
          color: '#ff7b7b',
          targetKind: e.target,
        });
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0 || (e.fade || 0) > 0);
  }

  updateBolts(dt) {
    for (const b of this.bolts) {
      if (b.life <= 0) continue;
      // homing steer (phasers track softly, torpedoes hard)
      if (b.homing && b.homing.hp > 0) {
        const tgt = b.homing.pos;
        const dx = tgt.x - b.pos.x, dy = tgt.y - b.pos.y, dz = tgt.z - b.pos.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
        const k = b.kind === 'torpedo' ? 3.4 : 1.5;
        b.vel.x = lerp(b.vel.x, (dx / d) * speed, Math.min(1, dt * k));
        b.vel.y = lerp(b.vel.y, (dy / d) * speed, Math.min(1, dt * k));
        b.vel.z = lerp(b.vel.z, (dz / d) * speed, Math.min(1, dt * k));
      }
      b.pos.x += b.vel.x * dt;
      b.pos.y += b.vel.y * dt;
      b.pos.z += b.vel.z * dt;
      b.life -= dt;

      if (b.owner === 'enemy') {
        if (b.targetKind === 'fort') {
          const d = Math.hypot(b.pos.x - this.fort.x, b.pos.y - this.fort.y, b.pos.z - this.fort.z);
          if (d < 34) { this.fort.damage(b.damage); b.life = 0; }
        } else if (Math.hypot(b.pos.x - this.pos.x, b.pos.y - this.pos.y, b.pos.z - this.pos.z) < 7) {
          this.damageShip(b.damage, 'pirate');
          b.life = 0;
        }
      } else {
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          if (Math.hypot(b.pos.x - e.pos.x, b.pos.y - e.pos.y, b.pos.z - e.pos.z) < 6 + e.def.size * 4) {
            const before = e.hp;
            e.hp -= b.damage;
            b.life = 0;
            if (b.splash) {
              for (const o of this.enemies) {
                if (o.hp <= 0 || o === e) continue;
                if (Math.hypot(o.pos.x - b.pos.x, o.pos.y - b.pos.y, o.pos.z - b.pos.z) < b.splash) o.hp -= b.damage * 0.5;
              }
            }
            if (e.hp <= 0 && before > 0) this.killEnemy(e);
            break;
          }
        }
      }
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);
  }

  killEnemy(e) {
    this.stats.kills += 1;
    this.fx.kills += 1;
    this.fxBurst('boom', e.pos.x, e.pos.y, e.pos.z, e.def.size, 1.1);
    e.fade = 0.6;
    const bounty = e.def.bounty;
    // bounties drop as cargo pickups so you still have to fly home
    for (const [k, v] of Object.entries(bounty)) {
      if (!v) continue;
      this.pickups.push({
        kind: k, amount: v,
        pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z },
        life: 40, phase: Math.random() * 6,
      });
    }
    this.emit('', `${e.def.name} destroyed.`);
  }

  updatePickups(dt) {
    for (const p of this.pickups) {
      p.life -= dt;
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.y - this.pos.y, p.pos.z - this.pos.z);
      if (d < 26) {
        // tractor beam pulls loot in
        const k = Math.min(1, dt * 3.2 * this.ship.stats.tractor);
        p.pos.x = lerp(p.pos.x, this.pos.x, k);
        p.pos.y = lerp(p.pos.y, this.pos.y, k);
        p.pos.z = lerp(p.pos.z, this.pos.z, k);
        if (d < 5) {
          this.addCargo({ [p.kind]: p.amount });
          this.emit('', `Tractor beam: +${p.amount} ${p.kind}.`);
          p.life = 0;
        }
      }
    }
    this.pickups = this.pickups.filter((p) => p.life > 0);
  }

  updateSieges(dt) {
    // ambient piracy so the sky is never empty between sieges
    this.pirateTimer -= dt;
    if (this.pirateTimer <= 0) {
      this.pirateTimer = 34 + Math.random() * 26;
      const alive = this.enemies.filter((e) => e.hp > 0 && e.target === 'ship').length;
      if (alive < 4) {
        const n = 1 + (Math.random() > 0.6 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = 300 + Math.random() * 120;
          const e = this.spawnEnemy(Math.random() > 0.65 ? 'raider' : 'skiff', {
            x: clamp(this.pos.x + Math.cos(a) * d, 40, WORLD.cloudBand - 40),
            y: clamp(this.pos.y + (Math.random() - 0.5) * 40, WORLD.safeFloor + 40, 300),
            z: clamp(this.pos.z + Math.sin(a) * d, 40, WORLD.cloudBand - 40),
          });
          e.target = 'ship';
        }
        this.emit('warn', 'Pirate skiffs closing on your position.');
      }
    }
    this.siegeTimer -= dt;
    if (this.siegeTimer <= 0) {
      this.siegeWave += 1;
      this.stats.sieges += 1;
      this.siegeTimer = SIEGE.interval;
      const n = SIEGE.waveSize[Math.min(SIEGE.waveSize.length - 1, this.siegeWave - 1)];
      this.spawnWave(n, true);
    }
    if (this.fort.hull <= 0 && !this.fortLost) {
      this.fortLost = true;
      this.emit('bad', 'THE FORTRESS HAS FALLEN. Half your stores burned.');
      this.bank.titanium = Math.floor(this.bank.titanium * 0.5);
      this.bank.dilithium = Math.floor(this.bank.dilithium * 0.5);
      // rebuild the core after the raid
      setTimeoutSafe(() => {
        this.fort = new SkyFort(this.fort.x, this.fort.y, this.fort.z);
        this.fortLost = false;
        this.emit('', 'Command core re-established. Rebuild.');
      }, 6000);
    }
  }

  // -------------------------------------------------------------------- radar
  radar() {
    const out = [];
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      out.push({ kind: 'enemy', x: e.pos.x, z: e.pos.z, y: e.pos.y, size: e.def.size });
    }
    for (const p of this.pickups) out.push({ kind: 'loot', x: p.pos.x, z: p.pos.z });
    for (const i of this.world.islands) out.push({ kind: 'island', x: i.x, z: i.z, size: i.r / 20 });
    for (const d of this.world.derelicts) if (!d.looted) out.push({ kind: 'derelict', x: d.x, z: d.z });
    out.push({ kind: 'fort', x: this.fort.x, z: this.fort.z });
    return out;
  }

  objectiveText() {
    if (this.fort.hull <= 0) return 'The fortress is down — <b>rebuild the core</b>.';
    if (this.cargoTotal >= this.cargoMax * 0.9) return 'Cargo full — <b>fly to the fortress</b> and press <b>E</b> to deposit.';
    if (this.nearFort && this.cargoTotal > 0) return 'Press <b>E</b> to deposit salvage into the fortress stores.';
    if (this.nearDerelict) return `<b>${this.nearDerelict.name}</b> in tractor range — press <b>E</b> to strip it.`;
    if (this.siegeTimer < 25) return `Siege in <b>${Math.ceil(this.siegeTimer)}s</b> — get back to the fort.`;
    return 'Scavenge derelicts, bank the salvage at the fort, upgrade the Enterprise.';
  }

  toJSON() {
    return {
      seed: this.seed,
      tiers: this.ship.toJSON().tiers,
      bank: { ...this.bank },
      cargo: { ...this.cargo },
      fort: this.fort.toJSON(),
      pos: { ...this.pos },
      yaw: this.yaw,
      hull: this.hull,
      stats: { ...this.stats },
      looted: {
        derelicts: this.world.derelicts.filter((d) => d.looted).map((d) => d.id),
        islands: this.world.islands.filter((i) => i.looted).map((i) => i.id),
      },
      siegeWave: this.siegeWave,
      settings: { ...this.settings },
    };
  }

  static fromJSON(d) {
    const g = new SkyGame({ seed: d.seed, tiers: d.tiers });
    g.bank = { titanium: 0, dilithium: 0, matrix: 0, ...d.bank };
    g.cargo = { titanium: 0, dilithium: 0, matrix: 0, ...d.cargo };
    g.fort = SkyFort.fromJSON(d.fort);
    g.pos = { ...g.pos, ...d.pos };
    g.yaw = d.yaw ?? g.yaw;
    g.hull = Math.min(g.ship.stats.hull, d.hull ?? g.ship.stats.hull);
    g.shields = g.ship.stats.maxShields;
    Object.assign(g.stats, d.stats || {});
    for (const id of (d.looted && d.looted.derelicts) || []) {
      const t = g.world.derelicts.find((x) => x.id === id);
      if (t) t.looted = true;
    }
    for (const id of (d.looted && d.looted.islands) || []) {
      const t = g.world.islands.find((x) => x.id === id);
      if (t) t.looted = true;
    }
    g.siegeWave = d.siegeWave || 0;
    if (d.settings) Object.assign(g.settings, d.settings);
    g.fort.recompute();
    return g;
  }
}

// the sim must not depend on browser timers for tests; this shim keeps Node happy
function setTimeoutSafe(fn, ms) {
  if (typeof setTimeout === 'function') setTimeout(fn, ms);
  else fn();
}
