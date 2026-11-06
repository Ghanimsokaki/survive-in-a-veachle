// Core simulation: driving, building, looting, crafting, crew, combat, travel.
import * as U from './util.js';
import {
  RES, RES_KEYS, MODULE_KINDS, STATION_NAMES, ENEMY_TYPES, ROLES,
  SHOP_ITEMS, rollLoot, NAMES,
} from './data.js';
import { RECIPES, RECIPE_BY_ID } from './recipes.js';
import { ZONES, genZone } from './world.js';
import { draw, drawMinimap, carCellPos } from './render.js';
import { UI } from './ui.js';

const SAVE_KEY = 'how_save_v2';
const DEFAULT_WEAPON = {
  name: 'Salvaged Pipe Pistol', icon: '🔫',
  stats: { dmg: 8, rate: 4.2, speed: 840, spread: 0.06, pellets: 1, splash: 0, chain: false, range: 800 },
};

export const G = {
  screen: 'menu',
  t: 0, playtime: 0,
  zoneIndex: 0, zone: null,
  car: null, stats: null,
  res: {}, cash: 0,
  buildInv: {}, consumables: {}, weapons: [], equipped: -1, droneItems: [], crew: [],
  carUpg: {},
  bullets: [], enemies: [], particles: [], floaters: [], drones: [],
  camera: { x: 0, y: 0, zoom: 1 },
  view: { w: 1280, h: 800 },
  keys: {}, mouse: { x: 0, y: 0, down: false },
  aimAngle: 0, fireCd: 0, fireFlash: 0,
  shake: 0, zoneTime: 0, spawnTimer: 0, magnetTimer: 0,
  finale: null, buffs: { dmg: 0, armor: 0, armorAmt: 0, speed: 0, magnet: 0, smoke: 0 },
  run: { kills: 0, looted: 0, crafted: 0, distance: 0, visited: 1 },
  buildMode: false, buildSelected: null,
  interact: null,
  canvas: null, ctx: null,
  _houseMarks: { a: false, b: false, c: false },
  _warnedSink: false,

  // ---------------------------------------------------------------- setup
  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    UI.init(this, this.actions());
    this.refreshMenu();
  },

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.dpr = dpr;
    this.view.w = w;
    this.view.h = h;
    this.camera.zoom = U.clamp(Math.min(w / 1350, h / 830), 0.68, 1.25);
  },

  actions() {
    return {
      panel: (name) => {
        if (name === 'build') this.toggleBuild();
        else if (name === 'shop') this.openShop();
        else this.togglePanel(name);
      },
      closePanel: () => UI.closePanel(),
      craft: (id) => this.craft(id),
      useItem: (id) => this.useConsumable(id),
      equipWeapon: (i) => this.equipWeapon(i),
      dismissCrew: (i) => this.dismissCrew(i),
      buy: (id) => this.buy(id),
      sell: (k, qty) => this.sell(k, qty),
      selectBuild: (id) => { this.buildSelected = id; UI.renderBuildTray(this); },
      exitBuild: () => this.exitBuild(),
      retry: () => this.retry(),
      endMenu: () => this.toMenu(),
    };
  },

  togglePanel(name) {
    if (this.screen !== 'playing') return;
    if (UI.panel === name) UI.closePanel();
    else { this.exitBuild(); UI.openPanel(name); }
    U.Sfx.click();
  },

  openShop() {
    if (this.screen !== 'playing') return;
    this.exitBuild();
    UI.openPanel('shop');
    U.Sfx.click();
  },

  // ---------------------------------------------------------------- new game / save
  newGame() {
    this.t = 0; this.playtime = 0;
    this.res = Object.fromEntries(RES_KEYS.map((k) => [k, 0]));
    Object.assign(this.res, {
      scrap: 70, wood: 45, cloth: 25, rubber: 12, glass: 10, food: 30,
      ammo: 70, wire: 10, fuel: 35, electronics: 6, chem: 8, meds: 8, alloy: 5, nano: 0,
    });
    this.cash = 170;
    this.buildInv = {};
    this.consumables = {};
    this.weapons = [];
    this.equipped = -1;
    this.droneItems = [];
    this.drones = [];
    this.crew = [];
    this.carUpg = { maxSpeed: 0, accel: 0, hull: 0, armor: 0, weaponDmg: 0, turretDmg: 0, cap: 0, solar: 0, ram: 0, turn: 0 };
    this.car = {
      x: 0, y: 0, angle: 0, speed: 0, steerFront: 0,
      w: 172, h: 120,
      hull: 500, hullMax: 500, power: 120,
      grid: { cols: 6, rows: 4, cell: 26, cells: new Array(24).fill(null) },
      raft: false, engine: false,
    };
    this.run = { kills: 0, looted: 0, crafted: 0, distance: 0, visited: 1 };
    this._houseMarks = { a: false, b: false, c: false };
    this._warnedSink = false;
    this.zoneIndex = 0;
    this.bullets = []; this.enemies = []; this.particles = []; this.floaters = [];
    this.buffs = { dmg: 0, armor: 0, armorAmt: 0, magnet: 0, smoke: 0 };
    this.recompute();

    // starter kit
    const give = (tag, cat, tier, n) => {
      const r = RECIPES.find((x) => x.tag === tag && x.cat === cat && x.tier === tier);
      if (!r) return;
      this.buildInv[r.id] = (this.buildInv[r.id] || 0) + n;
      return r;
    };
    give('Floor', 'build', 1, 3);
    give('Wall', 'build', 1, 1);
    give('Storage Rack', 'build', 1, 1);
    give('Workbench', 'build', 1, 1);
    give('Crew Bed', 'build', 1, 1);
    const pistol = RECIPES.find((x) => x.tag === 'Pipe Pistol' && x.cat === 'weapon' && x.tier === 1);
    if (pistol) {
      this.weapons.push({ recipeId: pistol.id, name: pistol.name, icon: pistol.icon, stats: pistol.out.stats });
      this.equipped = 0;
    }
    const kit = RECIPES.find((x) => x.tag === 'Repair Kit' && x.cat === 'utility' && x.tier === 1);
    if (kit) this.consumables[kit.id] = 2;

    this.enterZone(0);
    this.screen = 'playing';
    UI.hideMenu();
    UI.hideEnd();
    UI.showHUD(true);
    UI.banner('JAVA, INDONESIA', 'The road begins. Loot the ruins, build your home, find survivors.', 5200);
    this.save();
  },

  save() {
    if (!this.car) return;
    try {
      const data = {
        v: 2,
        zoneIndex: this.zoneIndex,
        res: this.res,
        cash: this.cash,
        buildInv: this.buildInv,
        consumables: this.consumables,
        weapons: this.weapons.map((w) => w.recipeId),
        equipped: this.equipped,
        droneItems: this.droneItems.map((d) => d.recipeId),
        crew: this.crew,
        carUpg: this.carUpg,
        car: {
          hull: this.car.hull, hullMax: this.car.hullMax, raft: this.car.raft, engine: this.car.engine,
          cells: this.car.grid.cells.map((c) => (c ? c.id : null)),
        },
        run: this.run,
        playtime: this.playtime,
        saved: Date.now(),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      this.lastSave = performance.now();
    } catch (e) { /* storage unavailable */ }
  },

  hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  },

  saveInfo() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!d) return null;
      const z = ZONES[d.zoneIndex] || ZONES[0];
      const dt = new Date(d.saved || Date.now());
      return { ...d, label: `${z.name} · ${z.sub} · saved ${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` };
    } catch (e) { return null; }
  },

  loadGame() {
    const d = this.saveInfo();
    if (!d) { this.newGame(); return; }
    this.t = 0; this.playtime = d.playtime || 0;
    this.res = Object.fromEntries(RES_KEYS.map((k) => [k, 0]));
    Object.assign(this.res, d.res || {});
    this.cash = d.cash || 0;
    this.buildInv = d.buildInv || {};
    this.consumables = d.consumables || {};
    this.crew = d.crew || [];
    this.carUpg = { maxSpeed: 0, accel: 0, hull: 0, armor: 0, weaponDmg: 0, turretDmg: 0, cap: 0, solar: 0, ram: 0, turn: 0, ...(d.carUpg || {}) };
    this.run = { kills: 0, looted: 0, crafted: 0, distance: 0, visited: 1, ...(d.run || {}) };
    this.weapons = (d.weapons || []).map((id) => {
      const r = RECIPE_BY_ID[id];
      return r ? { recipeId: id, name: r.name, icon: r.icon, stats: r.out.stats } : null;
    }).filter(Boolean);
    this.equipped = Math.min(d.equipped ?? -1, this.weapons.length - 1);
    this.droneItems = (d.droneItems || []).map((id) => {
      const r = RECIPE_BY_ID[id];
      return r ? { recipeId: id, name: r.name, icon: r.icon, spec: r.out.spec } : null;
    }).filter(Boolean);
    this.drones = [];
    const car = d.car || {};
    this.car = {
      x: 0, y: 0, angle: 0, speed: 0, steerFront: 0,
      w: 172, h: 120, hull: car.hull || 500, hullMax: 500, power: 100,
      grid: { cols: 6, rows: 4, cell: 26, cells: (car.cells || []).map((id) => (id ? this.makeModule(id) : null)) },
      raft: !!car.raft, engine: !!car.engine,
    };
    while (this.car.grid.cells.length < 24) this.car.grid.cells.push(null);
    this.buffs = { dmg: 0, armor: 0, armorAmt: 0, magnet: 0, smoke: 0 };
    this._houseMarks = { a: false, b: false, c: false };
    this._warnedSink = false;
    this.zoneIndex = d.zoneIndex || 0;
    this.bullets = []; this.enemies = []; this.particles = []; this.floaters = [];
    this.recompute();
    this.rebuildDrones();
    this.recompute();
    this.car.hull = Math.min(this.car.hull, this.car.hullMax);
    this.enterZone(this.zoneIndex);
    this.screen = 'playing';
    UI.hideMenu(); UI.hideEnd(); UI.showHUD(true);
    UI.banner(this.zone.def.name.toUpperCase(), 'Welcome back. Your car is where you left it.', 3600);
  },

  retry() {
    if (this.hasSave()) this.loadGame(); else this.newGame();
  },

  toMenu() {
    this.screen = 'menu';
    UI.showHUD(false);
    UI.closePanel();
    UI.hideEnd();
    UI.showMenu(this.hasSave(), this.saveInfo() ? this.saveInfo().label : '');
  },

  refreshMenu() {
    const info = this.saveInfo();
    UI.showMenu(!!info, info ? info.label : '');
    UI.hideEnd();
    UI.showHUD(false);
  },

  // ---------------------------------------------------------------- zones
  enterZone(index) {
    this.zoneIndex = U.clamp(index, 0, ZONES.length - 1);
    this.zone = genZone(this.zoneIndex);
    const car = this.car;
    car.x = this.zone.start.x;
    car.y = this.zone.start.y;
    car.angle = 0;
    car.speed = 0;
    car.steerFront = 0;
    this.camera.x = car.x;
    this.camera.y = car.y;
    this.zoneTime = 0;
    this.spawnTimer = 4;
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.floaters = [];
    this.interact = null;
    this.magnetTimer = 0;
    this._warnedSink = false;
    this.buffs.magnet = 0;
    this.run.visited = Math.max(this.run.visited, this.zoneIndex + 1);
    this.tips = this.zoneIndex === 0 && this.zoneTime === 0 ? [
      { at: 4, text: 'Press <b>C</b> to open the crafting book — <b>1,002 recipes</b> for weapons, turrets, drones and rooms.' },
      { at: 14, text: 'Press <b>B</b>, pick a module, then click a cell on the car roof. That is your house.' },
      { at: 26, text: 'Drive close to a glowing crate and press <b>E</b> to loot it.' },
      { at: 40, text: 'Green markers are survivors. Recruit them with <b>E</b> — they loot, craft, repair and shoot for you.' },
      { at: 58, text: 'Your goal: reach <b>Sunda Docks</b> and buy a Raft Kit + Ship Engine.' },
    ] : [];
    this.recompute();

    // drones regroup around the car
    this.drones.forEach((d) => { d.x = car.x + U.rand(-40, 40); d.y = car.y + U.rand(-40, 40); });

    if (this.zone.def.finale) {
      this.finale = { started: true, wave: 0, waves: 5, remaining: 0, timer: 22, boss: false, done: false };
      UI.toast('The army knows you are here. You have <b>20 seconds</b> to build and repair — then 5 waves.', 'bad');
    } else {
      this.finale = null;
    }
    this.save();
  },

  zoneRequirement(i) {
    if (!this.car) return { ok: true, text: '' };
    if (i >= ZONES.length - 1) return { ok: false, text: 'This is the final zone' };
    const next = ZONES[i + 1];
    const missing = [];
    if (this.car.hull < this.car.hullMax * 0.3) missing.push('hull above 30%');
    if (next.isSea) {
      if (!this.car.raft) missing.push('🛶 Raft Kit');
      if (!this.car.engine) missing.push('⛴️ Ship Engine');
      if ((this.res.fuel || 0) < 40) missing.push('⛽ 40 fuel');
    }
    if (!missing.length) return { ok: true, text: `Sail/drive to ${next.name}` };
    return { ok: false, text: `Need ${missing.join(' + ')}` };
  },

  exitReady() {
    if (!this.zone || this.zone.def.finale) return false;
    return this.zoneRequirement(this.zoneIndex).ok;
  },

  travel() {
    if (this.screen !== 'playing' || UI.panelOpen()) return;
    const e = this.zone.exit;
    if (U.dist(this.car.x, this.car.y, e.x, e.y) > e.r + 40) {
      UI.toast('Drive to the glowing DEPART marker at the far end of the zone.', 'warn');
      return;
    }
    if (this.zone.def.finale) { UI.toast('There is nowhere left to run. Survive the waves.', 'bad'); return; }
    const req = this.zoneRequirement(this.zoneIndex);
    if (!req.ok) { UI.toast(req.text, 'bad'); U.Sfx.error(); return; }
    const next = ZONES[this.zoneIndex + 1];
    if (next.isSea) {
      this.res.fuel = Math.max(0, (this.res.fuel || 0) - 40);
      U.Sfx.travel();
    }
    this.enterZone(this.zoneIndex + 1);
    this.screen = 'playing';
    UI.banner(this.zone.def.name.toUpperCase(), `${this.zone.def.sub} — ${this.zone.def.greeting}`, 5200);
    UI.toast(`Arrived in <b>${this.zone.def.name}</b>.`, 'good');
    this.save();
  },

  // ---------------------------------------------------------------- stats
  makeModule(recipeId) {
    const r = RECIPE_BY_ID[recipeId];
    if (!r) return null;
    const base = MODULE_KINDS[r.out.spec.kind] || {};
    const spec = { ...base, ...r.out.spec };
    return {
      id: recipeId, kind: spec.kind, spec, name: r.name, icon: r.icon,
      aim: 0, cooldown: 0, flash: 0, hitFlash: 0,
    };
  },

  recompute() {
    const car = this.car;
    const st = {
      armor: 0, cap: 900, crewCap: 1, station: 0, solar: 1.2, repair: 0,
      droneCap: 0, houseScore: 0, radar: 600, ram: 0, lootBonus: 0,
      powerMax: 100, craftDiscount: 0, turretDmgMult: 1, weaponDmgMult: 1,
      maxSpeed: 300, accel: 360, turn: 2.6,
    };
    for (const m of car.grid.cells) {
      if (!m) continue;
      const s = m.spec || {};
      st.armor += s.armor || 0;
      st.cap += s.cap || 0;
      st.crewCap += s.crew || 0;
      st.station = Math.max(st.station, s.station || 0);
      st.solar += s.solar || 0;
      st.powerMax += s.powerCap || 0;
      st.repair += s.repair || 0;
      st.droneCap += s.droneCap || 0;
      st.houseScore += s.score || 0;
      st.radar = Math.max(st.radar, s.radar || 0);
      st.ram += s.ram || 0;
      st.lootBonus += s.lootBonus || 0;
      st.craftDiscount += s.craftDiscount || 0;
    }
    const up = this.carUpg;
    st.maxSpeed += up.maxSpeed || 0;
    st.accel += up.accel || 0;
    st.armor += up.armor || 0;
    st.cap += up.cap || 0;
    st.solar += up.solar || 0;
    st.weaponDmgMult += up.weaponDmg || 0;
    st.turretDmgMult += up.turretDmg || 0;
    st.ram += up.ram || 0;
    st.turn += up.turn || 0;

    for (const c of this.crew) {
      const r = c.role;
      if (r === 'engineer') { st.repair += 2; st.craftDiscount += 0.15; }
      else if (r === 'gunner') { st.turretDmgMult += 0.35; }
      else if (r === 'mechanic') { st.armor += 40; st.repair += 0.5; }
      else if (r === 'driver') { st.maxSpeed *= 1.18; st.turn += 0.2; }
      else if (r === 'medic') { st.repair += 1.4; }
      else if (r === 'scavenger') { st.lootBonus += 0.35; }
      else if (r === 'trader') { /* handled in cash gain */ }
    }
    st.armor += this.drones.filter((d) => d.deployed && d.spec.role === 'shield').length * 12;
    st.craftDiscount = Math.min(0.55, st.craftDiscount);
    st.maxSpeed = Math.min(760, st.maxSpeed);
    car.hullMax = 500 + (up.hull || 0);
    car.hull = Math.min(car.hull, car.hullMax);
    this.stats = st;

    // drones deployment follows capacity
    this.drones.forEach((d, i) => { d.deployed = i < st.droneCap && d.hp > 0; });
    if (car.power > st.powerMax) car.power = st.powerMax;

    // home score milestones
    const hs = st.houseScore;
    if (!this._houseMarks.a && hs >= 120) {
      this._houseMarks.a = true;
      UI.toast('🏠 <b>Home score 120</b> — it actually feels like a house now.', 'good');
    }
    if (!this._houseMarks.b && hs >= 350) {
      this._houseMarks.b = true;
      UI.toast('🏠 <b>Home score 350</b> — a fortified caravan.', 'good');
    }
    if (!this._houseMarks.c && hs >= 700) {
      this._houseMarks.c = true;
      UI.toast('🏠 <b>Home score 700</b> — the best car house on Earth.', 'good');
    }
  },

  hasRole(role) { return this.crew.some((c) => c.role === role); },

  rebuildDrones() {
    const old = this.drones;
    this.drones = this.droneItems.map((item, i) => {
      const prev = old[i];
      return {
        recipeId: item.recipeId, name: item.name, spec: item.spec,
        x: prev ? prev.x : this.car.x, y: prev ? prev.y : this.car.y,
        hp: prev ? prev.hp : item.spec.hp, maxHp: item.spec.hp,
        deployed: i < (this.stats ? this.stats.droneCap : 0), cooldown: 0, orbit: (i / Math.max(1, this.droneItems.length)) * U.TAU,
        angle: 0, flash: 0, dead: false, repairTimer: 0, kamikazeReady: true,
      };
    });
  },

  // ---------------------------------------------------------------- input
  bindInput() {
    const canvas = this.canvas;
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (this.screen !== 'playing') {
        if (k === 'escape' && UI.panelOpen()) UI.closePanel();
        return;
      }
      if (e.repeat) return;
      if (k === 'escape') {
        if (UI.panelOpen()) UI.closePanel();
        else if (this.buildMode) this.exitBuild();
        return;
      }
      // panel shortcuts always work, even with a panel open
      if (k === 'b') { this.toggleBuild(); return; }
      if (k === 'c') { this.togglePanel('craft'); return; }
      if (k === 'n') { this.togglePanel('crew'); return; }
      if (k === 'i') { this.togglePanel('items'); return; }
      if (k === 'm') { this.togglePanel('route'); return; }
      if (k === 'h') { this.togglePanel('help'); return; }
      if (k === 'f') { this.togglePanel('shop'); return; }
      if (UI.panelOpen()) return;
      // driving
      const mapped = k === 'arrowup' ? 'w' : k === 'arrowdown' ? 's' : k === 'arrowleft' ? 'a' : k === 'arrowright' ? 'd' : k;
      this.keys[mapped] = true;
      if (k === 'e') { this.interactNow(); return; }
      if (k === 't') { this.travel(); return; }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys[k === 'arrowup' ? 'w' : k === 'arrowdown' ? 's' : k === 'arrowleft' ? 'a' : k === 'arrowright' ? 'd' : k] = false;
    });
    window.addEventListener('blur', () => { this.keys = {}; this.mouse.down = false; });

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });
    canvas.addEventListener('mousedown', (e) => {
      U.Sfx.resume();
      if (this.screen !== 'playing' || UI.panelOpen()) return;
      if (e.button === 0) {
        if (this.buildMode) {
          const idx = this.cellAtScreen(this.mouse.x, this.mouse.y);
          if (idx < 0) {
            const now = performance.now();
            if (!this._missAt || now - this._missAt > 900) {
              this._missAt = now;
              UI.toast('Click a cell on the car roof to build there.', 'warn');
            }
          } else this.placeAtCell(idx);
        } else this.mouse.down = true;
      } else if (e.button === 2 && this.buildMode) {
        const idx = this.cellAtScreen(this.mouse.x, this.mouse.y);
        this.removeCell(idx);
      }
    });
    canvas.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('mouseleave', () => { this.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  // ---------------------------------------------------------------- build mode
  toggleBuild() {
    if (this.screen !== 'playing') return;
    if (UI.panelOpen()) UI.closePanel();
    this.buildMode = !this.buildMode;
    if (this.buildMode) {
      this.mouse.down = false;
      const owned = Object.entries(this.buildInv).filter(([, n]) => n > 0);
      if (!this.buildSelected || !(this.buildInv[this.buildSelected] > 0)) {
        this.buildSelected = owned.length ? owned[0][0] : null;
      }
    }
    UI.setBuildMode(this.buildMode);
    UI.renderBuildTray(this);
    U.Sfx.click();
  },

  exitBuild() {
    const was = this.buildMode;
    this.buildMode = false;
    UI.setBuildMode(false);
    if (this.screen === 'playing') UI.showHUD(true);
    else UI.showHUD(false);
    return was;
  },

  cellAtScreen(sx, sy) {
    const car = this.car;
    const z = this.camera.zoom;
    const wx = (sx - this.view.w / 2) / z + this.camera.x;
    const wy = (sy - this.view.h / 2) / z + this.camera.y;
    const dx = wx - car.x, dy = wy - car.y;
    const c = Math.cos(car.angle), s = Math.sin(car.angle);
    const lx = dx * c + dy * s;
    const ly = -dx * s + dy * c;
    const { cols, rows, cell } = car.grid;
    if (Math.abs(lx) > (cols * cell) / 2 || Math.abs(ly) > (rows * cell) / 2) return -1;
    const col = U.clamp(Math.floor((lx + (cols * cell) / 2) / cell), 0, cols - 1);
    const row = U.clamp(Math.floor((ly + (rows * cell) / 2) / cell), 0, rows - 1);
    return row * cols + col;
  },

  placeAtCell(idx) {
    if (idx < 0) { return; }
    if (!this.buildSelected) { UI.toast('Pick a module from the tray first.', 'warn'); return; }
    if (!(this.buildInv[this.buildSelected] > 0)) { UI.toast('None left in the tray.', 'warn'); return; }
    if (this.car.grid.cells[idx]) { UI.toast('That cell is occupied. Right-click it to remove the module.', 'warn'); return; }
    const mod = this.makeModule(this.buildSelected);
    if (!mod) return;
    this.car.grid.cells[idx] = mod;
    this.buildInv[this.buildSelected]--;
    if (this.buildInv[this.buildSelected] <= 0) {
      delete this.buildInv[this.buildSelected];
      const owned = Object.keys(this.buildInv);
      this.buildSelected = owned.length ? owned[0] : null;
    }
    this.recompute();
    UI.renderBuildTray(this);
    U.Sfx.craft();
    const r = RECIPE_BY_ID[mod.id];
    UI.toast(`Built <b>${r ? r.name : mod.kind}</b> (+${mod.spec.score || 0} home score).`, 'good');
  },

  removeCell(idx) {
    if (idx < 0) return;
    const m = this.car.grid.cells[idx];
    if (!m) return;
    this.car.grid.cells[idx] = null;
    this.buildInv[m.id] = (this.buildInv[m.id] || 0) + 1;
    this.recompute();
    UI.renderBuildTray(this);
    U.Sfx.click();
    UI.toast('Module removed and returned to the tray.', '');
  },

  // ---------------------------------------------------------------- crafting
  craftCost(recipe) {
    const d = this.stats.craftDiscount;
    const cost = {};
    for (const [k, v] of Object.entries(recipe.cost)) {
      cost[k] = Math.max(1, Math.ceil(v * (1 - d)));
    }
    return cost;
  },

  canAfford(cost) {
    return Object.entries(cost).every(([k, v]) => (this.res[k] || 0) >= v);
  },

  payCost(cost) {
    for (const [k, v] of Object.entries(cost)) this.res[k] -= v;
  },

  craft(id) {
    const r = RECIPE_BY_ID[id];
    if (!r) return;
    if (r.station > this.stats.station) {
      UI.toast(`🔒 Needs <b>${STATION_NAMES[r.station]}</b> — build it on the car first.`, 'bad');
      U.Sfx.error();
      return;
    }
    const cost = this.craftCost(r);
    if (!this.canAfford(cost)) {
      const missing = Object.entries(cost).filter(([k, v]) => (this.res[k] || 0) < v)
        .map(([k, v]) => `${RES[k].icon} ${v - Math.floor(this.res[k] || 0)} ${RES[k].name}`).join(', ');
      UI.toast(`Not enough: ${missing}`, 'bad');
      U.Sfx.error();
      return;
    }
    const out = r.out;
    if (out.type === 'vehicle' && (out.upgrade === 'raft' && this.car.raft || out.upgrade === 'engine' && this.car.engine)) {
      UI.toast('That upgrade is already installed on the car.', 'warn');
      return;
    }
    this.payCost(cost);
    this.run.crafted++;
    let msg = '';
    if (out.type === 'weapon') {
      this.weapons.push({ recipeId: r.id, name: r.name, icon: r.icon, stats: out.stats });
      const idx = this.weapons.length - 1;
      const cur = this.currentWeapon();
      const dps = (w) => w.stats.dmg * w.stats.rate * (w.stats.pellets || 1);
      if (this.equipped < 0 || dps(this.weapons[idx]) >= dps(cur)) {
        this.equipped = idx;
        msg = `🔫 <b>${r.name}</b> crafted and equipped.`;
      } else {
        msg = `🔫 <b>${r.name}</b> crafted — stored in your satchel.`;
      }
    } else if (out.type === 'build') {
      this.buildInv[r.id] = (this.buildInv[r.id] || 0) + 1;
      if (!this.buildSelected) this.buildSelected = r.id;
      msg = `🏠 <b>${r.name}</b> added to the build tray. Press <b>B</b> to install it.`;
      UI.renderBuildTray(this);
    } else if (out.type === 'drone') {
      this.droneItems.push({ recipeId: r.id, name: r.name, icon: r.icon, spec: out.spec });
      this.rebuildDrones();
      this.recompute();
      const dep = this.drones.filter((d) => d.deployed).length;
      msg = `🛸 <b>${r.name}</b> built. Drones deployed: ${dep}/${this.stats.droneCap}.${dep < this.droneItems.length ? ' Build Drone Bays for more slots.' : ''}`;
    } else if (out.type === 'utility') {
      this.consumables[r.id] = (this.consumables[r.id] || 0) + 1;
      msg = `🎒 <b>${r.name}</b> stored in the satchel (I).`;
    } else if (out.type === 'vehicle') {
      const up = out.upgrade;
      if (up === 'raft') { this.car.raft = true; msg = '🛶 <b>Raft Kit installed</b> — the car can float.'; }
      else if (up === 'engine') { this.car.engine = true; msg = '⛴️ <b>Ship Engine installed</b> — ocean crossings unlocked.'; }
      else {
        this.carUpg[up] = (this.carUpg[up] || 0) + out.amount;
        msg = `⚙️ <b>${r.name}</b> installed (+${out.amount} ${out.label}).`;
      }
      this.recompute();
    }
    this.recompute();
    UI.toast(msg || `Crafted ${r.name}.`, 'craft');
    U.Sfx.craft();
    UI.refresh();
    this.save();
  },

  equipWeapon(i) {
    if (i < 0 || i >= this.weapons.length) return;
    this.equipped = i;
    UI.toast(`Equipped <b>${this.weapons[i].name}</b>.`, 'good');
    UI.refresh();
  },

  currentWeapon() {
    return this.weapons[this.equipped] || DEFAULT_WEAPON;
  },

  useConsumable(id) {
    const count = this.consumables[id] || 0;
    if (count <= 0) return;
    const r = RECIPE_BY_ID[id];
    if (!r) return;
    const s = r.out.spec;
    const dur = s.duration || 30;
    switch (s.effect) {
      case 'repair':
        this.car.hull = Math.min(this.car.hullMax, this.car.hull + s.amount);
        UI.toast(`Hull repaired +${Math.round(s.amount)}.`, 'good');
        break;
      case 'fuel':
        this.addRes('fuel', s.amount);
        UI.toast(`+${s.amount} ⛽ fuel.`, 'good');
        break;
      case 'ammo':
        this.addRes('ammo', s.amount);
        UI.toast(`+${s.amount} 📦 ammo.`, 'good');
        break;
      case 'power':
        this.car.power = Math.min(this.stats.powerMax, this.car.power + s.amount);
        UI.toast(`+${s.amount} power.`, 'good');
        break;
      case 'armorBuff':
        this.buffs.armor = dur; this.buffs.armorAmt = s.amount;
        UI.toast(`🛡️ +${s.amount} armour for ${dur}s.`, 'good');
        break;
      case 'speedBuff':
        this.buffs.speed = dur;
        UI.toast(`🏎️ +${Math.round(s.amount * 100)}% speed for ${dur}s.`, 'good');
        break;
      case 'dmgBuff':
        this.buffs.dmg = dur;
        UI.toast(`💥 +${Math.round(s.amount * 100)}% damage for ${dur}s.`, 'good');
        break;
      case 'magnet':
        this.buffs.magnet = dur;
        UI.toast(`🧲 Scrap magnet active for ${dur}s — nearby crates loot themselves.`, 'good');
        break;
      case 'emp':
        this.enemies.forEach((e) => { e.stun = Math.max(e.stun, dur); });
        UI.toast('⚡ EMP! Every enemy is stunned.', 'good');
        break;
      case 'smoke':
        this.buffs.smoke = dur;
        UI.toast('💨 Smoke screen — enemy aim is ruined.', 'good');
        break;
      case 'droneRepair':
        this.drones.forEach((d) => { d.hp = d.maxHp; d.repairTimer = 0; });
        this.recompute();
        UI.toast('🤖 Drones fully repaired and redeployed.', 'good');
        break;
      default:
        UI.toast('Nothing happened.', 'warn');
    }
    this.consumables[id]--;
    if (this.consumables[id] <= 0) delete this.consumables[id];
    U.Sfx.craft();
    UI.refresh();
  },

  // ---------------------------------------------------------------- shop
  buy(id) {
    const item = SHOP_ITEMS.find((x) => x.id === id);
    if (!item) return;
    if (!this.nearDock()) { UI.toast('You need to be at a dock to trade.', 'bad'); return; }
    const price = Math.round(item.price * (this.hasRole('trader') ? 0.88 : 1));
    if (this.cash < price) { UI.toast('Not enough cash.', 'bad'); U.Sfx.error(); return; }
    if (id === 'raft') {
      if (this.car.raft) { UI.toast('Raft already installed.', 'warn'); return; }
      this.car.raft = true;
      UI.toast('🛶 <b>Raft Kit installed.</b> The car will float — you still need a ship engine.', 'good');
    } else if (id === 'engine') {
      if (this.car.engine) { UI.toast('Ship engine already installed.', 'warn'); return; }
      this.car.engine = true;
      UI.toast('⛴️ <b>Ship Engine installed.</b> The oceans are open.', 'good');
    } else if (id === 'repair') {
      this.car.hull = this.car.hullMax;
      UI.toast('Hull fully repaired.', 'good');
    } else {
      const map = { fuel: 'fuel', ammo: 'ammo', meds: 'meds', scrap: 'scrap', wood: 'wood', electronics: 'electronics', alloy: 'alloy', nano: 'nano' };
      const key = map[id];
      const amounts = { fuel: 60, ammo: 80, meds: 25, scrap: 60, wood: 60, electronics: 25, alloy: 20, nano: 1 };
      if (key) {
        this.addRes(key, amounts[key]);
        UI.toast(`Bought ${RES[key].icon} ${amounts[key]} ${RES[key].name}.`, 'good');
      }
    }
    this.cash -= price;
    this.recompute();
    UI.refresh();
    U.Sfx.craft();
    this.save();
  },

  sell(res, qty = 25) {
    if (!this.nearDock()) { UI.toast('You need to be at a dock to trade.', 'bad'); return; }
    const have = Math.floor(this.res[res] || 0);
    if (have < qty) { UI.toast('Not enough to sell.', 'warn'); return; }
    this.res[res] -= qty;
    const price = Math.round((RES[res].tier) * 0.9 * qty * (this.hasRole('trader') ? 1.12 : 1));
    this.cash += price;
    UI.toast(`Sold ${qty} ${RES[res].icon} for 🪙 ${price}.`, 'good');
    UI.refresh();
    this.save();
  },

  nearDock() {
    if (!this.zone || !this.zone.dock) return false;
    return U.dist(this.car.x, this.car.y, this.zone.dock.x, this.zone.dock.y) < this.zone.dock.r;
  },

  // ---------------------------------------------------------------- interact
  findInteract() {
    const car = this.car;
    let best = null, bestD = Infinity;
    let crateBest = null, crateD = Infinity;
    for (const ruin of this.zone.ruins) {
      for (const c of ruin.crates) {
        if (c.looted) continue;
        const d = U.dist(car.x, car.y, c.x, c.y);
        if (d < 125 && d < crateD) { crateD = d; crateBest = { type: 'crate', ruin, crate: c }; }
      }
    }
    let npcBest = null, npcD = Infinity;
    for (const ruin of this.zone.ruins) {
      const npc = ruin.npc;
      if (!npc || npc.recruited) continue;
      const d = U.dist(car.x, car.y, npc.x, npc.y);
      if (d < 150 && d < npcD) { npcD = d; npcBest = { type: 'npc', npc, ruin }; }
    }
    if (crateBest && crateD <= npcD) { best = crateBest; bestD = crateD; }
    else if (npcBest) { best = npcBest; bestD = npcD; }
    if (best) return best;
    if (this.zone.dock && U.dist(car.x, car.y, this.zone.dock.x, this.zone.dock.y) < this.zone.dock.r) {
      return { type: 'dock' };
    }
    if (U.dist(car.x, car.y, this.zone.exit.x, this.zone.exit.y) < this.zone.exit.r + 60) {
      return { type: 'exit' };
    }
    return null;
  },

  promptText() {
    const it = this.interact;
    if (!it) return '';
    if (it.type === 'crate') {
      const n = it.ruin.crates.filter((c) => !c.looted).length;
      return `<kbd>E</kbd> Loot <b>${it.ruin.name}</b> · ${n} container${n === 1 ? '' : 's'} left`;
    }
    if (it.type === 'npc') {
      const role = ROLES[it.npc.role];
      const cost = Object.entries(role.cost).map(([k, v]) => `${RES[k].icon}${v}`).join(' ');
      const full = this.crew.length >= this.stats.crewCap;
      return `<kbd>E</kbd> Recruit <b>${it.npc.name}</b> (${role.icon} ${role.name}) · ${cost}${full ? ' · <b style="color:#fca5a5">no free berth</b>' : ''}`;
    }
    if (it.type === 'dock') return `<kbd>E</kbd> Open the <b>Dock</b> — trade, repair, buy a raft`;
    if (it.type === 'exit') {
      const req = this.zone.def.finale ? { ok: false, text: 'final stand' } : this.zoneRequirement(this.zoneIndex);
      const next = ZONES[this.zoneIndex + 1];
      return req.ok
        ? `<kbd>T</kbd> Depart to <b>${next.name}</b>`
        : `<kbd>T</kbd> Depart · <b style="color:#fca5a5">${req.text}</b>`;
    }
    return '';
  },

  interactNow() {
    const it = this.interact;
    if (!it) return;
    if (it.type === 'crate') this.lootCrate(it.ruin, it.crate);
    else if (it.type === 'npc') this.recruit(it.npc);
    else if (it.type === 'dock') this.openShop();
    else if (it.type === 'exit') this.travel();
  },

  addRes(key, amount) {
    const cap = this.stats.cap;
    const before = this.res[key] || 0;
    this.res[key] = Math.min(cap, before + amount);
    return this.res[key] - before;
  },

  lootCrate(ruin, crate) {
    crate.looted = true;
    this.run.looted++;
    const bonus = 1 + this.stats.lootBonus;
    const mult = bonus * (crate.big ? 2.4 : 1);
    const tier = U.clamp(this.zone.def.tier + (crate.big ? 1 : 0), 1, 5);
    const loot = rollLoot(tier, mult * (0.9 + Math.random() * 0.3));
    const gained = [];
    for (const [k, v] of Object.entries(loot)) {
      const got = this.addRes(k, v);
      if (got > 0) gained.push(`${RES[k].icon}${got}`);
    }
    const cash = Math.round(U.randInt(8, 26) * (this.zone.def.tier * 0.7 + 0.6) * (crate.big ? 2 : 1) * (this.hasRole('trader') ? 1.25 : 1));
    this.cash += cash;
    let extra = '';
    // occasional buildable / consumable
    if (Math.random() < 0.26) {
      const pool = RECIPES.filter((r) => r.cat === 'build' && r.tier <= this.zone.def.tier + 1);
      if (pool.length) {
        const r = U.pick(pool);
        this.buildInv[r.id] = (this.buildInv[r.id] || 0) + 1;
        extra += `<br>📦 Found <b>${r.name}</b> (build tray)`;
        UI.renderBuildTray(this);
      }
    } else if (Math.random() < 0.16) {
      const pool = RECIPES.filter((r) => r.cat === 'utility' && r.tier <= this.zone.def.tier + 1);
      if (pool.length) {
        const r = U.pick(pool);
        this.consumables[r.id] = (this.consumables[r.id] || 0) + 1;
        extra += `<br>🎒 Found <b>${r.name}</b>`;
      }
    } else if (Math.random() < 0.06) {
      const pool = RECIPES.filter((r) => r.cat === 'weapon' && r.tier <= this.zone.def.tier + 1);
      if (pool.length) {
        const r = U.pick(pool);
        this.weapons.push({ recipeId: r.id, name: r.name, icon: r.icon, stats: r.out.stats });
        extra += `<br>🔫 Found <b>${r.name}</b> (satchel)`;
      }
    }
    UI.toast(`Looted <b>${ruin.name}</b>: ${gained.join(' ') || 'nothing useful'} · 🪙+${cash}${extra}`, 'good');
    U.Sfx.loot();
    for (let i = 0; i < 12; i++) {
      this.particles.push({
        x: crate.x, y: crate.y, vx: U.rand(-70, 70), vy: U.rand(-90, 20),
        life: 0.7, maxlife: 0.7, color: crate.big ? '#c084fc' : '#fbbf24', size: 3,
      });
    }
    this.floater(crate.x, crate.y - 16, `+🪙${cash}`, '#fbbf24');
    // guards sometimes show up
    const remaining = ruin.crates.filter((c) => !c.looted).length;
    if (remaining > 0 && Math.random() < 0.35 && this.enemies.length < this.zone.def.maxEnemies + 2) {
      const types = Object.keys(this.zone.def.enemies);
      for (let i = 0; i < 2; i++) {
        this.spawnEnemy(U.pick(types), crate.x + U.rand(-90, 90), crate.y + U.rand(-90, 90), true);
      }
      UI.toast('Guards heard you!', 'bad');
    }
  },

  recruit(npc) {
    const role = ROLES[npc.role];
    if (this.crew.length >= this.stats.crewCap) {
      UI.toast('No free berths — build a <b>Crew Bed</b> on the car.', 'warn');
      return;
    }
    const missing = Object.entries(role.cost).filter(([k, v]) => (this.res[k] || 0) < v);
    if (missing.length) {
      UI.toast(`You need ${missing.map(([k, v]) => `${RES[k].icon}${v - (this.res[k] || 0)}`).join(' ')} to convince ${npc.name}.`, 'bad');
      U.Sfx.error();
      return;
    }
    for (const [k, v] of Object.entries(role.cost)) this.res[k] -= v;
    npc.recruited = true;
    this.crew.push({ name: npc.name, role: npc.role });
    this.recompute();
    UI.toast(`<b>${npc.name}</b> joined the crew — ${role.icon} ${role.name}: ${role.desc}`, 'good');
    this.floater(npc.x, npc.y - 30, `${role.icon} ${npc.name} joined!`, '#34d399');
    U.Sfx.craft();
    this.save();
  },

  dismissCrew(i) {
    const c = this.crew[i];
    if (!c) return;
    this.crew.splice(i, 1);
    this.recompute();
    UI.toast(`${c.name} left the caravan.`, '');
    UI.refresh();
  },

  // ---------------------------------------------------------------- combat
  spawnEnemy(type, x, y, silent = false) {
    const def = ENEMY_TYPES[type];
    if (!def) return null;
    const z = this.zone;
    const bound = (v, max) => U.clamp(v, 60, max - 60);
    const e = {
      type, def,
      x: bound(x, z.w), y: bound(y, z.h),
      hp: def.hp * (1 + 0.06 * (z.def.tier - 1)),
      maxHp: def.hp * (1 + 0.06 * (z.def.tier - 1)),
      angle: 0, fireCd: U.rand(0.4, 1.8), stun: 0, seed: Math.random() * 10,
      dead: false,
    };
    e.maxHp = e.hp;
    this.enemies.push(e);
    return e;
  },

  spawnAround(distMin = 760, distMax = 1180) {
    const z = this.zone;
    const types = Object.keys(z.def.enemies);
    const weights = types.map((t) => z.def.enemies[t]);
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let type = types[0];
    for (let i = 0; i < types.length; i++) { roll -= weights[i]; if (roll <= 0) { type = types[i]; break; } }
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * U.TAU;
      const d = U.rand(distMin, distMax);
      const x = this.car.x + Math.cos(a) * d;
      const y = this.car.y + Math.sin(a) * d;
      if (x > 60 && x < z.w - 60 && y > 60 && y < z.h - 60) return this.spawnEnemy(type, x, y);
    }
    return null;
  },

  damageCar(amount, sourceX, sourceY) {
    const armor = this.stats.armor + (this.buffs.armor > 0 ? this.buffs.armorAmt : 0);
    const mult = 1 - U.clamp(armor / (armor + 150), 0, 0.74);
    const dmg = Math.max(1, amount * mult);
    this.car.hull -= dmg;
    this.shake = Math.min(16, this.shake + 3.5);
    U.Sfx.hit();
    this.floater(this.car.x + U.rand(-20, 20), this.car.y - 44, `-${Math.round(dmg)}`, '#f87171', 12);
    for (let i = 0; i < 5; i++) {
      this.particles.push({
        x: this.car.x + U.rand(-30, 30), y: this.car.y + U.rand(-24, 24),
        vx: U.rand(-50, 50), vy: U.rand(-70, 10), life: 0.5, maxlife: 0.5,
        color: '#fca5a5', size: 3,
      });
    }
    if (this.car.hull <= 0) this.gameOver();
  },

  damageEnemy(e, dmg, color = '#fde68a') {
    if (e.dead) return;
    e.hp -= dmg;
    this.floater(e.x + U.rand(-8, 8), e.y - e.def.r - 6, `${Math.round(dmg)}`, color, 11);
    if (e.hp <= 0) this.killEnemy(e);
  },

  killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    this.run.kills++;
    const cash = Math.round(U.randInt(e.def.cash[0], e.def.cash[1]) * (this.hasRole('trader') ? 1.25 : 1) * (1 + this.zone.def.tier * 0.15));
    this.cash += cash;
    this.floater(e.x, e.y - 18, `+🪙${cash}`, '#fbbf24', 12);
    for (let i = 0; i < 14; i++) {
      this.particles.push({
        x: e.x, y: e.y, vx: U.rand(-120, 120), vy: U.rand(-140, 60),
        life: U.rand(0.3, 0.8), maxlife: 0.8, color: U.pick([e.def.color, '#f97316', '#fde68a']), size: U.rand(2, 5),
      });
    }
    // enemies sometimes drop supplies
    if (Math.random() < 0.4) {
      const key = U.pick(['scrap', 'ammo', 'food', 'fuel', 'meds']);
      const got = this.addRes(key, U.randInt(6, 22));
      if (got > 0) this.floater(e.x, e.y - 34, `+${RES[key].icon}${got}`, '#a7f3d0', 11);
    }
    U.Sfx.boom();
    if (e.def.boss) this.victory();
  },

  shootEnemy(e, def) {
    const smoke = this.buffs.smoke > 0;
    const spread = smoke ? 0.5 : 0.08;
    const shots = def.boss ? 3 : 1;
    for (let i = 0; i < shots; i++) {
      const a = U.angTo(e.x, e.y, this.car.x, this.car.y) + U.rand(-spread, spread) + (i - (shots - 1) / 2) * 0.08;
      const speed = e.def.boss ? 520 : 470;
      this.bullets.push({
        x: e.x + Math.cos(a) * (def.r + 4), y: e.y + Math.sin(a) * (def.r + 4),
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        dmg: def.dmg, friendly: false, life: 2.4, big: def.boss, r: 3,
      });
    }
    U.Sfx.tone(e.def.boss ? 110 : 220, 0.05, 'square', 0.025, -60);
  },

  fireWeapon() {
    if (this.fireCd > 0) return;
    const w = this.currentWeapon();
    const st = w.stats;
    const ammoLeft = Math.floor(this.res.ammo || 0);
    const useAmmo = ammoLeft > 0;
    if (useAmmo) this.res.ammo = ammoLeft - 1;
    const dmgMult = (useAmmo ? 1 : 0.45) * this.stats.weaponDmgMult * (this.buffs.dmg > 0 ? 1.3 : 1);
    const car = this.car;
    const a0 = this.aimAngle;
    const muzzle = car.w * 0.36;
    const pellets = st.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      const a = a0 + U.rand(-st.spread, st.spread);
      this.bullets.push({
        x: car.x + Math.cos(a) * muzzle, y: car.y + Math.sin(a) * muzzle,
        vx: Math.cos(a) * st.speed, vy: Math.sin(a) * st.speed,
        dmg: st.dmg * dmgMult, friendly: true, turret: false,
        life: st.range / st.speed || 1.2, splash: st.splash || 0, chain: !!st.chain,
        big: (st.splash || 0) > 0, r: 3,
      });
    }
    this.fireCd = 1 / st.rate;
    this.fireFlash = 0.06;
    this.shake = Math.min(10, this.shake + 0.8);
    U.Sfx.shoot();
    if (!useAmmo) this.magnetTimer = 1;
  },

  updateTurrets(dt) {
    const car = this.car;
    for (let i = 0; i < car.grid.cells.length; i++) {
      const m = car.grid.cells[i];
      if (!m || m.kind !== 'turret') continue;
      m.cooldown -= dt;
      m.flash = Math.max(0, m.flash - dt);
      const p = carCellPos(car, i);
      const wx = car.x + Math.cos(car.angle) * p.x - Math.sin(car.angle) * p.y;
      const wy = car.y + Math.sin(car.angle) * p.x + Math.cos(car.angle) * p.y;
      const spec = m.spec;
      let target = null, bd = spec.range;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = U.dist(wx, wy, e.x, e.y);
        if (d < bd) { bd = d; target = e; }
      }
      if (target) {
        const want = U.angTo(wx, wy, target.x, target.y);
        m.aim = U.angLerp(m.aim || want, want, Math.min(1, 10 * dt));
        if (m.cooldown <= 0 && Math.abs(U.angDiff(m.aim, want)) < 0.35 && car.power >= 1.15) {
          const rate = spec.rate * (this.hasRole('gunner') ? 1.2 : 1);
          m.cooldown = 1 / rate;
          car.power -= 1.15;
          const dmg = spec.dmg * this.stats.turretDmgMult;
          const shots = spec.chain ? 1 : 1;
          for (let s = 0; s < shots; s++) {
            const a = m.aim + U.rand(-0.03, 0.03);
            this.bullets.push({
              x: wx + Math.cos(a) * 12, y: wy + Math.sin(a) * 12,
              vx: Math.cos(a) * 1050, vy: Math.sin(a) * 1050,
              dmg, friendly: true, turret: true, life: spec.range / 1050,
              splash: spec.splash || 0, chain: !!spec.chain, big: (spec.splash || 0) > 0, r: 3,
            });
          }
          m.flash = 0.06;
          U.Sfx.turret();
        }
      } else {
        m.aim = U.angLerp(m.aim || 0, car.angle, Math.min(1, 2 * dt));
      }
    }
  },

  updateDrones(dt) {
    const car = this.car;
    let idx = 0;
    for (const d of this.drones) {
      if (!d.deployed) { d.hp = Math.min(d.maxHp, d.hp); continue; }
      idx++;
      d.cooldown -= dt;
      d.flash = Math.max(0, d.flash - dt);
      const orbit = d.orbit + this.t * 0.7;
      const radius = 62 + (idx % 3) * 16;
      const tx = car.x + Math.cos(orbit) * radius;
      const ty = car.y + Math.sin(orbit) * radius;
      d.x += (tx - d.x) * Math.min(1, 5 * dt);
      d.y += (ty - d.y) * Math.min(1, 5 * dt);
      const role = d.spec.role;
      // repair drones patch the hull
      if (role === 'repair') {
        car.hull = Math.min(car.hullMax, car.hull + (2 + d.spec.hp * 0.01) * dt);
        continue;
      }
      if (role === 'looter') {
        d.repairTimer += dt;
        if (d.repairTimer > 1.2) {
          d.repairTimer = 0;
          for (const ruin of this.zone.ruins) {
            for (const c of ruin.crates) {
              if (!c.looted && U.dist(d.x, d.y, c.x, c.y) < 210) { this.lootCrate(ruin, c); break; }
            }
          }
        }
        continue;
      }
      // find target
      let target = null, bd = d.spec.range;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dd = U.dist(d.x, d.y, e.x, e.y);
        if (dd < bd) { bd = dd; target = e; }
      }
      if (!target) continue;
      if (role === 'kamikaze') {
        const dd = U.dist(d.x, d.y, target.x, target.y);
        if (!d.kamikazeReady) continue;
        d.x += (target.x - d.x) * Math.min(1, 4 * dt);
        d.y += (target.y - d.y) * Math.min(1, 4 * dt);
        if (dd < 34) {
          d.kamikazeReady = false;
          d.hp = 0;
          d.deployed = false;
          this.explode(d.x, d.y, 90, d.spec.dmg * 2.2);
          UI.toast(`${d.name} detonated.`, 'warn');
          setTimeout(() => { d.kamikazeReady = true; d.hp = d.maxHp; this.recompute(); }, 20000);
        }
        continue;
      }
      if (d.cooldown <= 0) {
        d.cooldown = 1 / Math.max(0.2, d.spec.rate);
        d.angle = U.angTo(d.x, d.y, target.x, target.y);
        const a = d.angle + U.rand(-0.04, 0.04);
        this.bullets.push({
          x: d.x + Math.cos(a) * 8, y: d.y + Math.sin(a) * 8,
          vx: Math.cos(a) * 980, vy: Math.sin(a) * 980,
          dmg: d.spec.dmg, friendly: true, turret: true, life: d.spec.range / 980,
          splash: 0, chain: role === 'tesla', big: false, r: 2.5,
        });
        d.flash = 0.05;
        U.Sfx.turret();
      }
    }
    if (this.hasRole('sniper')) {
      this.sniperCd = (this.sniperCd || 0) - dt;
      if (this.sniperCd <= 0) {
        let target = null, bd = 620;
        for (const e of this.enemies) {
          const dd = U.dist(car.x, car.y, e.x, e.y);
          if (dd < bd) { bd = dd; target = e; }
        }
        if (target) {
          this.sniperCd = 1.35;
          const a = U.angTo(car.x, car.y, target.x, target.y) + U.rand(-0.02, 0.02);
          this.bullets.push({
            x: car.x, y: car.y, vx: Math.cos(a) * 1500, vy: Math.sin(a) * 1500,
            dmg: 16 * this.stats.weaponDmgMult, friendly: true, turret: true,
            life: 0.5, splash: 0, chain: false, big: false, r: 2,
          });
          U.Sfx.tone(700, 0.05, 'square', 0.03, -300);
        }
      }
    }
  },

  explode(x, y, radius, dmg) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = U.dist(x, y, e.x, e.y);
      if (d < radius + e.def.r) this.damageEnemy(e, dmg * (1 - d / (radius + e.def.r)), '#fb923c');
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * U.TAU, sp = U.rand(30, 240);
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: U.rand(0.2, 0.7), maxlife: 0.7,
        color: U.pick(['#fb923c', '#fde68a', '#ef4444', '#78716c']), size: U.rand(2, 6),
      });
    }
    this.shake = Math.min(22, this.shake + 7);
    U.Sfx.boom();
  },

  updateBullets(dt) {
    const car = this.car;
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      if (b.x < -100 || b.y < -100 || b.x > this.zone.w + 100 || b.y > this.zone.h + 100) { b.dead = true; continue; }

      if (b.friendly) {
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (U.dist(b.x, b.y, e.x, e.y) < e.def.r + b.r + 2) {
            b.dead = true;
            this.damageEnemy(e, b.dmg, b.turret ? '#67e8f9' : '#fde68a');
            if (b.splash) this.explode(b.x, b.y, b.splash, b.dmg * 0.6);
            if (b.chain) {
              let hits = 0;
              for (const o of this.enemies) {
                if (o === e || o.dead) continue;
                if (U.dist(b.x, b.y, o.x, o.y) < 130 && hits < 3) {
                  this.damageEnemy(o, b.dmg * 0.5, '#c084fc');
                  hits++;
                }
              }
            }
            for (let i = 0; i < 4; i++) {
              this.particles.push({
                x: b.x, y: b.y, vx: U.rand(-80, 80), vy: U.rand(-80, 80),
                life: 0.3, maxlife: 0.3, color: '#fde68a', size: 2,
              });
            }
            break;
          }
        }
      } else {
        // hit drones first (small chance-like geometry)
        let hitDrone = null;
        for (const d of this.drones) {
          if (!d.deployed) continue;
          if (U.dist(b.x, b.y, d.x, d.y) < 11) { hitDrone = d; break; }
        }
        if (hitDrone) {
          b.dead = true;
          hitDrone.hp -= b.dmg * 0.7;
          if (hitDrone.hp <= 0) {
            hitDrone.hp = 0;
            hitDrone.deployed = false;
            UI.toast(`${hitDrone.name} shot down — it will self-repair.`, 'warn');
          }
          continue;
        }
        if (U.circleInBox(b.x, b.y, b.r, car.x, car.y, car.angle, car.w / 2, car.h / 2)) {
          b.dead = true;
          this.damageCar(b.dmg, b.x, b.y);
          for (let i = 0; i < 3; i++) {
            this.particles.push({
              x: b.x, y: b.y, vx: U.rand(-60, 60), vy: U.rand(-60, 60),
              life: 0.3, maxlife: 0.3, color: '#fca5a5', size: 2,
            });
          }
        }
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
  },

  floater(x, y, text, color = '#fff', size = 13) {
    this.floaters.push({ x, y, text, color, size, life: 0.9, maxlife: 0.9, vy: -34 });
  },

  activeBuffs() {
    const out = [];
    if (this.buffs.dmg > 0) out.push({ label: '💥 DAMAGE+', t: this.buffs.dmg });
    if (this.buffs.armor > 0) out.push({ label: '🛡️ ARMOUR+', t: this.buffs.armor });
    if (this.buffs.speed > 0) out.push({ label: '🏎️ SPEED+', t: this.buffs.speed });
    if (this.buffs.magnet > 0) out.push({ label: '🧲 MAGNET', t: this.buffs.magnet });
    if (this.buffs.smoke > 0) out.push({ label: '💨 SMOKE', t: this.buffs.smoke });
    return out;
  },

  objectiveText() {
    if (!this.car) return '';
    const car = this.car;
    const gateDist = Math.round(U.dist(car.x, car.y, this.zone.exit.x, this.zone.exit.y) / 10);
    const gate = `<span style="color:#8b9bb0"> · DEPART 🚩 ${gateDist} m</span>`;
    if (this.zone.def.finale) {
      const f = this.finale;
      if (!f) return 'Final stand.';
      if (f.done) return 'The army is broken. You won.';
      if (f.boss) return '<b>Kill the General\'s tank.</b> Wave 5 of 5.';
      if (f.wave === 0) return 'The army is coming. Build up, craft, repair. <b>5 waves</b>.';
      return `<b>Survive wave ${f.wave} of 5.</b> ${f.remaining} hostiles left${f.remaining === 0 ? ' — patch the hull!' : ''}.`;
    }
    if (!car.raft || !car.engine) {
      const dock = ZONES.findIndex((z) => z.dock);
      if (this.zoneIndex < dock) {
        const buildHint = this.stats.houseScore < 8 ? 'Press <b>B</b> to build your house on the car. ' : '';
        return `${buildHint}Loot the ruins for materials and cash. Reach <b>Sunda Docks</b> to buy a <b>🛶 Raft Kit</b> (950) and a <b>⛴️ Ship Engine</b> (1500).${gate}`;
      }
      return `At the dock, buy the <b>🛶 Raft Kit</b> and <b>⛴️ Ship Engine</b>. You have 🪙 ${this.cash}. Sell surplus resources if needed.`;
    }
    if (this.zoneIndex < ZONES.length - 1) {
      const next = ZONES[this.zoneIndex + 1];
      const req = this.zoneRequirement(this.zoneIndex);
      return `Drive to the <b>DEPART</b> gate. Next: <b>${next.name}</b>. ${req.ok ? 'Ready to travel (T).' : `Not ready: ${req.text}.`}${gate}`;
    }
    return 'Reach the capital.';
  },

  // ---------------------------------------------------------------- update
  update(dt) {
    if (this.screen !== 'playing' || !this.zone) return;
    if (UI.panelOpen()) { this.updateCamera(0); return; }
    this.t += dt;
    this.playtime += dt;
    this.zoneTime += dt;
    const car = this.car;

    // aim
    const wx = (this.mouse.x - this.view.w / 2) / this.camera.zoom + this.camera.x;
    const wy = (this.mouse.y - this.view.h / 2) / this.camera.zoom + this.camera.y;
    this.aimAngle = U.angTo(car.x, car.y, wx, wy);

    // driving
    const throttle = (this.keys.w ? 1 : 0) - (this.keys.s ? 1 : 0);
    const steer = (this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0);
    const onWater = this.zone.def.isSea;
    let maxSpeed = this.stats.maxSpeed * (onWater ? 0.82 : 1);
    if (onWater && this.car.raft) maxSpeed *= this.car.engine ? 1.0 : 0.62;
    if (this.buffs.speed > 0) maxSpeed *= 1.25;
    if (onWater && !this.car.raft) maxSpeed *= 0.35;
    const accel = this.stats.accel * (onWater ? 0.8 : 1);
    const target = throttle > 0 ? maxSpeed : throttle < 0 ? -maxSpeed * 0.42 : 0;
    if (throttle === 0) {
      car.speed *= 1 - Math.min(1, 2.2 * dt);
      if (Math.abs(car.speed) < 4) car.speed = 0;
    } else {
      const diff = target - car.speed;
      const rate = accel * dt * (Math.sign(diff) === Math.sign(car.speed) || car.speed === 0 ? 1 : 2.4);
      car.speed += U.clamp(diff, -rate, rate);
    }
    const steerSpeed = U.clamp(Math.abs(car.speed) / 90, 0, 1);
    car.angle += steer * this.stats.turn * steerSpeed * dt * Math.sign(car.speed || 1);
    car.steerFront = U.lerp(car.steerFront, steer * 0.42, Math.min(1, 10 * dt));
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    this.run.distance += Math.abs(car.speed) * dt * 0.02;
    car.x = U.clamp(nx, 40, this.zone.w - 40);
    car.y = U.clamp(ny, 40, this.zone.h - 40);

    // sinking if in water without a raft
    if (onWater && !car.raft) {
      car.hull -= 26 * dt;
      if (!this._warnedSink) {
        this._warnedSink = true;
        UI.toast('The car is flooding! <b>You need a Raft Kit</b> before crossing water.', 'bad');
      }
      if (Math.random() < dt * 5) {
        this.particles.push({
          x: car.x + U.rand(-40, 40), y: car.y + U.rand(-30, 30),
          vx: 0, vy: -20, life: 0.8, maxlife: 0.8, color: '#7dd3fc', size: 3,
        });
      }
      if (car.hull <= 0) { this.gameOver(); return; }
    }

    // power + passive repair
    car.power = Math.min(this.stats.powerMax, car.power + (this.stats.solar + 0.8) * dt);
    if (this.stats.repair > 0 && car.hull < car.hullMax) {
      car.hull = Math.min(car.hullMax, car.hull + this.stats.repair * dt);
    }

    // timers
    this.fireCd -= dt;
    this.fireFlash = Math.max(0, this.fireFlash - dt);
    this.shake = Math.max(0, this.shake - dt * 26);
    for (const k of ['dmg', 'armor', 'speed', 'magnet', 'smoke']) {
      if (this.buffs[k] > 0) this.buffs[k] = Math.max(0, this.buffs[k] - dt);
    }

    // shooting
    if (this.mouse.down && !this.buildMode) this.fireWeapon();

    // interaction target
    this.interact = this.findInteract();

    // magnet autoloot
    if (this.buffs.magnet > 0) {
      this.magnetTimer -= dt;
      if (this.magnetTimer <= 0) {
        this.magnetTimer = 0.8;
        for (const ruin of this.zone.ruins) {
          for (const c of ruin.crates) {
            if (!c.looted && U.dist(car.x, car.y, c.x, c.y) < 300) { this.lootCrate(ruin, c); break; }
          }
        }
      }
    }

    if (this.tips && this.tips.length && this.zoneTime >= this.tips[0].at) {
      UI.toast(this.tips.shift().text, '');
    }

    this.updateTurrets(dt);
    this.updateDrones(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateSpawns(dt);
    this.updateFinale(dt);
    this.updateCamera(dt);

    // particles
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 30 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 320) this.particles.splice(0, this.particles.length - 320);
    for (const f of this.floaters) {
      f.y += f.vy * dt;
      f.life -= dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);

    // car module hit flashes
    for (const m of car.grid.cells) if (m && m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt * 3);
  },

  updateEnemies(dt) {
    const car = this.car;
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.fireCd -= dt;
      if (e.stun > 0) { e.stun -= dt; continue; }
      const def = e.def;
      const d = U.dist(e.x, e.y, car.x, car.y);
      const ang = U.angTo(e.x, e.y, car.x, car.y);
      e.angle = U.angLerp(e.angle, ang, Math.min(1, 4 * dt));
      let speed = def.speed * (this.buffs.smoke > 0 ? 0.65 : 1) * (1 + 0.04 * (this.zone.def.tier - 1));
      let mvx = 0, mvy = 0;

      if (def.melee) {
        if (d > def.r + 46) { mvx = Math.cos(ang) * speed; mvy = Math.sin(ang) * speed; }
        if (d < def.r + 54 && e.fireCd <= 0) {
          e.fireCd = def.rate;
          this.damageCar(def.dmg, e.x, e.y);
          this.shake = Math.min(18, this.shake + 5);
        }
      } else {
        const ideal = def.vehicle ? 220 : def.range * 0.7;
        let approach = 1;
        if (d < ideal * 0.8) approach = -0.7;
        else if (d < ideal * 1.05) approach = 0.1;
        const strafe = Math.sin(this.t * 1.3 + e.seed) * (def.vehicle ? 0.2 : 0.45);
        mvx = Math.cos(ang) * speed * approach + Math.cos(ang + Math.PI / 2) * speed * strafe;
        mvy = Math.sin(ang) * speed * approach + Math.sin(ang + Math.PI / 2) * speed * strafe;
        if (def.vehicle && d < 120 && e.fireCd <= 0) {
          e.fireCd = 1.4;
          this.damageCar(def.dmg * 1.5, e.x, e.y);
        }
        if (d < def.range && e.fireCd <= 0) {
          e.fireCd = def.rate * U.rand(0.8, 1.25);
          this.shootEnemy(e, def);
        }
      }
      e.x = U.clamp(e.x + mvx * dt, 50, this.zone.w - 50);
      e.y = U.clamp(e.y + mvy * dt, 50, this.zone.h - 50);
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  },

  updateSpawns(dt) {
    if (this.zone.def.finale) return;
    this.spawnTimer -= dt;
    const def = this.zone.def;
    if (this.spawnTimer <= 0 && this.enemies.length < def.maxEnemies) {
      this.spawnTimer = def.spawnEvery * U.rand(0.7, 1.3);
      this.spawnAround();
    }
  },

  updateFinale(dt) {
    const f = this.finale;
    if (!f || !f.started || f.done) return;
    f.remaining = this.enemies.filter((e) => !e.dead).length;
    if (f.remaining === 0) {
      if (f.wave >= f.waves) {
        if (f.boss && this.enemies.length === 0) { /* boss handled in killEnemy */ }
        return;
      }
      f.timer -= dt;
      if (f.timer <= 0) this.startWave(f.wave + 1);
    }
  },

  startWave(n) {
    const f = this.finale;
    f.wave = n;
    f.timer = n === 1 ? 0 : 9;
    f.boss = n === 5;
    const car = this.car;
    const spawn = (type, count) => {
      if (!count) return;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * U.TAU + U.rand(-0.3, 0.3);
        const d = U.rand(760, 1050);
        this.spawnEnemy(type,
          U.clamp(car.x + Math.cos(a) * d, 80, this.zone.w - 80),
          U.clamp(car.y + Math.sin(a) * d, 80, this.zone.h - 80));
      }
    };
    if (n === 5) {
      spawn('soldier', 4);
      spawn('heavy', 2);
      const a = U.rand(0, U.TAU);
      this.spawnEnemy('boss',
        U.clamp(car.x + Math.cos(a) * 520, 100, this.zone.w - 100),
        U.clamp(car.y + Math.sin(a) * 520, 100, this.zone.h - 100));
      UI.banner('WAVE 5 — THE GENERAL', 'The General\'s tank rolls in. Kill it and the army breaks.', 5000);
      U.Sfx.boom();
    } else {
      spawn('soldier', 2 + n * 2);
      if (n >= 2) spawn('heavy', n - 1);
      if (n >= 3) spawn('apc', 1);
      if (n >= 2) spawn('heli', n >= 4 ? 2 : 1);
      UI.banner(`WAVE ${n} / 5`, 'Army units inbound. Hold the line.', 3400);
      U.Sfx.boom();
    }
    UI.toast(`<b>Wave ${n}</b> incoming. ${this.enemies.length} hostiles.`, 'bad');
  },

  updateCamera(dt) {
    const car = this.car;
    const cam = this.camera;
    if (dt > 0) {
      const f = 1 - Math.exp(-7 * dt);
      cam.x += (car.x - cam.x) * f;
      cam.y += (car.y - cam.y) * f;
    }
    const halfW = this.view.w / 2 / cam.zoom;
    const halfH = this.view.h / 2 / cam.zoom;
    if (this.zone.w > halfW * 2) cam.x = U.clamp(cam.x, halfW, this.zone.w - halfW);
    else cam.x = this.zone.w / 2;
    if (this.zone.h > halfH * 2) cam.y = U.clamp(cam.y, halfH, this.zone.h - halfH);
    else cam.y = this.zone.h / 2;
  },

  // ---------------------------------------------------------------- end states
  gameOver() {
    if (this.screen !== 'playing') return;
    this.screen = 'dead';
    this.mouse.down = false;
    this.keys = {};
    U.Sfx.boom();
    UI.closePanel();
    this.exitBuild();
    UI.showHUD(false);
    UI.showEnd(false, 'WRECKED', 'The car gave out somewhere on the road. Your progress up to the last save point is safe.', [
      { label: 'ZONE', value: this.zone.def.name },
      { label: 'KILLS', value: this.run.kills },
      { label: 'CONTAINERS', value: this.run.looted },
      { label: 'HOME SCORE', value: this.stats.houseScore },
    ]);
  },

  victory() {
    if (this.screen !== 'playing') return;
    this.screen = 'won';
    this.finale.done = true;
    this.mouse.down = false;
    this.keys = {};
    U.Sfx.travel();
    UI.closePanel();
    this.exitBuild();
    UI.showHUD(false);
    UI.showEnd(true, 'FREE', 'The General\'s tank burns on Pennsylvania Avenue. The army melts away into the ruins. You park the car house under the Washington Monument, put the kettle on, and for the first time in years nobody is shooting at you.', [
      { label: 'KILLS', value: this.run.kills },
      { label: 'CONTAINERS', value: this.run.looted },
      { label: 'CRAFTED', value: this.run.crafted },
      { label: 'HOME SCORE', value: this.stats.houseScore },
      { label: 'CREW', value: this.crew.length },
      { label: 'KM', value: Math.round(this.run.distance) },
    ]);
    this.save();
  },

  // ---------------------------------------------------------------- frame
  frame(dt) {
    if (this.screen === 'playing') this.update(dt);
    if (this.zone && this.screen !== 'menu') {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const shake = this.shake;
      const cam = this.camera;
      if (shake > 0.1) {
        const ox = cam.x, oy = cam.y;
        cam.x += U.rand(-shake, shake) * 0.4;
        cam.y += U.rand(-shake, shake) * 0.4;
        draw(this, ctx, this.view);
        cam.x = ox; cam.y = oy;
      } else {
        draw(this, ctx, this.view);
      }
      drawMinimap(this, UI.el.minimap.getContext('2d'), UI.el.minimap.width, UI.el.minimap.height);
      UI.updateHUD(this);
    }
  },
};

// expose actions for main.js
