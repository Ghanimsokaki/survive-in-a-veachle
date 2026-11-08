// Renders real game frames to PNG with a native canvas backend (dev tool).
import { JSDOM } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.performance = window.performance;
global.HTMLElement = window.HTMLElement;
window.innerWidth = 1600;
window.innerHeight = 900;
window.devicePixelRatio = 1;

const origCreate = window.document.createElement.bind(window.document);
window.document.createElement = function (tag, opts) {
  if (String(tag).toLowerCase() === 'canvas') {
    const c = createCanvas(300, 150);
    c.style = {};
    return c;
  }
  return origCreate(tag, opts);
};

const backing = new WeakMap();
window.HTMLCanvasElement.prototype.getContext = function (type) {
  const w = this.width || 300, h = this.height || 150;
  const key = `${w}x${h}`;
  let entry = backing.get(this);
  if (!entry || entry.key !== key) {
    const c = createCanvas(w, h);
    entry = { key, canvas: c, ctx: c.getContext('2d') };
    backing.set(this, entry);
  }
  return entry.ctx;
};

const { G } = await import('../js/game.js');
const { UI } = await import('../js/ui.js');
const { RECIPES } = await import('../js/recipes.js');

const canvasEl = document.getElementById('game');
G.init(canvasEl);
G.ctx = canvasEl.getContext('2d');
G.newGame();

function shot(name, frames = 2) {
  for (let i = 0; i < frames; i++) G.frame(1 / 60);
  const entry = backing.get(canvasEl);
  const buf = entry.canvas.toBuffer('image/png');
  fs.writeFileSync(new URL(`../shots/${name}.png`, import.meta.url), buf);
  console.log('wrote shots/' + name + '.png', entry.canvas.width, 'x', entry.canvas.height);
}

fs.mkdirSync(new URL('../shots', import.meta.url), { recursive: true });

// --- 1. starting view (empty car on the road, first ruins)
for (let i = 0; i < 40; i++) G.frame(1 / 60);
G.car.x = G.zone.ruins[0].cx - 60;
G.car.y = G.zone.ruins[0].cy + 140;
for (let i = 0; i < 30; i++) G.frame(1 / 60);
shot('01-start');

// --- 2. build lots of modules on the car + turrets and drones
const pool = RECIPES.filter((r) => r.cat === 'build');
const kinds = ['floor', 'wall', 'storage', 'bed', 'solar', 'turret', 'medbay', 'garden', 'antenna', 'dronebay', 'spikes', 'shield', 'workbench', 'advbench', 'nanolab'];
let cellIdx = 0;
for (const kind of kinds) {
  const pick = pool.find((r) => r.out.spec.kind === kind && r.tier >= 2) || pool.find((r) => r.out.spec.kind === kind);
  if (!pick) continue;
  G.buildInv[pick.id] = (G.buildInv[pick.id] || 0) + 1;
  G.buildSelected = pick.id;
  G.placeAtCell(cellIdx % 24);
  cellIdx += 1;
}
const turret = RECIPES.find((r) => r.cat === 'turret' && r.tier === 3);
for (const c of [5, 11, 17, 23]) {
  G.buildInv[turret.id] = 4;
  G.buildSelected = turret.id;
  G.placeAtCell(c);
}
G.recompute();
G.car.hull = G.car.hullMax * 0.62;
G.spawnEnemy('raider', G.car.x + 170, G.car.y - 110);
G.spawnEnemy('brute', G.car.x - 150, G.car.y + 90);
G.spawnEnemy('car', G.car.x + 230, G.car.y + 40);
let spotX = G.zone.w * 0.42;
for (let x = 700; x < G.zone.w - 700; x += 80) {
  if (G.zone.ruins.every((r) => Math.hypot(r.cx - x, r.cy - G.zone.h / 2) > 700)) { spotX = x; break; }
}
G.car.x = spotX;
G.car.y = G.zone.h / 2;
G.car.angle = Math.PI * 0.02;
G.enemies.forEach((e, i) => {
  e.x = G.car.x + [230, -220, 260][i % 3];
  e.y = G.car.y + [-150, 120, 60][i % 3];
});
G.mouse.x = 1100; G.mouse.y = 320;
G.setPaint('rust');
for (let i = 0; i < 90; i++) G.frame(1 / 60);
shot('02-car-house');

// --- 3. loot-heavy view near a ruin with crates
const ruin = G.zone.ruins[2];
G.car.x = ruin.cx; G.car.y = ruin.cy + 90;
for (let i = 0; i < 40; i++) G.frame(1 / 60);
shot('03-ruin');

// --- 4. sea zone with raft
G.enterZone(3);
for (let i = 0; i < 90; i++) G.frame(1 / 60);
shot('04-ocean');

// --- 5. washington finale
G.enterZone(9);
G.car.raft = true; G.car.engine = true;
G.finale.timer = 0;
for (let i = 0; i < 200; i++) G.frame(1 / 60);
shot('05-finale');

// --- 6. on foot next to the car house
G.enterZone(0);
G.buildInv = {};
const bpool = RECIPES.filter((r) => r.cat === 'build');
let ci = 0;
for (const kind of ['floor', 'floor', 'storage', 'bed', 'solar', 'wall', 'garden', 'antenna']) {
  const pick = bpool.find((r) => r.out.spec.kind === kind);
  if (!pick) continue;
  G.buildInv[pick.id] = 1;
  G.buildSelected = pick.id;
  G.placeAtCell(ci);
  ci += 1;
}
G.car.interior = new Array(6).fill(null).map((_, i) => {
  const it = ['cot', 'stove', 'shelf', 'tank', 'plant', 'radio'][i];
  return { id: it, kind: it, name: it, icon: '', stat: {} };
});
G.recompute();
for (let i = 0; i < 40; i++) G.frame(1 / 60);
G.player.x = G.car.x + 130;
G.player.y = G.car.y + 80;
G.player.onFoot = true;
G.camYaw = G.player.face = Math.PI * 0.35;
G.mouse.x = 980; G.mouse.y = 520;
for (let i = 0; i < 70; i++) G.frame(1 / 60);
shot('06-on-foot');

// --- 7. interior build mode (x-ray view into the cabin)
G.player.onFoot = false;
G.toggleBuild();
G.setBuildTarget('interior');
G.interiorSelected = 'fridge';
for (let i = 0; i < 90; i++) G.frame(1 / 60);
shot('07-interior');

// --- 8. the new building modules (bathroom, window, campfire, dish, barrel, bench, hive)
G.exitBuild();
G.enterZone(1);
G.buildInv = {};
G.car.grid.cells = new Array(G.car.grid.cells.length).fill(null);
G.car.interior = new Array(6).fill(null);
G.recompute();
let ni = 0;
for (const kind of ['bathroom', 'window', 'campfire', 'internet', 'watertank', 'crafttable', 'dronehive', 'floor', 'wall']) {
  const pick = RECIPES.find((r) => r.cat === 'build' && r.out.spec.kind === kind);
  if (!pick) continue;
  G.buildInv[pick.id] = 1;
  G.buildSelected = pick.id;
  G.placeAtCell(ni);
  ni += 1;
}
G.recompute();
G.car.hull = G.car.hullMax;
G.toggleBuild();
G.mouse.x = 900; G.mouse.y = 360;
for (let i = 0; i < 60; i++) G.frame(1 / 60);
shot('08-new-modules');
G.exitBuild();

// --- 9. anomaly tornado at night, anchor deployed
G.enterZone(2);
G.car.hull = G.car.hullMax;
G.car.anchors = 2;
G.spawnTornado();
G.night = 0.9;
G.car.anchorT = 30;
G.tornado.life = 60;
G.car.angle = -Math.PI * 0.5;
for (let i = 0; i < 30; i++) G.frame(1 / 60);
for (let i = 0; i < 8; i++) {
  G.tornado.x = G.car.x + Math.cos(G.car.angle) * 700 + (i % 2 ? 60 : -60);
  G.tornado.y = G.car.y + Math.sin(G.car.angle) * 700;
  G.tornado.life = 60;
  G.frame(1 / 60);
}
shot('09-anomaly-tornado');

// --- 10-12. the wagon itself: turning, hero angle, night
G.endTornado(false);
G.night = 0;
G.enterZone(0);
G.car.raft = false;
G.car.hull = G.car.hullMax;
G.car.anchors = 1;
G.car.angle = 0.5;
G.mouse.x = 1000; G.mouse.y = 420;
for (let i = 0; i < 90; i++) G.frame(1 / 60);
// mid-turn: the chase camera lags, so the wagon is seen at an angle
G.car.angle = 1.15;
G.frame(1 / 60);
G.frame(1 / 60);
shot('10-wagon-turning');

const { Camera3D, S } = await import('../js/camera3d.js');
const freeCam = (side, dist, height, lift = 0) => {
  Camera3D.update = function (g2) {
    const car = g2.car;
    const yaw = car.angle;
    const c0x = car.x * S, c0z = car.y * S;
    const ox = Math.cos(yaw) * Math.cos(side) - Math.sin(yaw) * Math.sin(side);
    const oz = Math.cos(yaw) * Math.sin(side) + Math.sin(yaw) * Math.cos(side);
    const ty = 2.1 + lift;
    this.pos.x = c0x + ox * dist;
    this.pos.y = ty + height;
    this.pos.z = c0z + oz * dist;
    const lx = c0x - this.pos.x, ly = ty - this.pos.y, lz = c0z - this.pos.z;
    this.yaw = Math.atan2(lz, lx);
    this.pitch = Math.atan2(-ly, Math.hypot(lx, lz));
    this.focal = (g2.view.h / 2) / Math.tan((62 * Math.PI / 180) / 2);
    this.mode = 'car';
  };
};
freeCam(0.85, 12.5, 6.2);
G.car.angle = 0.35;
for (let i = 0; i < 6; i++) G.frame(1 / 60);
shot('11-wagon-hero');

G.night = 0.85;
freeCam(-2.3, 11.5, 5.2);
for (let i = 0; i < 6; i++) G.frame(1 / 60);
shot('12-wagon-night');

console.log('done');
