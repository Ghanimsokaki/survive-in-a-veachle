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
G.mouse.x = 1100; G.mouse.y = 320;
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

console.log('done');
