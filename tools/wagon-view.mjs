// Dev tool: render the wagon from a few free-camera angles (no chase camera).
//   node tools/wagon-view.mjs   ->  shots/wagon-*.png
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
window.HTMLCanvasElement.prototype.getContext = function () {
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
const { Camera3D, S } = await import('../js/camera3d.js');

const canvasEl = document.getElementById('game');
G.init(canvasEl);
G.ctx = canvasEl.getContext('2d');
G.newGame();

const dump = (name) => {
  const entry = backing.get(canvasEl);
  fs.writeFileSync(new URL(`../shots/${name}.png`, import.meta.url), entry.canvas.toBuffer('image/png'));
  console.log('wrote shots/' + name + '.png');
};

const freeCam = (side, dist, height, lift = 0) => {
  Camera3D.update = function (g2) {
    const car = g2.car;
    const yaw = car.angle;
    const cx0 = car.x * S, cz0 = car.y * S;
    const ox = Math.cos(yaw) * Math.cos(side) - Math.sin(yaw) * Math.sin(side);
    const oz = Math.cos(yaw) * Math.sin(side) + Math.sin(yaw) * Math.cos(side);
    const ty = 2.1 + lift;
    this.pos.x = cx0 + ox * dist;
    this.pos.y = ty + height;
    this.pos.z = cz0 + oz * dist;
    const lx = cx0 - this.pos.x, ly = ty - this.pos.y, lz = cz0 - this.pos.z;
    this.yaw = Math.atan2(lz, lx);
    this.pitch = Math.atan2(-ly, Math.hypot(lx, lz));
    this.focal = (g2.view.h / 2) / Math.tan((62 * Math.PI / 180) / 2);
    this.mode = 'car';
  };
};

for (let i = 0; i < 40; i++) G.frame(1 / 60);
G.car.x = G.zone.w / 2;
G.car.y = G.zone.h / 2;
G.night = 0;
for (let i = 0; i < 20; i++) G.frame(1 / 60);

const views = [
  ['wagon-nose', 0.85, 13, 6.2],
  ['wagon-side', 1.6, 14, 4.6],
  ['wagon-rear', -2.4, 13, 6.2],
];
for (const [name, side, dist, height] of views) {
  freeCam(side, dist, height);
  G.car.angle = 0.35;
  for (let i = 0; i < 5; i++) G.frame(1 / 60);
  dump(name);
}
