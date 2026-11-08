// Boot + main loop.
import { G } from './game.js';
import { UI } from './ui.js';
import { Sfx } from './util.js';
import { autoMountTouch } from './touch.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game');
G.init(canvas);

// phones get a stick, an aim pad and an action cluster; desktops get nothing
const touch = autoMountTouch({ canvas });

// ------------------------------------------------------------------ menu buttons
$('btnNew').addEventListener('click', () => {
  Sfx.resume();
  Sfx.click();
  G.newGame();
});

$('btnContinue').addEventListener('click', () => {
  Sfx.resume();
  Sfx.click();
  G.loadGame();
});

$('btnHelpMenu').addEventListener('click', () => {
  Sfx.click();
  UI.openPanel('help');
});

$('btnRetry').addEventListener('click', () => {
  Sfx.click();
  UI.hideEnd();
  G.retry();
});

$('btnEndMenu').addEventListener('click', () => {
  Sfx.click();
  G.toMenu();
});

// ------------------------------------------------------------------ loop
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0, fpsLast = 0;
let lastSave = performance.now();

function loop(now) {
  const dtRaw = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.05, Math.max(0, dtRaw));

  G.frame(dt);

  // fps readout
  fpsAcc += dtRaw;
  fpsFrames++;
  if (now - fpsLast > 600) {
    UI.setFps(Math.round(fpsFrames / Math.max(0.001, fpsAcc)));
    fpsAcc = 0; fpsFrames = 0; fpsLast = now;
  }

  // autosave
  if (G.screen === 'playing' && now - lastSave > 20000) {
    lastSave = now;
    G.save();
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.addEventListener('beforeunload', () => { if (G.screen === 'playing') G.save(); });

// pause shooting when tab loses focus
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { G.mouse.down = false; G.keys = {}; }
});

// prevent browser zoom / scroll from breaking the canvas
document.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

// expose for debugging
window.G = G;
window.UI = UI;
import('./recipes.js').then((m) => {
  window.__RECIPES = m.RECIPES;
  window.__RECIPE_COUNT = m.RECIPE_COUNT;
});
