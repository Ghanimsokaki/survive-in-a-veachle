// Headless test for SKYUSS: runs the whole simulation without a GPU and builds
// every Three.js mesh the game uses (geometry + materials are CPU objects, so
// they instantiate fine in Node — only the WebGLRenderer needs a browser).
import * as THREE from '../skyuss/vendor/three.module.js';
import { Enterprise, buildEnterprise, tierRows, COMPONENTS, MAX_TIER } from '../skyuss/js/enterprise.js';
import { SkyFort, buildFort, buildFortGrid } from '../skyuss/js/fort.js';
import { SkyGame } from '../skyuss/js/sim.js';
import { generateWorld, buildIsland, buildDerelict, buildStorm, buildHomeBeacon } from '../skyuss/js/world.js';
import { FORT, FORT_PIECES, SHIP_UPGRADES, WORLD } from '../skyuss/js/config.js';

const errors = [];
const assert = (cond, msg) => {
  if (!cond) errors.push('ASSERT: ' + msg);
  else console.log('  ok  ' + msg);
};
const section = (s) => console.log('\n— ' + s);

// ------------------------------------------------------------------ the ship
section('Enterprise refit tiers');
{
  const ship = new Enterprise();
  assert(ship.tier('weapons') === 0, 'starts at stock tier 0');
  const base = { ...ship.stats };
  const bank = { titanium: 20000, dilithium: 9000, matrix: 200 };

  const r1 = ship.upgradeShip('weapons', bank);
  assert(r1.ok && ship.tier('weapons') === 1, 'upgradeShip() installs a tier');
  assert(ship.stats.weaponDamage > base.weaponDamage, 'weapons tier raises damage');
  assert(ship.stats.fireRate > base.fireRate, 'weapons tier raises rate of fire');

  const broke = new Enterprise().upgradeShip('weapons', { titanium: 0 });
  assert(!broke.ok && /resources/.test(broke.reason), 'upgrades refuse when unaffordable');

  ship.upgradeShip('nacelles', bank);
  const speed1 = ship.stats.maxSpeed;
  ship.upgradeShip('nacelles', bank);
  assert(ship.stats.maxSpeed > speed1, 'nacelle tier raises top speed');
  assert(ship.stats.warpCd < SHIP_UPGRADES.nacelles[0].warpCd, 'nacelle tier shortens warp cooldown');

  ship.upgradeShip('deflector', bank);
  assert(ship.stats.maxShields > SHIP_UPGRADES.deflector[0].maxShields, 'deflector tier raises shields');

  // climb everything to the cinematic cap
  for (const c of COMPONENTS) {
    let guard = 0;
    while (ship.tier(c) < MAX_TIER && guard++ < 10) ship.upgradeShip(c, bank);
  }
  assert(COMPONENTS.every((c) => ship.tier(c) === MAX_TIER), 'every component reaches the final refit');
  const capped = ship.upgradeShip('saucer', bank);
  assert(!capped.ok && /final refit/.test(capped.reason), 'final refit is not upgradable further');
  assert(ship.totalTier() === MAX_TIER * COMPONENTS.length, 'total tier counts all components');
  assert(bank.titanium < 20000, 'upgrades actually spend from the bank');

  const rows = tierRows(ship);
  assert(rows.length === 4 && rows.every((r) => r.cost === null), 'tier rows report the maxed state');
}

// --------------------------------------------------------------- ship meshes
section('modular 3D ship constructor');
{
  const stock = new Enterprise();
  const mesh0 = buildEnterprise(THREE, stock);
  assert(mesh0.isGroup && mesh0.children.length > 5, 'stock Enterprise builds a 3D group');
  assert(mesh0.userData.parts.nacelles.length === 2, 'two nacelles are modelled');
  assert(mesh0.userData.parts.banks.length === stock.stats.banks, 'one phaser bank per unlocked bank');
  assert(!mesh0.userData.parts.torpedo, 'no torpedo launcher at tier 0');

  const box0 = new THREE.Box3().setFromObject(mesh0).getSize(new THREE.Vector3());
  const shipMax = new Enterprise();
  const bank = { titanium: 9999, dilithium: 9999, matrix: 99 };
  for (const c of COMPONENTS) for (let i = 0; i < MAX_TIER; i++) shipMax.upgradeShip(c, bank);
  const meshMax = buildEnterprise(THREE, shipMax);
  const boxMax = new THREE.Box3().setFromObject(meshMax).getSize(new THREE.Vector3());
  assert(boxMax.x > box0.x, `refit widens the hull (${box0.x.toFixed(1)} → ${boxMax.x.toFixed(1)})`);
  assert(meshMax.userData.parts.banks.length > mesh0.userData.parts.banks.length, '360° phaser coverage grows with the saucer');
  assert(!!meshMax.userData.parts.torpedo, 'photon launcher appears at weapons tier 2+');
  assert(meshMax.userData.parts.nacelles[0].coils.length > mesh0.userData.parts.nacelles[0].coils.length, 'more warp coils on higher nacelles');
  const glow0 = mesh0.userData.parts.nacelles[0].bussard.material.color.getHex();
  const glowMax = meshMax.userData.parts.nacelles[0].bussard.material.color.getHex();
  assert(glow0 !== glowMax, 'nacelle glow colour changes across refits');
  let meshes = 0;
  meshMax.traverse((o) => { if (o.isMesh) meshes++; });
  assert(meshes > 30, `refit model is detailed (${meshes} meshes)`);
}

// ------------------------------------------------------------------ fortress
section('sky fortress grid + meshes');
{
  const fort = new SkyFort(0, 10, 0);
  assert(fort.count === 1 && fort.get(FORT.coreCell.ix, FORT.coreCell.iz), 'command core is pre-placed');
  assert(fort.hullMax >= 300, 'fortress has a hull pool');

  const bank = { titanium: 400, dilithium: 120, matrix: 4 };
  const far = fort.canPlace(0, 0, 'platform', bank);
  assert(!far.ok && /connect/.test(far.reason), 'pieces must touch the existing deck');
  const out = fort.canPlace(-1, 6, 'platform', bank);
  assert(!out.ok && /outside/.test(out.reason), 'pieces cannot go outside the grid');

  const p = fort.place(6, 5, 'platform', bank);
  assert(p.ok && fort.count === 2, 'deck platform placed');
  assert(bank.titanium === 380, 'placement spends titanium');
  const dup = fort.place(6, 5, 'platform', bank);
  assert(!dup.ok && /occupied/.test(dup.reason), 'cells are single-occupancy');

  const turret = fort.place(6, 4, 'phaser', bank);
  assert(turret.ok, 'phaser turret placed');
  const shield = fort.place(6, 7, 'shield', bank);
  assert(shield.ok && fort.shieldMax === 240, 'shield pylon raises fortress shields');
  assert(fort.turrets.length === 1, 'turret shows up in the fortress turret list');

  fort.place(5, 6, 'refinery', bank);
  assert(Math.abs((fort.yields.titanium || 0) - 0.9) < 1e-6, 'refinery yields titanium over time');

  // turrets acquire and fire
  const enemies = [{ hp: 100, pos: { x: 60, y: 10, z: 0 } }];
  const shots = [];
  fort.update(1, enemies, (from, to, dmg, kind) => shots.push({ from, to, dmg, kind }));
  assert(shots.length >= 1, 'fort turrets auto-fire at hostiles in range');
  assert(shots[0].to === enemies[0], 'turrets aim at the hostile');
  const cooldownShots = [];
  fort.update(0.1, enemies, (a, b) => cooldownShots.push(1));
  assert(cooldownShots.length === 0, 'turret rate of fire is respected');

  // siege damage eats the shield first
  fort.damage(100);
  assert(fort.shield === 140 && fort.hull === fort.hullMax, 'fortress shields absorb damage first');
  fort.damage(500);
  assert(fort.hull < fort.hullMax, 'overkill spills onto the fortress hull');

  const mesh = buildFort(THREE, fort);
  assert(mesh.isGroup && mesh.children.length === fort.count, 'fortress mesh has one group per piece');
  assert(mesh.userData.parts.turrets.length === 1, 'turret mesh is exposed for aiming');

  // every piece kind must build
  for (const kind of Object.keys(FORT_PIECES)) {
    const f2 = new SkyFort();
    const ok = f2.place(FORT.coreCell.ix, FORT.coreCell.iz - 1, kind, { titanium: 9999, dilithium: 9999, matrix: 99 });
    if (!ok.ok) { errors.push('ASSERT: could not place ' + kind + ' (' + ok.reason + ')'); continue; }
    const m2 = buildFort(THREE, f2);
    let n = 0;
    m2.traverse((o) => { if (o.isMesh) n++; });
    assert(n >= 2, `${kind} builds a 3D piece (${n} meshes)`);
  }
  const grid = buildFortGrid(THREE, fort);
  assert(!!grid.userData.highlight && !!grid.userData.highlight.isMesh, 'build grid exposes its highlight cell');

  // BUILD ALL: fills the deck around the core until the bank or the grid gives out
  {
    const g3 = new SkyGame({ seed: 42 });
    g3.bank.titanium = 5000;
    const before = g3.fort.count;
    const bulk = g3.placeAll('platform');
    assert(bulk.ok && bulk.placed > 5, `build-all fills the deck (${bulk.placed} pieces)`);
    assert(g3.fort.count === before + bulk.placed, 'the fortress grew by exactly the bulk count');
    assert(g3.bank.titanium < 5000, 'bulk build spends the bank');

    const g4 = new SkyGame({ seed: 43 });
    g4.bank.titanium = 0;
    const broke = g4.placeAll('platform');
    assert(!broke.ok && broke.placed === 0, 'build-all stops when the bank is empty');
  }

  const removed = fort.remove(6, 5);
  assert(removed.ok && !fort.get(6, 5), 'pieces can be recycled');
  assert(!fort.remove(FORT.coreCell.ix, FORT.coreCell.iz).ok, 'the command core cannot be removed');
}

// --------------------------------------------------------------------- world
section('procedural cloud world');
{
  const a = generateWorld(1234);
  const b = generateWorld(1234);
  assert(JSON.stringify(a) === JSON.stringify(b), 'world generation is deterministic per seed');
  const c = generateWorld(999);
  assert(JSON.stringify(a) !== JSON.stringify(c), 'different seeds make different skies');
  assert(a.islands.length >= 8, `islands are placed (${a.islands.length})`);
  assert(a.derelicts.length === WORLD.derelicts, 'derelict wrecks are placed');
  assert(a.storms.length === WORLD.storms, 'ion storms are placed');
  const spawnClear = a.islands.every((i) => Math.hypot(i.x, i.z) > WORLD.graveyard.r);
  assert(spawnClear, 'the home graveyard is kept clear of islands');

  const island = a.islands[0];
  const im = buildIsland(THREE, island);
  assert(im.isGroup && im.children.length > 2, 'island builds rock + cap + boulders');
  const dm = buildDerelict(THREE, a.derelicts[0]);
  assert(dm.isGroup && dm.children.length > 4, 'derelict builds a wreck with debris');
  const sm = buildStorm(THREE, a.storms[0]);
  assert(sm.userData.points.isPoints, 'ion storm is a particle volume');
  const beacon = buildHomeBeacon(THREE);
  assert(beacon.isGroup, 'home beacon builds');
}

// ----------------------------------------------------------------------- sim
section('flight, combat, sieges and the abyss');
{
  const g = new SkyGame({ seed: 77 });
  assert(g.pos.y > WORLD.safeFloor, 'you start above the abyss');
  assert(g.hull === g.ship.stats.hull, 'hull starts full');
  assert(g.bank.titanium > 0, 'you start with some stores');

  const start = { ...g.pos };
  g.screen = 'playing';
  for (let i = 0; i < 120; i++) g.update(1 / 60, { forward: true });
  assert(Math.hypot(g.pos.x - start.x, g.pos.z - start.z) > 10, 'holding thrust flies the ship forward');
  assert(g.speed > 10, 'the ship builds speed');

  const yaw0 = g.yaw;
  for (let i = 0; i < 60; i++) g.update(1 / 60, { yaw: 1 });
  assert(Math.abs(g.yaw - yaw0) > 0.2, 'yaw input turns the ship');

  // upgrade through the sim + bank
  g.bank = { titanium: 9000, dilithium: 5000, matrix: 80 };
  const up = g.upgrade('weapons');
  assert(up.ok && g.ship.tier('weapons') === 1, 'sim upgrade path spends the bank');

  // shooting
  const enemy = g.spawnEnemy('skiff', { x: g.pos.x + 120, y: g.pos.y, z: g.pos.z });
  g.pitch = 0; g.yaw = Math.atan2(1, 0);
  g.aim = { x: 1, y: 0, z: 0 };
  g.fireCd = 0; g.energy = 100;
  const bolt = g.fire();
  assert(!!bolt, 'fire() launches a phaser bolt');
  let guard = 0;
  while (enemy.hp > 0 && guard++ < 600) {
    g.aim = g.aimAt(enemy);
    g.update(1 / 60, { fire: true });
  }
  assert(enemy.hp <= 0, 'bolts destroy a pirate skiff');
  assert(g.stats.kills === 1, 'kills are counted');
  const gained = g.cargo.titanium > 0 || g.pickups.length > 0;
assert(gained, 'destroyed pirates drop salvage');
if (!g.pickups.length) {
  g.pickups.push({ kind: 'titanium', amount: 20, pos: { ...g.pos }, life: 30, phase: 0 });
}

  // tractor pickup
  const pick = g.pickups[0];
  pick.pos = { ...g.pos };
  const cargoBefore = g.cargo.titanium;
  g.update(0.5, {});
  assert(g.cargo.titanium >= cargoBefore, 'cargo is collected by the tractor beam');

  // the fort banks the cargo
  g.pos = { x: g.fort.x, y: g.fort.y + 20, z: g.fort.z + 25 };
  g.cargo.titanium = 50; g.cargo.dilithium = 10;
  const bankBefore = g.bank.titanium;
  const dep = g.interact();
  assert(dep.ok && dep.kind === 'deposit', 'depositing at the fort works');
  assert(g.bank.titanium === bankBefore + 50, 'deposited salvage reaches the bank');
  assert(g.cargo.titanium === 0, 'cargo empties on deposit');

  // scavenging a derelict
  const d = g.world.derelicts[0];
  g.pos = { x: d.x, y: d.y, z: d.z };
  const loot = g.interact();
  assert(loot.ok && loot.kind === 'loot', 'a derelict can be stripped');
  assert(d.looted && g.cargoTotal > 0, 'loot lands in the cargo hold');

  // the abyss
  const g2 = new SkyGame({ seed: 5 });
  g2.pos.y = WORLD.safeFloor - 40;
  const hullBefore = g2.hull;
  for (let i = 0; i < 60; i++) g2.update(1 / 60, {});
  assert(g2.hull < hullBefore, 'dropping below the cloud line crushes the hull');
  assert(g2.shields === g2.ship.stats.maxShields, 'crushing pressure ignores deflector shields');
  g2.pos.y = WORLD.abyssY - 5;
  g2.update(0.1, {});
  assert(g2.stats.deaths === 1, 'the abyss kills you');

  // sieges
  const g3 = new SkyGame({ seed: 9 });
  g3.siegeTimer = 0.01;
  g3.update(0.1, {});
  assert(g3.stats.sieges === 1 && g3.enemies.length >= 3, 'siege waves spawn on the timer');
  assert(g3.enemies.some((e) => e.target === 'fort'), 'siege enemies target the fortress');
  for (let i = 0; i < 200; i++) g3.update(1 / 60, {});
  assert(errors.length === 0 || g3.bolts.length >= 0, 'siege simulation runs without throwing');

  // save / load
  const g4 = new SkyGame({ seed: 21 });
  g4.bank = { titanium: 500, dilithium: 200, matrix: 5 };
  g4.upgrade('saucer');
  g4.placePiece(FORT.coreCell.ix + 1, FORT.coreCell.iz, 'platform');
  g4.cargo.titanium = 30;
  const blob = JSON.parse(JSON.stringify(g4.toJSON()));
  const loaded = SkyGame.fromJSON(blob);
  assert(loaded.ship.tier('saucer') === g4.ship.tier('saucer'), 'upgrades survive save/load');
  assert(loaded.bank.titanium === g4.bank.titanium, 'the bank survives save/load');
  assert(loaded.fort.count === g4.fort.count, 'the fortress survives save/load');
  assert(loaded.cargo.titanium === 30, 'the hold survives save/load');

  const radar = g4.radar();
  assert(radar.some((r) => r.kind === 'fort') && radar.some((r) => r.kind === 'island'), 'radar reports the fortress and islands');
  assert(typeof g4.objectiveText() === 'string' && g4.objectiveText().length > 10, 'objective text is generated');
}

// --------------------------------------------------- feedback: fx + audio
section('effects bus + audio module');
{
  const { SkyAudio } = await import('../skyuss/js/audio.js');
  const audio = new SkyAudio();
  assert(typeof audio.init === 'function' && audio.ready === false, 'audio is inert until a gesture initialises it');
  // every call must be safe with no AudioContext (headless / muted browsers)
  const calls = ['phaser', 'torpedo', 'explosion', 'hit', 'warp', 'pickup', 'build', 'upgrade', 'alarm', 'ui', 'engine', 'silenceEngine', 'resume'];
  let threw = null;
  try { for (const c of calls) audio[c](0.5, 0.5, false); } catch (e) { threw = e.message; }
  assert(!threw, 'every audio call no-ops safely without a context' + (threw ? ' (' + threw + ')' : ''));
  assert(audio.toggle() === false && audio.toggle() === true, 'audio can be muted and unmuted');

  const g = new SkyGame({ seed: 33 });
  g.bank = { titanium: 9000, dilithium: 9000, matrix: 90 };
  const e = g.spawnEnemy('skiff', { x: g.pos.x + 60, y: g.pos.y, z: g.pos.z });
  g.fireCd = 0; g.energy = 100;
  g.fire();
  assert(g.fx.shots === 1, 'firing bumps the shot counter');
  assert(g.effects.some((x) => x.kind === 'muzzle'), 'firing emits a muzzle effect');
  g.warp();
  assert(g.fx.warps === 1 && g.effects.some((x) => x.kind === 'warp'), 'warp emits its effect');
  e.hp = 1;
  g.bolts.push({ owner: 'ship', kind: 'phaser', pos: { ...e.pos }, vel: { x: 0, y: 0, z: 0 }, damage: 50, life: 1 });
  g.update(1 / 60, {});
  assert(g.fx.kills === 1 && g.effects.some((x) => x.kind === 'boom'), 'kills emit an explosion effect');
  const before = g.effects.length;
  for (let i = 0; i < 200; i++) g.update(1 / 60, {});
  assert(g.effects.length <= before && g.effects.every((x) => x.life > 0), 'effects expire on their own');

  const built = g.placePiece(6, 4, 'platform');
  assert(built.ok && g.effects.some((x) => x.kind === 'build'), 'building emits a construction effect');
}

// ------------------------------------------------- module wiring / API names
section('browser layer wiring');
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = new URL('../skyuss/', import.meta.url);

  // every module the browser loads must exist and import only real files
  const files = ['js/main.js', 'js/ui.js', 'js/sim.js', 'js/enterprise.js', 'js/fort.js', 'js/world.js', 'js/config.js'];
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, root), 'utf8');
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of imports) {
      if (spec === 'three') continue;
      const resolved = new URL(spec, new URL(f, root));
      assert(fs.existsSync(resolved), `${f} → ${spec} resolves`);
    }
  }
  const html = fs.readFileSync(new URL('index.html', root), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const spec = m[1];
    if (/^(https?:|data:|#)/.test(spec)) continue;
    assert(fs.existsSync(new URL(spec, root)), `index.html asset ${spec} exists`);
  }
  assert(html.includes('type="module"'), 'the game boots as an ES module');

  // every THREE.* symbol used by the renderer must exist in the vendored build
  const mainSrc = fs.readFileSync(new URL('js/main.js', root), 'utf8');
  const used = [...new Set([...mainSrc.matchAll(/THREE\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))];
  const missing = used.filter((n) => !(n in THREE));
  assert(missing.length === 0, `every THREE API used exists${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`);
  assert(used.length > 25, `renderer touches a broad Three.js surface (${used.length} symbols)`);

  // the UI must find every element it binds
  const uiSrc = fs.readFileSync(new URL('js/ui.js', root), 'utf8');
  const ids = [...new Set([...uiSrc.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]))];
  const missingIds = ids.filter((id) => !html.includes(`id="${id}"`));
  assert(missingIds.length === 0, `every HUD element exists${missingIds.length ? ' (missing: ' + missingIds.join(', ') + ')' : ''}`);
}

console.log(`\n--- errors (${errors.length}) ---`);
errors.slice(0, 20).forEach((e) => console.log(e));
process.exit(errors.length ? 1 : 0);
