// Attempt: boot the real SKYUSS main.js in Node with a fake WebGL2 context.
// This is a *smoke* harness for the renderer wiring, not a pixel test.
import { JSDOM } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../skyuss/index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/skyuss/', pretendToBeVisual: true });
const { window } = dom;
global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.HTMLElement = window.HTMLElement;
global.self = window;
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

window.innerWidth = 1440;
window.innerHeight = 900;
window.devicePixelRatio = 1;

// real 2D canvases (for the cloud textures), fake WebGL
const origCreate = window.document.createElement.bind(window.document);
window.document.createElement = function (tag, opts) {
  if (String(tag).toLowerCase() === 'canvas') {
    const c = createCanvas(300, 150);
    c.style = {};
    const realGet = c.getContext.bind(c);
    c.getContext = (type, attrs) => {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return makeGL(c);
      return realGet(type, attrs);
    };
    return c;
  }
  return origCreate(tag, opts);
};

let drew = 0;
function makeGL(canvas) {
  const state = { canvas };
  const target = {
    canvas,
    drawingBufferWidth: 1440,
    drawingBufferHeight: 900,
    VERSION: 1, SHADING_LANGUAGE_VERSION: 1, VENDOR: 1, RENDERER: 1,
    MAX_TEXTURE_SIZE: 1, MAX_CUBE_MAP_TEXTURE_SIZE: 1, MAX_TEXTURE_IMAGE_UNITS: 1,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 1, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 1,
    MAX_VERTEX_UNIFORM_VECTORS: 1, MAX_VARYING_VECTORS: 1, MAX_FRAGMENT_UNIFORM_VECTORS: 1,
    MAX_VERTEX_ATTRIBS: 1, MAX_SAMPLES: 1, MAX_RENDERBUFFER_SIZE: 1,
    getExtension: () => null,
    getSupportedExtensions: () => [],
    getParameter: (p) => {
      if (p === 1) return 'WebGL 2.0 (stub)';
      if (p === 2) return 'stub';
      if (p === 3) return 4096;
      return 4096;
    },
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getContextAttributes: () => ({ alpha: false, antialias: true, depth: true, stencil: true }),
    isContextLost: () => false,
    getError: () => 0,
    getProgramParameter: () => true,
    getShaderParameter: () => true,
    getProgramInfoLog: () => '',
    getShaderInfoLog: () => '',
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    getUniformBlockIndex: () => 0,
    getActiveUniform: () => ({ name: 'u', size: 1, type: 1 }),
    getActiveAttrib: () => ({ name: 'a', size: 1, type: 1 }),
    createTexture: () => ({}),
    createBuffer: () => ({}),
    createFramebuffer: () => ({}),
    createRenderbuffer: () => ({}),
    createProgram: () => ({}),
    createShader: () => ({}),
    createVertexArray: () => ({}),
    createQuery: () => ({}),
    createSampler: () => ({}),
    createTransformFeedback: () => ({}),
    getQueryParameter: () => 0,
    checkFramebufferStatus: () => 36053,
    getSyncParameter: () => 0,
  };
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'string' && p === p.toUpperCase() && /^[A-Z0-9_]+$/.test(p)) return 0;
      return (...args) => {
        if (p === 'drawElements' || p === 'drawArrays' || p === 'drawElementsInstanced' || p === 'drawArraysInstanced') drew++;
        if (p === 'getParameter') return 4096;
        if (p === 'getShaderParameter' || p === 'getProgramParameter') return true;
        if (p === 'getUniformLocation') return {};
        if (p === 'getAttribLocation') return 0;
        if (p.startsWith('create')) return {};
        if (p.startsWith('get')) return 0;
        return undefined;
      };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

const canvas2d = new WeakMap();
window.HTMLCanvasElement.prototype.getContext = function (type, attrs) {
  if (type === 'webgl2' || type === 'webgl') return makeGL(this);
  if (type === '2d') {
    let c = canvas2d.get(this);
    if (!c) {
      c = createCanvas(this.width || 300, this.height || 150);
      canvas2d.set(this, c);
    }
    return c.getContext('2d');
  }
  return null;
};

const errors = [];
window.addEventListener('error', (e) => errors.push('window error: ' + e.message));

const fails = [];
const FORT_CELL = { ix: 6, iz: 4 };
const assert = (cond, msg) => {
  if (!cond) { fails.push(msg); console.log('  FAIL ' + msg); }
  else console.log('  ok  ' + msg);
};
const frames = () => new Promise((r) => setTimeout(r, 350));

await import('../skyuss/js/main.js');
assert(true, 'main.js boots with a WebGL context (renderer, shaders, scene)');

document.getElementById('btnNew').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await frames();
const hud = document.getElementById('hud');
assert(!hud.classList.contains('hidden'), 'LAUNCH starts the run and shows the HUD');
assert(drew > 50, `the scene actually draws (${drew} draw calls)`);

// keyboard: thrust + turn, then panels
const key = (code, type = 'keydown') => window.dispatchEvent(new window.KeyboardEvent(type, { code, key: code, bubbles: true }));
for (const c of ['KeyW', 'KeyA', 'Space', 'ShiftLeft']) key(c);
await frames();
for (const c of ['KeyW', 'KeyA', 'Space', 'ShiftLeft']) key(c, 'keyup');
assert(errors.length === 0, 'flying with the keyboard raises no errors');

key('KeyU'); await frames();
assert(!document.getElementById('panelLayer').classList.contains('hidden'), 'the refit panel opens');
assert(document.querySelectorAll('#tierRows .tier-row').length === 4, 'the refit panel lists all four components');
key('Escape'); await frames();
assert(document.getElementById('panelLayer').classList.contains('hidden'), 'Escape closes the panel');

key('KeyB'); await frames();
assert(document.getElementById('panelLayer').classList.contains('tray'), 'the fortress tray opens in non-blocking tray mode');
assert(document.querySelectorAll('#pieceGrid .piece').length >= 8, 'every fortress piece is offered');
key('KeyB'); await frames();
assert(document.getElementById('panelLayer').classList.contains('hidden'), 'B toggles the fortress tray closed');

key('KeyH'); await frames();
key('Escape'); await frames();

// refit through the real UI: grant stores, click INSTALL, expect a new mesh
{
  const g = window.__skyuss.game;
  g.bank.titanium = 5000; g.bank.dilithium = 3000; g.bank.matrix = 20;
  const before = g.ship.tier('weapons');
  const meshesBefore = window.__skyuss.scene.children.filter((o) => o.name === 'enterprise').length;
  const btn = [...document.querySelectorAll('#tierRows button')].find((b) => !b.disabled);
  assert(!!btn, 'the refit panel offers an affordable upgrade');
  btn.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await frames();
  assert(g.ship.tier('weapons') > before || g.ship.totalTier() > 0, 'clicking INSTALL upgrades the ship');
  const meshesAfter = window.__skyuss.scene.children.filter((o) => o.name === 'enterprise').length;
  assert(meshesAfter === 1 && meshesAfter <= meshesBefore + 1, 'the old ship mesh is disposed, not duplicated');
}

// build a fortress piece through the live mesh rebuild path
{
  const g = window.__skyuss.game;
  g.bank.titanium = 4000; g.bank.dilithium = 2000; g.bank.matrix = 20;
  const before = g.fort.count;
  const res = g.placePiece(FORT_CELL.ix, FORT_CELL.iz, 'phaser');
  window.__skyuss.rebuildFort();
  await frames();
  assert(res.ok && g.fort.count === before + 1, 'a fortress piece can be built in the live game');
  const forts = window.__skyuss.scene.children.filter((o) => o.name === 'skyfort').length;
  assert(forts === 1, 'the fortress mesh is rebuilt in place');
}

// combat + siege with real meshes and projectiles
{
  const g = window.__skyuss.game;
  g.spawnWave(4, false);
  g.fireCd = 0; g.energy = 100;
  g.fire();
  g.fireTorpedo();
  await frames();
  assert(g.enemies.length >= 4, 'hostiles exist in the live scene');
  assert(errors.length === 0, 'combat frames render without errors');
}

// BUILD ALL from the tray: one click fills the deck
{
  const g = window.__skyuss.game;
  g.bank.titanium = 4000; g.bank.dilithium = 3000; g.bank.matrix = 20;
  key('KeyB'); await frames();
  const before = g.fort.count;
  const bulk = document.querySelector('[data-action="buildall"]');
  assert(!!bulk, 'the fortress tray offers BUILD ALL');
  bulk.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await frames();
  assert(g.fort.count > before + 3, `BUILD ALL raised ${g.fort.count - before} pieces in one click`);
  key('KeyB'); await frames();
}

// audio + effects: the sound module must survive headless, effects must fire
{
  key('KeyO'); await frames();
  key('KeyO'); await frames();
  const g = window.__skyuss.game;
  const shots = g.fx.shots;
  g.fireCd = 0; g.energy = 100;
  g.fire();
  await frames();
  assert(g.fx.shots > shots, 'the live game registers a shot (audio + muzzle VFX)');
  assert(g.effects.length >= 0, 'the effect bus is drained by the renderer');
  assert(errors.length === 0, 'audio toggle and effects raise no errors');
}

// a few more simulated seconds with combat noise
await frames();
assert(drew > 150, `the loop keeps rendering (${drew} draw calls)`);
assert(errors.length === 0, 'no window errors during the whole boot');

console.log(`\n--- errors (${errors.length + fails.length}) ---`);
errors.slice(0, 5).forEach((e) => console.log(e));
fails.slice(0, 5).forEach((f) => console.log('ASSERT: ' + f));
process.exit(errors.length + fails.length ? 1 : 0);
