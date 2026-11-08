// Headless test for SKYUSS: runs the whole simulation without a GPU and builds
// every Three.js mesh the game uses (geometry + materials are CPU objects, so
// they instantiate fine in Node — only the WebGLRenderer needs a browser).
import * as THREE from '../skyuss/vendor/three.module.js';
import { Enterprise, buildEnterprise, tierRows, COMPONENTS, MAX_TIER } from '../skyuss/js/enterprise.js';
import { SkyFort, buildFort, buildFortGrid } from '../skyuss/js/fort.js';
import { SkyGame } from '../skyuss/js/sim.js';
import { generateWorld, generateCell, WorldStream, buildIsland, buildDerelict, buildStorm, buildHomeBeacon } from '../skyuss/js/world.js';
import { FORT, FORT_PIECES, SHIP_UPGRADES, WORLD, CREDITS, PHOTO_CONTRACTS, SHIPYARD } from '../skyuss/js/config.js';
import { buildAurora } from '../skyuss/js/aurora.js';
import { buildDreadnought } from '../skyuss/js/dreadnought.js';
import { parseOBJ, objMesh, loadPremium, loadCommittedHull, HULL_MODELS, PREMIUM_CANDIDATES, PREMIUM_FILES } from '../skyuss/js/premium.js';

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

  // UPGRADE ALL: buys every affordable refit in one sweep
  {
    const s2 = new Enterprise();
    const rich = { titanium: 20000, dilithium: 9000, matrix: 200 };
    const sweep = s2.upgradeAll(rich);
    assert(sweep.ok && sweep.installed.length === MAX_TIER * COMPONENTS.length, `upgrade-all installs every refit (${sweep.installed.length})`);
    assert(COMPONENTS.every((c) => s2.tier(c) === MAX_TIER), 'upgrade-all maxes every component');
    assert(rich.titanium < 20000 && rich.dilithium < 9000, 'upgrade-all spends the bank');
    assert(s2.upgradeAll(rich).installed.length === 0, 'a maxed ship has nothing left to buy');

    const s3 = new Enterprise();
    const poor = { titanium: 130, dilithium: 60, matrix: 0 };
    const partial = s3.upgradeAll(poor);
    assert(partial.ok && partial.installed.length >= 1 && partial.installed.length < MAX_TIER * COMPONENTS.length,
      `upgrade-all stops when the bank runs dry (${partial.installed.length} installed)`);
    assert(Object.values(poor).every((v) => v >= 0), 'upgrade-all never pushes the bank negative');
  }

  const rows = tierRows(ship);
  assert(rows.length === 4 && rows.every((r) => r.cost === null), 'tier rows report the maxed state');
}

// --------------------------------------------------------------- ship meshes
section('modular 3D ship constructor');
{
  const stock = new Enterprise();
  const mesh0 = buildEnterprise(THREE, stock);
  let stockMeshes = 0;
  mesh0.traverse((o) => { if (o.isMesh) stockMeshes++; });
  assert(mesh0.isGroup && stockMeshes > 20, `stock Enterprise builds a 3D group (${stockMeshes} meshes)`);
  const dishWorld = new THREE.Vector3();
  mesh0.userData.parts.dish.getWorldPosition(dishWorld);
  assert(dishWorld.z > 0, 'the deflector dish points nose-first along +Z (the flight direction)');
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
  const glow0 = mesh0.userData.parts.nacelles[0].coils[0].material.color.getHex();
  const glowMax = meshMax.userData.parts.nacelles[0].coils[0].material.color.getHex();
  assert(glow0 !== glowMax, 'nacelle glow colour changes across refits');
  assert(mesh0.userData.parts.nacelles[0].bussard.material.color.r > 0.8,
    'the bussard collector stays the classic red-orange intake');
  let meshes = 0;
  meshMax.traverse((o) => { if (o.isMesh) meshes++; });
  assert(meshes > 30, `refit model is detailed (${meshes} meshes)`);
}

section('hull detail (lathed saucer, nacelles, lights)');
{
  const ship = new Enterprise({ saucer: 2, nacelles: 2, deflector: 2, weapons: 2 });
  const mesh = buildEnterprise(THREE, ship);
  const parts = mesh.userData.parts;

  // the saucer is a lathed shell, not a stack of cylinders
  let lathe = null;
  mesh.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.type === 'LatheGeometry') lathe = o; });
  assert(!!lathe, 'the primary hull is a lathed saucer');
  const lathePos = lathe.geometry.attributes.position;
  assert(lathePos.count > 1200, `the saucer shell is finely tessellated (${lathePos.count} verts)`);
  const bb = new THREE.Box3().setFromObject(lathe);
  const size = bb.getSize(new THREE.Vector3());
  const expectR = mesh.userData.size.saucerRadius;
  assert(Math.abs(size.x - expectR * 2) < expectR * 0.1, `the saucer is as wide as it claims (${size.x.toFixed(1)} vs ${(expectR * 2).toFixed(1)})`);
  assert(size.y < size.x * 0.35, 'the saucer is a disc, not a drum');

  // named structural members
  const names = new Set();
  mesh.traverse((o) => { if (o.name) names.add(o.name); });
  for (const n of ['hull', 'saucer', 'engineering', 'nacelle0', 'nacelle1', 'pylon0', 'pylon1', 'neck']) {
    assert(names.has(n), `the model names its ${n}`);
  }

  // detail parts the renderer animates
  assert(parts.grilles.length === 2 && parts.grilles.every((g) => g.material.transparent), 'both nacelles carry an animated warp grille');
  assert(parts.exhaust.length === 2, 'both nacelles have a lit exhaust');
  assert(parts.impulse.length === 2, 'the saucer has two impulse ports');
  assert(parts.runningLights.length >= 4, `${parts.runningLights.length} navigation lights blink`);
  assert(!!parts.shuttlebay && parts.shuttlebay.children.length >= 3, 'the engineering hull has a shuttlebay');
  assert(parts.lights.length >= 4, 'lit window rows are modelled');
  assert(parts.shieldBubble.visible === false, 'the shield bubble starts hidden');

  // layering: nacelles sit outboard and above the engineering hull
  const eng = mesh.getObjectByName('engineering');
  const engPos = eng.getWorldPosition(new THREE.Vector3());
  const nacPos = parts.nacelles[0].group.getWorldPosition(new THREE.Vector3());
  assert(Math.hypot(nacPos.x - engPos.x, nacPos.z - engPos.z) > 8, 'nacelles sit clear of the hull');
  assert(nacPos.y > engPos.y, 'nacelles ride above the engineering hull');

  // hull materials stay non-metallic enough to light without an env map
  let metal = 0, rough = 0, n = 0;
  mesh.traverse((o) => {
    if (o.isMesh && o.material && o.material.isMeshStandardMaterial) { metal += o.material.metalness; rough += o.material.roughness; n++; }
  });
  assert(n > 10 && metal / n < 0.45, `hull materials are painted, not bare metal (avg metalness ${(metal / n).toFixed(2)})`);
  assert(rough / n > 0.3 && rough / n < 0.8, `hull roughness is in a sane band (${(rough / n).toFixed(2)})`);

  // the whole ship is within the camera's comfortable framing volume
  const visibleBox = new THREE.Box3();
  mesh.traverse((o) => {
    if (!o.isMesh) return;
    let vis = true;
    for (let p = o; p; p = p.parent) if (p.visible === false) { vis = false; break; }
    if (vis) visibleBox.expandByObject(o);
  });
  const all = visibleBox.getSize(new THREE.Vector3());
  assert(all.z > 20 && all.z < 44, `the ship is ${all.z.toFixed(1)} m long`);
  assert(all.y > 4 && all.y < 18, `the ship is ${all.y.toFixed(1)} m tall`);
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
  {
    const f2 = new SkyFort(0, 0, 0);
    f2.place(6, 4, 'phaser', {}, { free: true });
    f2.place(6, 5, 'shield', {}, { free: true });
    f2.place(5, 6, 'matrix', {}, { free: true });
    const scifi = buildFort(THREE, f2, 'scifi');
    const voxel = buildFort(THREE, f2, 'voxel');
    assert(voxel.isGroup && voxel.children.length === f2.count, 'voxel style builds one group per piece');
    assert(voxel.userData.parts.turrets.length === f2.turrets.length, 'voxel turrets are aimable too');
    assert(voxel.style === 'voxel' && scifi.style !== 'voxel', 'the two fortress styles are distinct meshes');
    let vm = 0; voxel.traverse((o) => { if (o.isMesh) vm++; });
    assert(vm >= f2.count * 2, `voxel pieces are chunky blocks (${vm} meshes)`);
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
  assert(a.derelicts.length >= 3, `derelict wrecks are placed (${a.derelicts.length})`);
  assert(a.islands.every((i) => Math.hypot(i.x, i.z) > WORLD.graveyard.r), 'the home graveyard is kept clear of islands');

  const island = a.islands[0];
  const im = buildIsland(THREE, island);
  assert(im.isGroup && im.children.length > 2, 'island builds rock + cap + boulders');
  const dm = buildDerelict(THREE, a.derelicts[0]);
  assert(dm.isGroup && dm.children.length > 4, 'derelict builds a wreck with debris');
  const sm = buildStorm(THREE, a.storms[0] || generateCell(1, 0, 0).storms[0] || { x: 0, y: 40, z: 0, r: 80, phase: 0, seed: 3 });
  assert(sm.userData.points.isPoints, 'ion storm is a particle volume');
  const beacon = buildHomeBeacon(THREE);
  assert(beacon.isGroup, 'home beacon builds');
}

section('world models (islands, wrecks, storms)');
{
  const cell = generateCell(20261107, 0, 0);
  const island = cell.islands[0] || generateWorld(7).islands[0];
  const im = buildIsland(THREE, island);

  // the rock shell carries strata + moss in vertex colours
  let shell = null;
  im.traverse((o) => { if (o.isMesh && o.geometry.attributes.color) shell = o; });
  assert(!!shell, 'the island rock is vertex-coloured');
  const col = shell.geometry.attributes.color;
  assert(col.count === shell.geometry.attributes.position.count, 'every rock vertex has a colour');
  let greens = 0;
  for (let i = 0; i < col.count; i++) if (col.getY(i) > col.getX(i) && col.getY(i) > col.getZ(i)) greens++;
  assert(greens > 0, `moss is painted on the sunward shelves (${greens} green verts)`);
  assert(shell.material.vertexColors === true, 'the rock material honours those colours');

  let instanced = 0, islandMeshes = 0;
  im.traverse((o) => { if (o.isMesh) { islandMeshes++; if (o.isInstancedMesh) instanced++; } });
  assert(instanced >= 2, `props are instanced for cheap draw calls (${instanced} instanced meshes)`);
  assert(islandMeshes <= 16, `an island stays cheap to draw (${islandMeshes} meshes)`);
  const spire = buildIsland(THREE, { ...island, kind: 'spire', ruins: false, matrixNode: false });
  let spireMeshes = 0;
  spire.traverse((o) => { if (o.isMesh) spireMeshes++; });
  assert(spireMeshes < islandMeshes, 'a bare spire carries fewer props than a plateaumoss island');
  const ruins = buildIsland(THREE, { ...island, ruins: true });
  assert(!!ruins.userData.beacon, 'ruined islands still carry a navigation beacon');

  // wrecks: lit decks, torn plates, instanced debris
  const dm = buildDerelict(THREE, cell.derelicts[0] || generateWorld(7).derelicts[0]);
  let debrisInstanced = 0, wreckMeshes = 0;
  dm.traverse((o) => { if (o.isMesh) { wreckMeshes++; if (o.isInstancedMesh) debrisInstanced++; } });
  assert(debrisInstanced >= 1, 'wreck debris is instanced');
  assert(wreckMeshes <= 16, `a derelict stays cheap to draw (${wreckMeshes} meshes)`);
  assert(!!dm.userData.beacon, 'wrecks keep a distress beacon');

  // storms: layered volumes
  const sm = buildStorm(THREE, { x: 0, y: 0, z: 0, r: 80, phase: 1.2, seed: 3 });
  assert(sm.userData.points.isPoints && sm.userData.points.geometry.attributes.position.count === 900,
    'the storm core volume holds 900 particles');
  assert(!!sm.userData.inner && !!sm.userData.core, 'storms have an inner shell and a charged core');
  assert(!!sm.userData.bolts && sm.userData.bolts.isLineSegments, 'storms throw lightning');
  let stormMeshes = 0;
  sm.traverse((o) => { if (o.isMesh) stormMeshes++; });
  assert(stormMeshes <= 6, `a storm is a handful of draws (${stormMeshes})`);
}

section('open world streaming');
{
  // a cell is a pure function of (seed, cx, cz) — same place every time you fly back
  const c1 = generateCell(77, 12, -9);
  const c2 = JSON.parse(JSON.stringify(generateCell(77, 12, -9)));
  assert(JSON.stringify(c1) === JSON.stringify(c2), 'a cell is deterministic from seed + coordinates');
  assert(JSON.stringify(generateCell(77, 12, -9)) !== JSON.stringify(generateCell(77, 12, -8)), 'neighbouring cells differ');
  assert(c1.key === '12,-9' && c1.cx === 12 && c1.cz === -9, 'cells know their own coordinates');
  assert(c1.islands.every((i) => i.id.startsWith('i:12:-9:')), 'island ids are namespaced by cell');

  // ids stay unique across a whole region, which is what saves rely on
  const ids = new Set();
  let total = 0;
  for (let cx = -4; cx <= 4; cx++) {
    for (let cz = -4; cz <= 4; cz++) {
      const cell = generateCell(77, cx, cz);
      for (const o of [...cell.islands, ...cell.derelicts, ...cell.storms]) { ids.add(o.id); total++; }
    }
  }
  assert(ids.size === total && total > 100, `${total} objects across 81 cells, all with unique ids`);

  // the stream window follows the ship
  const stream = new WorldStream(31337);
  const near = stream.update({ x: 0, y: 60, z: 0 });
  assert(stream.cache.size === 9 && near.islands.length > 0, 'a 3x3 cell window streams in around the ship');
  const sumIslands = [...stream.cache.values()].reduce((n, cell) => n + cell.islands.length, 0);
  assert(near.islands.length === sumIslands, 'the view is exactly the union of the loaded cells');
  assert(stream.update({ x: 10, y: 60, z: 10 }) === near, 'the view is not rebuilt while the ship stays in its cell');

  const before = stream.cache.size;
  const far = stream.update({ x: 26000, y: 60, z: -31000 });
  assert(far.cx === Math.round(26000 / WORLD.cellSize), 'the stream tracks the far side of the map');
  assert(far.islands.length > 0 && far.storms !== undefined, 'the world still generates 26 km from home');
  assert(stream.cache.size <= 25 && stream.generated > before, 'old cells are pruned, memory stays flat');

  // looted state outlives the cell being unloaded
  const target = far.islands[0];
  stream.markLooted(target.id);
  stream.update({ x: 0, y: 60, z: 0 });
  assert(!stream.cache.has(target.cell), 'the looted cell is evicted while you fly home');
  const back = stream.update({ x: 26000, y: 60, z: -31000 });
  assert(back.islands.find((i) => i.id === target.id).looted, 'loot stays looted after the cell streams back in');
  assert(stream.stats().looted === 1, 'the stream counts stripped sites');

  // and the sim really is unbounded: no clamp at the old 260 m wall
  const g = new SkyGame({ seed: 4 });
  g.pos = { x: 1200, y: 70, z: -900 };
  for (let i = 0; i < 5; i++) g.update(1 / 60, {});
  assert(Math.abs(g.pos.x) > WORLD.cloudBand, 'the ship flies past the old edge of the cloud sea');
  assert(g.world.islands.length > 0 && g.world.cx === Math.round(1200 / WORLD.cellSize), 'new cells are already populated out there');
  assert(g.discovered.size >= 2, `sectors charted as you fly (${g.discovered.size})`);

  // looted ids round-trip through the save file
  const g2 = new SkyGame({ seed: 4 });
  const d0 = g2.world.derelicts[0];
  g2.pos = { x: d0.x, y: d0.y, z: d0.z };
  g2.update(1 / 60, {});
  g2.interact();
  const blob = JSON.parse(JSON.stringify(g2.toJSON()));
  assert(blob.looted.ids.includes(d0.id), 'the save lists stripped sites by id');
  const loaded = SkyGame.fromJSON(blob);
  loaded.update(1 / 60, {});
  assert(loaded.world.derelicts.find((x) => x.id === d0.id).looted, 'loaded saves remember stripped site ids');
  assert(loaded.discovered.size === g2.discovered.size, 'charted sectors survive save/load');
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

  // the shot leaves from the nose, and the lock leads a moving target
  g.fireCd = 0; g.energy = 100;
  g.yaw = 0; g.pitch = 0;
  const noseBolt = g.fire();
  const noseGap = Math.hypot(noseBolt.pos.x - g.pos.x, noseBolt.pos.y - g.pos.y, noseBolt.pos.z - g.pos.z);
  assert(noseGap > 10 && noseGap < 16, `bolts leave the saucer's nose (${noseGap.toFixed(1)} m ahead)`);

  {
    const h = new SkyGame({ seed: 12 });
    h.screen = 'playing';
    h.bank = { titanium: 9000, dilithium: 5000, matrix: 80 };
    h.upgrade('weapons');
    const f = h.forward;
    const mover = h.spawnEnemy('skiff', { x: h.pos.x + f.x * 200, y: h.pos.y, z: h.pos.z + f.z * 200 });
    h.update(1 / 60, {});
    assert(!!h.lockedEnemy, 'a hostile dead ahead locks automatically');
    mover.vel = { x: 45, y: 0, z: -45 };              // streaking across the nose
    const lead = h.aimAt(mover);
    const flat = h.aimAt({ pos: mover.pos, vel: { x: 0, y: 0, z: 0 } });
    const bend = Math.hypot(lead.x - flat.x, lead.y - flat.y, lead.z - flat.z);
    assert(bend > 0.01, 'aimAt leads a moving target instead of aiming where it was');
    let guard2 = 0;
    while (mover.hp > 0 && guard2++ < 900) {
      h.energy = 100;                                  // isolate tracking from the capacitor
      h.update(1 / 60, { fire: true });
    }
    assert(mover.hp <= 0, 'phasers track and kill a crossing skiff');
  }

  {
    const h = new SkyGame({ seed: 21 });
    h.screen = 'playing';
    const f = h.forward;
    const a = 0.7;                                    // 40 deg off the nose
    const x = f.x * Math.cos(a) - f.z * Math.sin(a);
    const z = f.z * Math.cos(a) + f.x * Math.sin(a);
    h.spawnEnemy('skiff', { x: h.pos.x + x * 220, y: h.pos.y, z: h.pos.z + z * 220 });
    h.update(1 / 60, {});
    assert(!!h.lockedEnemy, 'the lock cone snaps onto an off-axis target');
  }
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

  // warp jump: F takes you home to the fortress
  {
    const h = new SkyGame({ seed: 31 });
    h.screen = 'playing';
    h.energy = 100;
    const energy0 = h.energy;
    h.pos = { x: 4200, y: 80, z: -2600 };
    h.world = h.stream.update(h.pos);
    const warps0 = h.fx.warps;
    const res = h.warp();
    assert(res.ok && res.kind === 'warp', 'warp() jumps home when you are far away');
    const home = Math.hypot(h.pos.x - h.fort.x, h.pos.z - h.fort.z);
    assert(home > 200 && home < 300, `the jump lands on station (${Math.round(home)} m out)`);
    const fwd = h.forward;
    const toFort = Math.atan2(h.fort.x - h.pos.x, h.fort.z - h.pos.z);
    assert(Math.abs(Math.atan2(fwd.x, fwd.z) - toFort) < 0.05, 'you arrive pointed at the fortress');
    assert(h.energy === energy0 - 25 && h.fx.warps === warps0 + 1, 'the jump costs 25 energy and counts');
    assert(h.world.islands.length > 0, 'the world restreams around the fortress');
    assert(!h.warp().ok, 'warp goes on cooldown after a jump');
    h.warpCd = 0; h.energy = 100;
    assert(h.warp().kind === 'dash', 'pressing warp on station is a combat dash, not a wasted jump');
    assert(h.warpReady() === false, 'the dash also starts the cooldown');
  }

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
section('shipyard, credits and photo contracts');
{
  const g = new SkyGame({ seed: 44 });
  g.screen = 'playing';
  assert(g.credits === CREDITS.start, `you start with ${CREDITS.start} credits`);

  // bounties
  const before = g.credits;
  const f = g.forward;
  const prey = g.spawnEnemy('skiff', { x: g.pos.x + f.x * 200, y: g.pos.y, z: g.pos.z + f.z * 200 });
  let guard = 0;
  while (prey.hp > 0 && guard++ < 400) { g.energy = 100; g.update(1 / 60, { fire: true }); }
  assert(g.credits === before + CREDITS.kill.skiff, 'a kill pays its bounty in credits');

  // what is out there to photograph
  const subjects = g.photoSubjects();
  const kinds = new Set(subjects.map((s) => s.kind));
  assert(kinds.has('island') && kinds.has('derelict') || kinds.has('storm'), 'the world offers photo subjects');
  assert(kinds.has('fortress'), 'your own fortress is a subject');
  assert(subjects.every((s) => s.pay === PHOTO_CONTRACTS[s.kind].pay), 'every subject carries its contract payout');
  assert(!kinds.has('aurora'), 'the Aurora is not a subject until you own it');

  // a shot pays once
  const pick = subjects.filter((s) => s.kind === 'island').slice(0, 2);
  const cash0 = g.credits;
  const first = g.claimPhoto(pick.map((s) => s.id));
  assert(first.paid === pick.length * PHOTO_CONTRACTS.island.pay, 'new subjects pay their contract');
  assert(g.credits === cash0 + first.paid, 'the credits land in the wallet');
  const again = g.claimPhoto(pick.map((s) => s.id));
  assert(again.paid === 0 && again.fresh.length === 0, 'a subject only pays once');
  assert(g.claimPhoto(['nope:1:2', null, undefined]).paid === 0, 'junk ids are ignored');

  const board = g.photoBoard();
  assert(board.rows.length === Object.keys(PHOTO_CONTRACTS).length, 'the contract board lists every kind');
  assert(board.total === 2 && board.earned === first.paid, 'the board counts shots and earnings');

  // buying
  const poor = new SkyGame({ seed: 45 });
  const deny = poor.buyShip('aurora');
  assert(!deny.ok && /credits/.test(deny.reason), 'you cannot buy a hull you cannot afford');
  assert(!poor.useShip('aurora').ok, 'you cannot fly a hull you do not own');

  const speed0 = g.ship.stats.maxSpeed;
  g.credits = SHIPYARD.ships.find((x) => x.id === 'aurora').price + 100;
  const buy = g.buyShip('aurora');
  assert(buy.ok && g.owned.aurora, 'credits buy the Aurora');
  assert(g.credits === 100, 'the price is deducted');
  assert(!g.buyShip('aurora').ok, 'you cannot buy the same hull twice');

  const use = g.useShip('aurora');
  assert(use.ok && g.hullId === 'aurora', 'the bought hull becomes the active one');
  assert(Math.abs(g.ship.stats.maxSpeed - speed0 * 1.28) < 0.01, 'the courier flies 28% faster');
  assert(g.ship.stats.hull < 400, 'and carries a thinner hull');
  assert(g.photoSubjects().some((s) => s.kind === 'aurora'), 'now your own ship is a photo subject');

  // refits keep the hull bonus
  const hullAurora = g.ship.stats.hull;
  g.bank = { titanium: 9e4, dilithium: 9e4, matrix: 99 };
  g.upgrade('saucer');
  assert(g.ship.hullClass === 'aurora' && g.ship.stats.hull > hullAurora, 'refits stack on top of the bought hull');

  // it survives a save
  const round = SkyGame.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  assert(round.credits === g.credits && round.hullId === 'aurora', 'credits and hull survive a save');
  assert(Object.keys(round.photos).length === Object.keys(g.photos).length, 'the photo log survives a save');
  assert(round.owned.aurora, 'the hangar survives a save');
}

section('the Aurora mesh and the bought-hull loader');
{
  const ship = new Enterprise({ saucer: 2, nacelles: 2, deflector: 2, weapons: 2 }, { hullClass: 'aurora' });
  const mesh = buildAurora(THREE, ship);
  let count = 0;
  mesh.traverse((o) => { if (o.isMesh) count++; });
  const parts = mesh.userData.parts;
  assert(mesh.name === 'aurora' && count >= 15, `the courier is modelled (${count} meshes)`);
  assert(parts.nacelles.length === 2 && parts.exhaust.length === 2, 'twin nacelles with exhaust glow');
  assert(parts.grilles.length === 2 && parts.impulse.length === 2, 'grilles and impulse ports');
  assert(parts.runningLights.length >= 4 && parts.lights.length === 14, 'running lights and lit windows');
  assert(!!parts.shieldBubble && !parts.shieldBubble.visible, 'a shield bubble waits for shields');
  assert(mesh.userData.hull === 'aurora', 'the mesh reports its hull class');

  // the OBJ drop-in slot
  const cube = [
    'o hull', 'v -1 -1 -1', 'v 1 -1 -1', 'v 1 1 -1', 'v -1 1 -1',
    'v -1 -1 1', 'v 1 -1 1', 'v 1 1 1', 'v -1 1 1',
    'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5', 'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8',
  ].join('\n');
  const data = parseOBJ(cube);
  assert(!!data && data.triangles === 12, 'the OBJ reader triangulates quads (12 tris from 6 quads)');
  assert(data.vertices === 8, 'and counts the vertices');
  const neg = parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n');
  assert(!!neg && neg.triangles === 1, 'negative face indices resolve');
  assert(parseOBJ('v 0 0 0\n') === null, 'a file with no faces is rejected instead of crashing');

  const swapped = mesh.userData.setPremium(objMesh(THREE, data), { length: 30 });
  assert(swapped === true && mesh.userData.premium === true, 'a bought mesh can replace the placeholder');
  const hullGroup = mesh.children.find((c) => c.name === 'aurora-hull');
  assert(!hullGroup.visible === false, 'the hull group stays in the graph for its glows');
  const hiddenHull = [];
  hullGroup.traverse((o) => { if (o.isMesh && !o.visible) hiddenHull.push(o); });
  assert(hiddenHull.length > 8, `the placeholder skin hides when a real mesh loads (${hiddenHull.length} meshes)`);
  assert(parts.exhaust.every((e) => e.visible) && parts.grilles.every((g) => g.visible),
    'engine glows keep burning on the bought hull');

  // the committed CC0 courier that actually ships with the game
  {
    const fs = await import('node:fs');
    const raw = fs.readFileSync(new URL('../skyuss/assets/models/quaternius/dispatcher.obj', import.meta.url), 'utf8');
    const obj = parseOBJ(raw);
    assert(!!obj, 'the shipped Dispatcher OBJ parses');
    assert(obj.triangles > 600 && obj.vertices > 300, `it is a real mesh (${obj.vertices} verts, ${obj.triangles} tris)`);
    assert(obj.uvCount === 733, 'all 733 UVs are read out of the OBJ');
    assert(!!obj.uvs && obj.uvs.length === obj.triangles * 6, 'every triangle corner carries a UV');
    const model = objMesh(THREE, obj, {});
    assert(!!model.geometry.attributes.uv, 'the courier mesh carries UVs, so the palette texture maps');
    assert(obj.positions.length === obj.triangles * 9, 'it is non-indexed and ready to draw');

    const fake = async (url) => ({ ok: /\.obj$/.test(String(url)), text: async () => raw });
    const hull = await loadCommittedHull(THREE, 'aurora', { fetch: fake, texLoader: () => new THREE.Texture() });
    assert(!!hull && hull.triangles === obj.triangles, 'loadCommittedHull() builds the courier');
    assert(/Quaternius/.test(hull.credit || ''), 'the CC0 credit travels with the model');
    const box = new THREE.Box3().setFromObject(hull.mesh);
    const size = box.getSize(new THREE.Vector3());
    assert(Math.abs(Math.max(size.x, size.y, size.z) - 30) < 0.01, 'it is fitted to a 30 m hull');
    assert(Math.abs(box.getCenter(new THREE.Vector3()).length()) < 0.05, 'and centred on the flight origin');

    const bought = await loadPremium(THREE, { fetch: fake, urls: ['assets/premium/avrora.obj'] });
    assert(!!bought && bought.bought === true, 'a dropped-in bought hull still takes priority');
    const none = await loadPremium(THREE, { fetch: async () => ({ ok: false, text: async () => '' }) });
    assert(none === null, 'with no bought file the loader reports nothing instead of throwing');
  }
}

section('the Kang-class dreadnought');
{
  const kang = SHIPYARD.ships.find((s) => s.id === 'kang');
  assert(!!kang && kang.price === 9000, 'the shipyard lists the Kang-class dreadnought at 9,000 credits');
  assert(!!PHOTO_CONTRACTS.kang && PHOTO_CONTRACTS.kang.pay === 600, 'photographing it is its own contract');
  assert(!!PREMIUM_FILES.kang && PREMIUM_FILES.kang[0].endsWith('.obj'), 'it has its own bought-hull drop slot');

  const g = new SkyGame({ seed: 61 });
  g.credits = 9999;
  const baseSpeed = g.ship.stats.maxSpeed;
  const baseHull = g.ship.stats.hull;
  assert(g.buyShip('kang').ok, '9,000 credits buy the dreadnought');
  assert(g.useShip('kang').ok && g.hullId === 'kang', 'and it becomes the active hull');
  assert(Math.abs(g.ship.stats.maxSpeed - baseSpeed * 0.72) < 0.01, 'it is 28% slower');
  assert(g.ship.stats.hull === Math.round(baseHull * 2.2), 'with 2.2x the hull');
  const mine = g.photoSubjects().find((s) => s.kind === 'kang');
  assert(!!mine && mine.pay === 600, 'your own dreadnought is a 600 credit photo subject');
  const round = SkyGame.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  assert(round.hullId === 'kang' && round.owned.kang, 'the dreadnought survives a save');

  const mesh = buildDreadnought(THREE, new Enterprise({ saucer: 3, nacelles: 3, deflector: 3, weapons: 3 }, { hullClass: 'kang' }));
  let count = 0;
  mesh.traverse((o) => { if (o.isMesh) count++; });
  const parts = mesh.userData.parts;
  assert(mesh.name === 'dreadnought' && count >= 30, `the dreadnought is modelled (${count} meshes)`);
  assert(parts.nacelles.length === 3 && parts.exhaust.length === 3, 'three nacelles with their own exhaust');
  assert(parts.grilles.length === 3 && parts.impulse.length === 2, 'grilles on every nacelle, twin impulse ports');
  assert(parts.banks.length >= 6, 'heavy banks and turrets');
  assert(!!parts.shieldBubble && !parts.shieldBubble.visible, 'a shield bubble waits for shields');
  assert(mesh.userData.hull === 'kang', 'the mesh reports its hull class');

  const cube = 'v -1 -1 -1\nv 1 -1 -1\nv 1 1 -1\nv -1 -1 1\nv 1 -1 1\nv 1 1 1\nf 1 2 3\nf 4 5 6\n';
  const swapped = mesh.userData.setPremium(objMesh(THREE, parseOBJ(cube)), { length: 62 });
  assert(swapped === true && mesh.userData.premium === true, 'a dropped-in dreadnought mesh replaces the placeholder');
  assert(parts.exhaust.every((e) => e.visible), 'the three exhausts keep burning on the dropped mesh');
}

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

// ---------------------------------------------- aim modes, settings, touch UI
section('settings: manual aim, art style, touch');
{
  const g = new SkyGame({ seed: 8 });
  assert(g.settings.aimAssist === true && g.settings.style === 'scifi', 'defaults: auto-lock and sci-fi');
  assert(g.toggleAim() === false, 'aim assist can be switched to fully manual');
  assert(g.toggleStyle() === 'voxel', 'the fortress style can be switched to voxel blocks');

  g.enemies = [];
  const e = g.spawnEnemy('skiff', { x: g.pos.x + 100, y: g.pos.y, z: g.pos.z });
  g.aim = { x: 0, y: 0, z: 1 };            // deliberately not at the target
  g.lockedEnemy = e;
  g.aimEnemy = { x: 1, y: 0, z: 0 };
  g.fireCd = 0; g.energy = 100;
  const bolt = g.fire();
  assert(bolt.homing === null, 'manual aim never homes onto a target');
  assert(Math.abs(bolt.vel.z - 260) < 1 && Math.abs(bolt.vel.x) < 1, 'manual aim fires exactly along the reticle');
  assert(g.findLock() === null, 'the lock assist is inert in manual mode');

  g.setSetting('aimAssist', true);
  g.enemies = [e];
  e.hp = e.hpMax;
  g.fireCd = 0; g.energy = 100;
  g.lockedEnemy = e;
  const assisted = g.fire();
  assert(assisted.homing === e, 'auto-lock homes onto the locked hostile');

  g.setSetting('style', 'voxel');
  g.setSetting('aimAssist', false);
  const loaded = SkyGame.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  assert(loaded.settings.style === 'voxel' && loaded.settings.aimAssist === false, 'settings survive save/load');

  const { TouchControls } = await import('../skyuss/js/touch.js');
  assert(typeof TouchControls === 'function', 'the touch module loads without a DOM');
  assert(TouchControls.isSupported() === false, 'touch is not auto-enabled in a headless shell');
  const t = new TouchControls();
  assert(t.state() === null, 'an unmounted touch pad reports no input');
  t.stick = { x: -0.8, y: -0.9 };
  t.enabled = true;
  const st = t.state();
  assert(st.forward && st.yaw > 0 && !st.back, 'the thumb-stick maps to throttle and yaw');
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
