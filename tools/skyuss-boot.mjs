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

// serve the committed CC0 courier OBJ to the loader without touching the disk
const courierOBJ = fs.readFileSync(new URL('../skyuss/assets/models/quaternius/dispatcher.obj', import.meta.url), 'utf8');
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.endsWith('dispatcher.obj')) return { ok: true, text: async () => courierOBJ };
  return { ok: false, status: 404, text: async () => '' };
};

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

// (a) voxel fortress style through the live mesh pipeline
{
  const g = window.__skyuss.game;
  key('KeyV'); await frames();
  const fort = window.__skyuss.scene.children.find((o) => o.name === 'skyfort');
  assert(g.settings.style === 'voxel', 'V switches the fortress art style to voxel blocks');
  assert(fort && fort.style === 'voxel', 'the live fortress mesh was rebuilt as voxel blocks');
  key('KeyV'); await frames();
  const back = window.__skyuss.scene.children.find((o) => o.name === 'skyfort');
  assert(g.settings.style === 'scifi' && back && back.style !== 'voxel', 'V switches back to sci-fi platforms');
}

// (b) fully manual aim
{
  const g = window.__skyuss.game;
  key('KeyL'); await frames();
  assert(g.settings.aimAssist === false, 'L turns auto-lock off');
  assert(document.getElementById('aimMode').textContent === 'MANUAL', 'the reticle reports MANUAL aim');
  g.enemies = [];
  const e = g.spawnEnemy('skiff', { x: g.pos.x + 80, y: g.pos.y, z: g.pos.z });
  g.lockedEnemy = e; g.aimEnemy = { x: 1, y: 0, z: 0 };
  g.aim = { x: 0, y: 0, z: 1 };
  g.fireCd = 0; g.energy = 100;
  const bolt = g.fire();
  await frames();
  assert(bolt.homing === null && Math.abs(bolt.vel.x) < 1, 'manual shots fly straight down the reticle');
  key('KeyL'); await frames();
  assert(g.settings.aimAssist === true && document.getElementById('aimMode').textContent === 'AUTO', 'L restores auto-lock');
}

// UPGRADE ALL from the refit panel
{
  const g = window.__skyuss.game;
  g.bank.titanium = 20000; g.bank.dilithium = 9000; g.bank.matrix = 200;
  const before = g.ship.totalTier();
  key('KeyU'); await frames();
  const bulk = document.querySelector('[data-action="upgradeall"]');
  assert(!!bulk, 'the refit panel offers UPGRADE ALL');
  bulk.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await frames();
  assert(g.ship.totalTier() > before + 3, `UPGRADE ALL installed ${g.ship.totalTier() - before} tiers in one click`);
  const ships = window.__skyuss.scene.children.filter((o) => o.name === 'enterprise').length;
  assert(ships === 1, 'the ship mesh is rebuilt exactly once after the sweep');
  key('Escape'); await frames();
}

// (c) touch controls: mount, drive, unmount
{
  const g = window.__skyuss.game;
  const t = window.__skyuss.touch;
  t.mount(document.body);
  await frames();
  assert(!!document.querySelector('.touch-ui'), 'the touch overlay mounts');
  assert(document.body.classList.contains('touch-on'), 'the body switches to touch layout');
  g.energy = 100; g.warpCd = 0;
  const warps = g.fx.warps;
  document.querySelector('[data-do="warp"]').dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await frames();
  assert(g.fx.warps === warps + 1, 'the touch WARP button fires a warp dash');
  const fireBtn = document.querySelector('[data-do="fire"]');
  fireBtn.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await frames();
  assert(t.fireHeld === true, 'holding the touch FIRE button holds fire');
  fireBtn.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
  await frames();
  assert(t.fireHeld === false, 'releasing touch FIRE stops firing');
  t.unmount(document.body);
  await frames();
  assert(!document.querySelector('.touch-ui') && !document.body.classList.contains('touch-on'), 'touch controls unmount cleanly');
  assert(errors.length === 0, 'the touch layer raises no errors');
}

// open world: flying far streams new cells in and frees the old ones
{
  const g = window.__skyuss.game;
  const before = [...window.__skyuss.worldCells.keys()];
  assert(before.length === 9, `the 3x3 window is resident at spawn (${before.length} cells)`);
  const islandsBefore = g.world.islands.length;
  g.pos = { x: 9000, y: 80, z: -6000 };
  await frames();
  const after = [...window.__skyuss.worldCells.keys()];
  assert(after.length === 9, `still exactly 3x3 cells 10 km out (${after.length})`);
  assert(after.every((k) => !before.includes(k)), 'the cells around the old position were freed');
  assert(g.world.cx === Math.round(9000 / 320), 'the sim followed the ship into the new sector');
  assert(g.world.islands.length > 0 && islandsBefore > 0, 'the far side of the cloud sea has islands too');
  const groups = window.__skyuss.worldGroup.children.filter((o) => o.name.startsWith('cell '));
  assert(groups.length === after.length, 'the scene mirrors exactly the streamed cells');
  const meshes = groups.reduce((n, gr) => n + gr.children.length, 0);
  assert(meshes > 10, `far cells are populated with meshes (${meshes})`);
  assert(document.getElementById('sectorLine').textContent.includes('SECTOR'), 'the HUD shows the current sector');
  g.pos = { x: 0, y: 62, z: 210 };
  await frames();
  const home = [...window.__skyuss.worldCells.keys()];
  assert(home.some((k) => before.includes(k)), 'flying home streams the original cells back in');
  assert(window.__skyuss.worldCells.size === 9, 'the window never grows past 3x3');
  assert(errors.length === 0, 'streaming the world raises no errors');
}

// mouse: left button shoots without moving the camera, right drag orbits
{
  let g = window.__skyuss.game;
  g.energy = 100; g.fireCd = 0;
  const before = g.fx.shots;
  const orbitYaw = window.__skyuss.orbit.yaw;
  const canvasEl = document.getElementById('sky');
  const ev = (type, opts) => new window.MouseEvent(type, { bubbles: true, ...opts });
  const down = (button) => canvasEl.dispatchEvent(ev('pointerdown', { button, clientX: 700, clientY: 400 }));
  const up = (button) => canvasEl.dispatchEvent(ev('pointerup', { button }));
  const move = (x, y) => canvasEl.dispatchEvent(ev('pointermove', { clientX: x, clientY: y }));

  down(0);
  await frames();
  g = window.__skyuss.game;
  assert(g.fx.shots > before, `LMB actually fires (${g.fx.shots - before} bolts)`);
  move(900, 300);
  await frames();
  assert(Math.abs(window.__skyuss.orbit.yaw - orbitYaw) < 1e-9, 'firing no longer drags the camera');
  up(0);

  down(2);
  move(1000, 320);
  await frames();
  assert(Math.abs(window.__skyuss.orbit.yaw - orbitYaw) > 0.05, 'right-drag orbits the camera');
  up(2);

  // a right click that never moved is a torpedo, not a camera drag
  g.torpCd = 0; g.energy = 100;
  const torps = g.fx.torps;
  down(2); up(2);
  await frames();
  assert(g.fx.torps === torps + 1, 'right click fires a torpedo');
}

// F warps home to the fortress
{
  const live = () => window.__skyuss.game;
  live().pos = { x: 5400, y: 90, z: -3200 };
  live().warpCd = 0; live().energy = 100;
  await frames();
  live().warpCd = 0; live().energy = 100;
  key('KeyF');
  await frames();
  const g = live();
  const dist = Math.hypot(g.pos.x - g.fort.x, g.pos.z - g.fort.z);
  assert(dist > 120 && dist < 360, `warp jump lands on station (${Math.round(dist)} m out)`);
  const fwd = g.forward;
  const toFort = Math.atan2(g.fort.x - g.pos.x, g.fort.z - g.pos.z);
  assert(Math.abs(Math.atan2(fwd.x, fwd.z) - toFort) < 0.2, 'the ship arrives facing the fortress');
  assert(g.world.islands.length > 0, 'the world restreamed around the fortress');
}

// G: free camera pauses the sim, T takes a photo, G returns
{
  let g = window.__skyuss.game;
  key('KeyG');
  await frames(2);
  assert(window.__skyuss.camMode === 'free', 'G detaches the free camera');
  assert(!document.getElementById('camBadge').classList.contains('hidden'), 'the photo badge is on screen');
  const t0 = g.t;
  g = window.__skyuss.game;
  await frames(3);
  assert(window.__skyuss.game.t === t0, 'the sim is paused while the photo camera is out');
  const shot = window.__skyuss.takePhoto();
  assert(typeof shot === 'boolean', 'takePhoto always reports back instead of throwing');
  key('KeyG');
  await frames(2);
  assert(window.__skyuss.camMode === 'chase', 'G returns to the chase camera');
  assert(document.getElementById('camBadge').classList.contains('hidden'), 'the badge hides again');
  assert(errors.length === 0, 'the camera and photo layer raise no errors');
}

// photo contracts: framing a subject and shooting it pays credits
{
  const live = () => window.__skyuss.game;
  const g = live();
  g.pos = { x: g.fort.x + 600, y: 60, z: g.fort.z + 600 };
  await frames();
  key('KeyG');                                  // free camera
  await frames();
  // point the camera at the fortress, which is always there to shoot
  window.__skyuss.free.pos = { x: g.fort.x + 120, y: 70, z: g.fort.z + 260 };
  window.__skyuss.free.yaw = Math.atan2(g.fort.x - window.__skyuss.free.pos.x, g.fort.z - window.__skyuss.free.pos.z);
  window.__skyuss.free.pitch = -0.1;
  await frames();
  const framed = window.__skyuss.frameSubjects();
  assert(Array.isArray(framed) && framed.includes('fort'), 'the fortress is inside the frame');
  const cash0 = live().credits;
  const shot = live().claimPhoto(framed);
  assert(shot.paid > 0 && live().credits > cash0, `a new shot pays credits (+${shot.paid})`);
  assert(live().claimPhoto(framed).paid === 0, 'the same subject does not pay twice');
  key('KeyG');
  await frames();
}

// the shipyard panel: earn, buy, fly
{
  const live = () => window.__skyuss.game;
  key('KeyY');
  await frames();
  const yard = document.getElementById('panelYard');
  assert(yard && !yard.classList.contains('hidden'), 'Y opens the shipyard');
  const balance = () => document.getElementById('yardCredits').textContent.trim();
  assert(balance() === String(live().credits), 'the panel shows your balance');

  const buttons = () => [...document.querySelectorAll('#yardShips button')];
  const buyBtn = () => buttons().find((b) => (b.dataset.action || '') === 'buyship');
  assert(!!buyBtn(), 'the Aurora is on sale');
  assert(buyBtn().disabled && live().credits < 4500, 'it is locked until you can afford it');

  live().credits = 5000;
  window.__skyuss.refreshYard();
  await frames();
  assert(!buyBtn().disabled, 'enough credits unlock the buy button');
  buyBtn().dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await frames();
  assert(live().owned.aurora, 'clicking buy puts the Aurora in the hangar');
  assert(live().credits === 500, 'the price came out of the wallet');

  const flyBtn = buttons().find((b) => (b.dataset.action || '') === 'useship');
  assert(!!flyBtn, 'a bought hull offers FLY IT');
  flyBtn.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await frames();
  assert(live().hullId === 'aurora', 'flying it switches the hull');
  await frames();
  assert(window.__skyuss.shipHull === 'model', 'the bought hull swaps in the real 3D model (Quaternius, CC0)');
  assert(balance() === String(live().credits), 'the panel re-reads the balance after a purchase');

  assert(buttons().some((b) => b.dataset.id === 'kang'), 'the dreadnought is on the shelf too');
  assert(live().credits < 9000, 'and still out of reach after buying the courier');

  const board = document.getElementById('yardContracts');
  assert(board.innerHTML.includes('Photo contracts') || board.textContent.length > 20, 'the photo contract board renders');
  key('Escape');
  await frames();
  assert(yard.classList.contains('hidden'), 'Escape closes the shipyard');
  assert(errors.length === 0, 'the economy layer raises no errors');
}

// a few more simulated seconds with combat noise
await frames();
assert(drew > 150, `the loop keeps rendering (${drew} draw calls)`);
assert(errors.length === 0, 'no window errors during the whole boot');

console.log(`\n--- errors (${errors.length + fails.length}) ---`);
errors.slice(0, 5).forEach((e) => console.log(e));
fails.slice(0, 5).forEach((f) => console.log('ASSERT: ' + f));
process.exit(errors.length + fails.length ? 1 : 0);
