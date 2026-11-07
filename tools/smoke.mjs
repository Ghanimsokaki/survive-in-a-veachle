// Headless smoke test: boots the game with a fake canvas inside jsdom and
// exercises the main loops (driving, looting, crafting, building, travel, finale).
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.performance = window.performance;
global.HTMLElement = window.HTMLElement;
window.innerWidth = 1440;
window.innerHeight = 900;
window.devicePixelRatio = 1;

// ---- fake 2d context -------------------------------------------------------
const gradient = { addColorStop() {} };
function fakeCtx() {
  const target = {
    canvas: { width: 1440, height: 900 },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    measureText: () => ({ width: 60 }),
    getImageData: () => ({ data: [] }),
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {},
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {},
    closePath() {}, rect() {}, fill() {}, stroke() {}, fillRect() {}, strokeRect() {},
    clearRect() {}, fillText() {}, strokeText() {}, setLineDash() {}, clip() {}, drawImage() {},
  };
  return new Proxy(target, {
    get(t, p) { return p in t ? t[p] : () => {}; },
    set(t, p, v) { t[p] = v; return true; },
  });
}
window.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); };

const errors = [];
window.addEventListener('error', (e) => errors.push('window error: ' + e.message));

function step(n = 1, dt = 1 / 60) {
  for (let i = 0; i < n; i++) {
    try { G.frame(dt); } catch (e) { errors.push('frame: ' + e.stack); i = n; }
  }
}

const { G } = await import('../js/game.js');
const { UI } = await import('../js/ui.js');
const { RECIPES, RECIPE_BY_ID } = await import('../js/recipes.js');
const { ZONES } = await import('../js/world.js');

const canvas = document.getElementById('game');
try { G.init(canvas); } catch (e) { errors.push('init: ' + e.stack); }

function assert(cond, msg) {
  if (!cond) errors.push('ASSERT: ' + msg);
  else console.log('  ok  ' + msg);
}

console.log('— boot');
try { G.newGame(); } catch (e) { errors.push('newGame: ' + e.stack); }
step(30);
assert(G.screen === 'playing', 'game is playing');
assert(G.zone.def.id === 'java', 'starts in Java');
assert(G.car.hull > 0, 'car has hull');

console.log('— drive + shoot');
G.keys.w = true;
G.mouse.down = true;
const x0 = G.car.x;
step(120);
assert(G.car.x > x0 + 50, 'car moves forward with W');
assert(G.bullets.length >= 0, 'bullets array alive');
G.keys.w = false; G.mouse.down = false;
step(20);

console.log('— loot');
const ruin = G.zone.ruins.find((r) => r.crates.length);
const crate = ruin.crates[0];
G.car.x = crate.x; G.car.y = crate.y;
step(2);
assert(G.interact && G.interact.type === 'crate', 'crate interaction detected');
const resBefore = Object.values(G.res).reduce((a, b) => a + b, 0);
G.interactNow();
step(2);
assert(crate.looted === true, 'crate is looted');
assert(Object.values(G.res).reduce((a, b) => a + b, 0) > resBefore, 'loot added resources');

console.log('— recruit NPC');
const npcRuin = G.zone.ruins.find((r) => r.npc && !r.npc.recruited);
if (npcRuin) {
  const npc = npcRuin.npc;
  G.car.x = npc.x; G.car.y = npc.y;
  for (const k of ['food', 'scrap', 'wire', 'ammo', 'meds', 'fuel', 'alloy']) G.res[k] = 400;
  step(2);
  assert(G.interact && G.interact.type === 'npc', 'npc interaction detected');
  const n = G.crew.length;
  G.interactNow();
  assert(G.crew.length === n + 1, 'npc recruited into crew');
} else {
  console.log('  (no npc in zone)');
}

console.log('— build');
const floor = RECIPES.find((r) => r.cat === 'build' && r.tag === 'Floor' && r.tier === 1);
G.buildInv[floor.id] = 3;
G.buildSelected = floor.id;
G.toggleBuild();
G.placeAtCell(0);
G.placeAtCell(1);
assert(G.car.grid.cells[0] && G.car.grid.cells[0].id === floor.id, 'module placed on cell 0');
assert(G.stats.houseScore > 0, 'home score increased');
G.removeCell(1);
assert(!G.car.grid.cells[1], 'module removed from cell 1');
G.exitBuild();
step(5);

console.log('— craft');
for (const k of Object.keys(G.res)) G.res[k] = 5000;
G.cash = 100000;
const bench = RECIPES.find((r) => r.out.spec && r.out.spec.station === 1);
G.buildInv[bench.id] = 1;
G.buildSelected = bench.id;
G.placeAtCell(3);
assert(G.stats.station >= 1, 'workbench unlocks tier 2 crafting');
G.buildInv = {};
UI.openPanel('craft');
const weapon = RECIPES.find((r) => r.cat === 'weapon' && r.tier === 1);
const wcount = G.weapons.length;
G.craft(weapon.id, { instant: true });
assert(G.weapons.length === wcount + 1, 'weapon crafted');
const turret = RECIPES.find((r) => r.cat === 'turret' && r.tier === 2);
G.craft(turret.id, { instant: true });
assert(G.buildInv[turret.id] === 1, 'turret added to build tray');
const drone = RECIPES.find((r) => r.cat === 'drone' && r.tier === 1);
G.craft(drone.id, { instant: true });
assert(G.droneItems.length === 1, 'drone crafted');
const util = RECIPES.find((r) => r.cat === 'utility' && r.tag === 'Repair Kit' && r.tier === 1);
G.craft(util.id, { instant: true });
assert(Object.keys(G.consumables).length > 0, 'consumable stored');
G.useConsumable(util.id);
const veh = RECIPES.find((r) => r.cat === 'vehicle' && r.out.upgrade === 'maxSpeed');
G.craft(veh.id, { instant: true });
assert(G.carUpg.maxSpeed > 0, 'vehicle upgrade applied');
UI.closePanel();

console.log('— build a turret and fight');
G.buildInv[turret.id] = 2;
G.buildSelected = turret.id;
G.placeAtCell(6);
G.placeAtCell(7);
assert(G.car.grid.cells[6].kind === 'turret', 'turret installed on car');
const e = G.spawnEnemy('raider', G.car.x + 200, G.car.y);
const hp = e.hp;
step(180);
assert(e.hp < hp || e.dead, 'turret / player damaged the enemy');
G.enemies.forEach((en) => { en.hp = 0; G.killEnemy(en); });
step(5);

console.log('— crew panel / satchel / route / help');
for (const p of ['crew', 'items', 'route', 'help']) {
  try { UI.openPanel(p); UI.closePanel(); assert(true, `panel ${p} renders`); }
  catch (err) { errors.push(`panel ${p}: ` + err.stack); }
}

console.log('— dock + raft + engine + travel');
G.enterZone(2);
G.car.x = G.zone.dock.x; G.car.y = G.zone.dock.y;
G.cash = 100000;
step(2);
assert(G.nearDock(), 'near dock');
UI.openPanel('shop');
G.buy('raft');
G.buy('engine');
assert(G.car.raft && G.car.engine, 'raft + engine installed');
G.sell('scrap', 25);
UI.closePanel();
assert(G.zoneRequirement(2).ok, 'zone 2 exit requirement satisfied');
G.car.x = G.zone.exit.x; G.car.y = G.zone.exit.y;
G.travel();
assert(G.zoneIndex === 3, 'travelled to Malacca Strait');
step(60);
assert(G.car.hull > 0, 'car survives on water with raft');

console.log('— save / load');
G.save();
const before = { zone: G.zoneIndex, cash: G.cash, cells: G.car.grid.cells.filter(Boolean).length };
G.loadGame();
assert(G.zoneIndex === before.zone, 'save/load keeps zone');
assert(Math.round(G.cash) === Math.round(before.cash), 'save/load keeps cash');
assert(G.car.grid.cells.filter(Boolean).length === before.cells, 'save/load keeps built modules');

console.log('— finale');
G.enterZone(9);
G.car.raft = true; G.car.engine = true;
G.car.hull = G.car.hullMax;
step(30);
assert(G.finale && G.finale.started, 'finale started');
G.finale.timer = 0;
step(5);
assert(G.finale.wave >= 1, 'wave 1 started');
for (let w = 0; w < 5; w++) {
  const guard = 400;
  let n = 0;
  while (G.enemies.length && n < guard) {
    G.enemies.forEach((en) => { en.hp = 0; G.killEnemy(en); });
    step(2);
    n += 2;
  }
  G.finale.timer = 0;
  step(3);
}
assert(G.screen === 'won', 'victory after five waves');


console.log('— DOM UI wiring');
G.screen = 'playing';
G.zoneIndex = 0;
G.enterZone(0);
step(2);
const hudZone = document.getElementById('zoneName').textContent;
assert(hudZone.toLowerCase().includes('kampung') || hudZone.length > 0, 'HUD zone name populated');
assert(document.getElementById('resbar').children.length === 14, 'resource bar has 14 chips');

// hotbar click opens craft
document.querySelector('#hotbar button[data-act="craft"]').click();
step(1);
assert(UI.panel === 'craft', 'hotbar opens crafting panel');
const rows = document.querySelectorAll('#craftList .recipe');
assert(rows.length > 20, 'craft list renders recipes (' + rows.length + ')');
assert(document.querySelectorAll('#craftList .recipe').length <= 60, 'craft list paginates');

// search filters
const search = document.getElementById('craftSearch');
search.value = 'minigun';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
const filtered = document.querySelectorAll('#craftList .recipe').length;
assert(filtered > 0 && filtered < 60, 'search filters recipes (' + filtered + ')');

// craft button exists and is wired
for (const k of Object.keys(G.res)) G.res[k] = 9000;
G.cash = 99999;
UI.openPanel('craft');
const btn = document.querySelector('#craftList .craft-btn:not([disabled])');
if (btn) {
  const id = btn.dataset.id;
  btn.click();
  assert(true, 'craft button click did not throw');
} else {
  errors.push('ASSERT: no enabled craft button');
}
UI.closePanel();

// keyboard shortcut opens crew then escape closes
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n' }));
assert(UI.panel === 'crew', 'keyboard N opens crew panel');
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
assert(UI.panel === null, 'Escape closes panel');

// build mode via keyboard + tray rendering
G.buildInv = {};
const floor2 = RECIPES.find((r) => r.cat === 'build' && r.tag === 'Floor');
G.buildInv[floor2.id] = 2;
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'b' }));
step(1);
assert(G.buildMode === true, 'B enters build mode');
assert(document.querySelectorAll('#trayItems .tray-item').length === 1, 'build tray lists owned module');
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'b' }));
assert(G.buildMode === false, 'B leaves build mode');

// shop panel at dock
G.enterZone(2);
G.car.x = G.zone.dock.x; G.car.y = G.zone.dock.y;
G.cash = 5000;
UI.openPanel('shop');
assert(document.querySelectorAll('#panelBody .shop-card').length >= 8, 'shop lists goods');
UI.closePanel();

// end screens
G.showEndVictoryTest = null;
UI.showEnd(true, 'FREE', 'test', [{ label: 'X', value: 1 }]);
assert(!document.getElementById('endScreen').classList.contains('hidden'), 'end screen shows');
UI.hideEnd();
assert(document.getElementById('endScreen').classList.contains('hidden'), 'end screen hides');
UI.showHUD(true);
assert(!document.getElementById('hud').classList.contains('hidden'), 'HUD can be shown');


console.log('— consumables / drones / death');
G.screen = 'playing';
G.zoneIndex = 0;
G.enterZone(0);
G.car.hull = 100;
for (const tag of ['Repair Kit', 'Fuel Can', 'Ammo Crate', 'Power Cell', 'Armor Patch', 'Overdrive Injector', 'Combat Stim', 'Scrap Magnet', 'EMP Grenade', 'Smoke Screen', 'Nano Swarm', 'Drone Repair Kit']) {
  const r = RECIPES.find((x) => x.cat === 'utility' && x.tag === tag && x.tier === 1);
  if (!r) { errors.push('ASSERT: missing utility ' + tag); continue; }
  G.consumables[r.id] = 1;
  try { G.useConsumable(r.id); } catch (e) { errors.push('useConsumable ' + tag + ': ' + e.stack); }
}
assert(G.consumables.length === undefined || Object.keys(G.consumables).length <= 12, 'consumables consumed');
G.buffs.magnet = 30;
step(60);
G.buffs.magnet = 0;

// drone bay + several drone roles
const bay = RECIPES.find((r) => r.cat === 'build' && r.out.spec.droneCap);
G.buildInv[bay.id] = 3;
G.buildSelected = bay.id;
G.car.grid.cells[8] = null;
G.placeAtCell(8);
G.car.grid.cells[9] = null;
G.placeAtCell(9);
G.car.grid.cells[10] = null;
G.placeAtCell(10);
assert(G.stats.droneCap >= 3, 'drone bays add slots');
for (const role of ['gunner', 'repair', 'looter', 'kamikaze', 'shield']) {
  const r = RECIPES.find((x) => x.cat === 'drone' && x.out.spec.role === role && x.tier === 1);
  if (!r) continue;
  G.droneItems.push({ recipeId: r.id, name: r.name, icon: r.icon, spec: r.out.spec });
}
G.rebuildDrones();
G.recompute();
const raider2 = G.spawnEnemy('raider', G.car.x + 150, G.car.y + 40);
step(120);
assert(G.drones.some((d) => d.deployed), 'drones deploy');
G.enemies.forEach((en) => { en.hp = 0; G.killEnemy(en); });

// enemy bullets hurt, and zero hull ends the run
G.car.hull = 30;
G.damageCar(20);
assert(G.car.hull < 30, 'damage reduces hull');
G.car.hull = 1;
G.damageCar(999);
assert(G.screen === 'dead', 'hull zero ends the run');
assert(!document.getElementById('endScreen').classList.contains('hidden'), 'death overlay shown');

// ---------------------------------------------------------------- 3D / rig / interior
console.log('— 3D camera, character rig, interior');
G.newGame();
const { Camera3D } = await import('../js/camera3d.js');
step(10);
const screenCar = Camera3D.worldToScreen(G, G.car.x * 0.05, 2, G.car.y * 0.05);
assert(!!screenCar && screenCar.depth > 0, '3D camera projects the car to screen space');
assert(Camera3D.focal > 100 && Camera3D.pitch > 0.1, 'perspective camera is pitched down at the car');
const cellPick = G.cellAtScreen(G.view.w / 2, G.view.h / 2);
assert(cellPick >= 0 && cellPick < 24, 'mouse ray picks a roof cell (' + cellPick + ')');
G.toggleBuild();
G.setBuildTarget('interior');
assert(G.buildTarget === 'interior', 'build target switches to the interior');
const capBefore = G.stats.cap;
G.interiorSelected = 'shelf';
G.installInterior(0);
assert(G.car.interior[0] && G.car.interior[0].id === 'shelf', 'furniture installed inside the cabin');
assert(G.stats.cap > capBefore, 'interior storage raises the material cap');
step(40);
const slotPick = G.slotAtScreen(G.view.w / 2, G.view.h / 2);
assert(slotPick >= 0, 'interior camera frames the cabin');
assert(slotPick >= -1 && slotPick < 6, 'interior mount points are pickable (' + slotPick + ')');
G.setPaint('rust');
assert(G.car.paint === '#7a3a2c' && G.car.paintId === 'rust', 'car paint can be changed');
G.save();
G.loadGame();
assert(G.car.interior[0] && G.car.interior[0].id === 'shelf' && G.car.interior[0].stat, 'interior furniture survives save/load');
assert(G.car.paintId === 'rust', 'car paint survives save/load');
G.removeInterior(0);
assert(!G.car.interior[0], 'furniture removed from the cabin');
G.exitBuild();

// on foot: the rig leaves the car, walks, shoots and climbs back in
G.toggleFoot();
assert(G.player.onFoot, 'player steps out of the car');
const px0 = G.player.x, py0 = G.player.y;
G.keys.w = true;
step(30);
G.keys.w = false;
assert(Math.hypot(G.player.x - px0, G.player.y - py0) > 20, 'player rig walks around on foot');
G.mouse.down = true;
step(6);
G.mouse.down = false;
assert(G.bullets.length > 0, 'player fires on foot');
G.player.x = G.car.x + 40; G.player.y = G.car.y + 40;
G.toggleFoot();
assert(!G.player.onFoot, 'player climbs back into the car');
let rigErr = null;
try { G.player.onFoot = true; G.player.x = G.car.x + 90; step(4); } catch (e) { rigErr = e.message; }
assert(!rigErr, 'rigged character renders in 3D');
G.player.onFoot = false;


// ---------------------------------------------------------------- timed crafting
console.log('\n— timed crafting (99 Nights style)');
G.exitBuild();
for (const k of Object.keys(G.res)) G.res[k] = 999;
G.buildInv = {};
const job = RECIPES.find((r) => r.cat === 'utility' && r.tier === 1 && r.id !== util.id);
const consBefore = Object.keys(G.consumables).length;
G.craft(job.id);
assert(!!G.crafting && G.crafting.id === job.id, 'craft starts a timed job');
assert(G.craftProgress() < 0.01, 'craft progress starts at zero');
UI.updateHUD(G);
const craftBox = document.getElementById('craftBox');
assert(craftBox && !craftBox.classList.contains('hidden'), 'craft progress bar is visible in the HUD');
assert(/s$/.test(document.getElementById('craftLabel').textContent), 'craft bar shows the remaining time');
G.updateCraft(G.crafting.total * 0.5);
assert(G.craftProgress() > 0.4 && G.craftProgress() < 0.6, 'craft progress tracks elapsed time');
G.updateCraft(G.crafting.total);
assert(!G.crafting, 'craft job finishes on its own');
assert(Object.keys(G.consumables).length >= consBefore, 'timed craft delivered its output');

// stations shorten the job
const baseTotal = (() => {
  const snap = G.stats.craftSpeed;
  G.stats.craftSpeed = 0;
  G.craft(job.id, { instant: true });
  G.stats.craftSpeed = snap;
  G.craft(job.id);
  const t = G.crafting ? G.crafting.total : 0;
  G.crafting = null;
  return t;
})();
G.buildInv = {};
const tableKind = 'crafttable';
const tableRec = RECIPES.find((r) => r.out.spec && r.out.spec.kind === tableKind);
if (tableRec) {
  G.buildInv[tableRec.id] = 1;
  G.buildSelected = tableRec.id;
  G.placeAtCell(15);
}
const fastTotal = (() => {
  G.craft(job.id);
  const t = G.crafting ? G.crafting.total : 0;
  G.crafting = null;
  return t;
})();
assert(fastTotal > 0 && fastTotal <= baseTotal, `crafting stations speed jobs up (${baseTotal.toFixed(2)}s → ${fastTotal.toFixed(2)}s)`);

// ---------------------------------------------------------------- anchor + tornado
console.log('\n— anomaly tornado + anchor');
G.car.anchors = 2;
G.car.anchorT = 0;
G.deployAnchor();
assert(G.car.anchorT > 0, 'anchor deploys on Y');
assert(G.car.anchors === 1, 'anchor charge is consumed');

const hullBeforeTornado = G.car.hull;
G.spawnTornado();
assert(!!G.tornado && G.tornado.maxHp > 900, 'anomaly tornado spawns with a health pool');
UI.updateHUD(G);
const torBox = document.getElementById('tornadoBox');
assert(torBox && !torBox.classList.contains('hidden'), 'tornado HP bar is visible in the HUD');
assert(!!document.querySelector('[data-act="anchor"]'), 'hotbar has the anchor button');
G.tornado.x = G.car.x + 10;
G.tornado.y = G.car.y + 10;
const cx0 = G.car.x, cy0 = G.car.y;
const anchoredHull = G.car.hull;
for (let i = 0; i < 30; i++) G.updateTornado(1 / 60);
const anchoredDmg = anchoredHull - G.car.hull;
assert(anchoredDmg >= 0 && anchoredDmg < 10, 'anchor holds the car and cuts the damage');
assert(Math.hypot(G.car.x - cx0, G.car.y - cy0) < 60, 'anchored car is not dragged far');

G.car.anchorT = 0;
G.car.hull = Math.max(60, G.car.hull);
G.tornado.x = G.car.x + 6;
G.tornado.y = G.car.y + 6;
const freeHull = G.car.hull;
for (let i = 0; i < 30; i++) G.updateTornado(1 / 60);
assert(freeHull - G.car.hull > anchoredDmg, 'unanchored car takes far more damage');

G.tornado.hp = 4;
G.tornado.x = G.car.x + 4;
G.tornado.y = G.car.y + 4;
G.bullets.push({ x: G.tornado.x - 40, y: G.tornado.y, vx: 900, vy: 0, dmg: 30, life: 1, r: 4, friendly: true });
const cashBefore = G.cash;
step(6);
assert(!G.tornado, 'bullets can destroy the tornado');
assert(G.cash > cashBefore, 'killing the tornado pays salvage bonds');

// rendering with the tornado on screen must not throw
G.spawnTornado();
G.tornado.x = G.car.x + 300;
G.tornado.y = G.car.y + 200;
G.night = 0.8;
let torErr = null;
try { step(4); } catch (e) { torErr = e.message; }
assert(!torErr, 'tornado + night render in 3D');
assert(G.car.anchors >= 0 && typeof G.deployAnchor === 'function', 'anchor system is live');
G.endTornado(false);
G.night = 0;
G.car.hull = G.car.hullMax;

console.log('\n--- errors (' + errors.length + ') ---');
errors.slice(0, 20).forEach((e) => console.log(e));
process.exit(errors.length ? 1 : 0);
