import { JSDOM } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
global.window = window; global.document = window.document;
global.localStorage = window.localStorage; global.performance = window.performance;
global.HTMLElement = window.HTMLElement;
window.innerWidth = 1600; window.innerHeight = 900; window.devicePixelRatio = 1;
const origCreate = window.document.createElement.bind(window.document);
window.document.createElement = function (tag, opts) {
  if (String(tag).toLowerCase() === 'canvas') { const c = createCanvas(300, 150); c.style = {}; return c; }
  return origCreate(tag, opts);
};
const backing = new WeakMap();
window.HTMLCanvasElement.prototype.getContext = function () {
  const w = this.width || 300, h = this.height || 150;
  let e = backing.get(this);
  if (!e || e.key !== `${w}x${h}`) { const c = createCanvas(w, h); e = { key: `${w}x${h}`, canvas: c, ctx: c.getContext('2d') }; backing.set(this, e); }
  return e.ctx;
};
const { G } = await import('../js/game.js');
const { faceStats } = await import('../js/render.js');
const el = document.getElementById('game');
G.init(el); G.ctx = el.getContext('2d');
G.newGame();
for (let i = 0; i < 30; i++) G.frame(1 / 60);
const t0 = process.hrtime.bigint();
for (let i = 0; i < 120; i++) G.frame(1 / 60);
const t1 = process.hrtime.bigint();
console.log('avg frame ms', Number(t1 - t0) / 1e6 / 120);
console.log('faces', faceStats);
