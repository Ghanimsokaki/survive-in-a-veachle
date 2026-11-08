// Procedural recipe book: 1000+ craftable weapons, turrets, drones,
// building modules, consumables and vehicle upgrades.
import { mulberry32, roman, clamp } from './util.js';

const TIER_SCALE = [0, 1, 2.2, 4.2, 7.5, 12];
const TIER_MULT = [0, 1, 1.45, 2.05, 2.9, 4.1];
const QUALITY = [
  ['Rusty', 'Scrap', 'Patchwork', 'Salvaged'],
  ['Reinforced', 'Reclaimed', 'Hardened', 'Jury-Rigged'],
  ['Military', 'Custom', 'Overclocked', 'Riveted'],
  ['Prototype', 'Nano', 'Plasma', 'Cryo'],
  ['Void', 'Titan', 'Reaper', 'Ascendant'],
];
const QUALITY_MULT = [0.92, 1, 1.06, 1.12, 1.2];

const PALETTE = {
  weapon:  ['scrap', 'ammo', 'wire', 'alloy', 'chem', 'electronics'],
  turret:  ['scrap', 'wire', 'electronics', 'alloy', 'ammo'],
  drone:   ['electronics', 'wire', 'alloy', 'nano', 'glass'],
  build:   ['wood', 'scrap', 'cloth', 'rubber', 'glass', 'alloy', 'electronics'],
  utility: ['chem', 'meds', 'cloth', 'scrap', 'fuel', 'food'],
  vehicle: ['alloy', 'rubber', 'scrap', 'fuel', 'electronics', 'nano'],
};

function mkCost(cat, tier, rng, bias = null) {
  const pal = PALETTE[cat];
  const scale = TIER_SCALE[tier];
  const cost = {};
  const n = tier <= 2 ? 2 : 3;
  for (let i = 0; i < n; i++) {
    let key = bias && i === 0 ? bias : pal[Math.floor(rng() * Math.min(pal.length, 2 + tier))];
    const base = (7 + rng() * 9) * scale * (i === 0 ? 1 : 0.62);
    const amt = Math.max(2, Math.round(base / 2) * 2);
    cost[key] = (cost[key] || 0) + amt;
  }
  return cost;
}

function stationFor(tier) {
  if (tier <= 1) return 0;
  if (tier <= 3) return 1;
  if (tier === 4) return 2;
  return 3;
}

const RECIPES = [];
let rid = 0;
function add(r) {
  r.id = 'r' + (++rid);
  r.station = stationFor(r.tier);
  RECIPES.push(r);
}

// ------------------------------------------------------------- WEAPONS (280)
const WEAPONS = [
  { n: 'Pipe Pistol',      icon: '🔫', dmg: 9,  rate: 5.2, speed: 850,  spread: 0.055, pellets: 1 },
  { n: 'Scrap Rifle',      icon: '🔫', dmg: 14, rate: 3.1, speed: 980,  spread: 0.03,  pellets: 1 },
  { n: 'Street SMG',       icon: '🔫', dmg: 7,  rate: 8.5, speed: 880,  spread: 0.085, pellets: 1 },
  { n: 'Sawed Shotgun',    icon: '💥', dmg: 8,  rate: 1.2, speed: 760,  spread: 0.17, pellets: 5 },
  { n: 'Hunting Sniper',   icon: '🎯', dmg: 44, rate: 0.85, speed: 1500, spread: 0.006, pellets: 1 },
  { n: 'Crossbow',         icon: '🏹', dmg: 26, rate: 1.3, speed: 900,  spread: 0.012, pellets: 1 },
  { n: 'Grenade Launcher', icon: '💣', dmg: 42, rate: 0.8, speed: 620,  spread: 0.05,  pellets: 1, splash: 70 },
  { n: 'Flamethrower',     icon: '🔥', dmg: 5,  rate: 12, speed: 520,  spread: 0.12,  pellets: 1 },
  { n: 'Laser Rifle',      icon: '⚡', dmg: 17, rate: 4.4, speed: 1400, spread: 0.01,  pellets: 1 },
  { n: 'Plasma Cannon',    icon: '🌌', dmg: 58, rate: 1.4, speed: 1100, spread: 0.02,  pellets: 1, splash: 55 },
  { n: 'Railgun',          icon: '🛰️', dmg: 96, rate: 0.5, speed: 2100, spread: 0.002, pellets: 1 },
  { n: 'Minigun',          icon: '🌀', dmg: 6,  rate: 14, speed: 920,  spread: 0.1,   pellets: 1 },
  { n: 'Nailgun',          icon: '🔨', dmg: 11, rate: 6, speed: 820,  spread: 0.07,  pellets: 1 },
  { n: 'Arc Welder',       icon: '⚡', dmg: 19, rate: 2.4, speed: 700, spread: 0.04,  pellets: 1, chain: true },
];

WEAPONS.forEach((fam, fi) => {
  for (let i = 0; i < 20; i++) {
    const tier = clamp(1 + Math.floor(i / 4), 1, 5);
    const q = QUALITY[tier - 1][i % 4];
    const qm = QUALITY_MULT[tier - 1] * (0.94 + 0.04 * (i % 4));
    const tm = TIER_MULT[tier] * qm;
    const dmg = Math.round(fam.dmg * tm * 10) / 10;
    const rate = Math.round(fam.rate * (1 + 0.045 * (tier - 1)) * 100) / 100;
    const spread = Math.max(0.002, fam.spread * (1 - 0.13 * (tier - 1)));
    const stats = {
      dmg, rate, speed: fam.speed, spread, pellets: fam.pellets,
      splash: fam.splash || 0, chain: !!fam.chain, range: 900,
      dps: Math.round(dmg * rate * fam.pellets),
    };
    add({
      name: `${q} ${fam.n} ${roman(tier)}`,
      cat: 'weapon', type: 'weapon', tier,
      icon: fam.icon,
      cost: mkCost('weapon', tier, mulberry32(9000 + fi * 131 + i)),
      out: { type: 'weapon', stats },
      desc: `${stats.dmg} dmg · ${stats.rate}/s${fam.pellets > 1 ? ` ×${fam.pellets} pellets` : ''}${stats.splash ? ' · explosive' : ''}`,
      tag: fam.n,
    });
  }
});

// ------------------------------------------------------------- TURRETS (160)
const TURRETS = [
  { n: 'Auto Turret',        icon: '🔫', dmg: 11, rate: 2.6, range: 380 },
  { n: 'Minigun Turret',     icon: '🌀', dmg: 6,  rate: 8.5, range: 350 },
  { n: 'Laser Turret',       icon: '⚡', dmg: 19, rate: 1.9, range: 460 },
  { n: 'Mortar Turret',      icon: '💣', dmg: 42, rate: 0.55, range: 560, splash: 70 },
  { n: 'Flamer Turret',      icon: '🔥', dmg: 7,  rate: 6,   range: 230 },
  { n: 'Tesla Turret',       icon: '🌩️', dmg: 16, rate: 2.1, range: 400, chain: true },
  { n: 'Rail Turret',        icon: '🛰️', dmg: 62, rate: 0.55, range: 640 },
  { n: 'AA Turret',          icon: '🎯', dmg: 22, rate: 2.8, range: 500 },
  { n: 'Cryo Turret',        icon: '❄️', dmg: 9,  rate: 3.2, range: 360, slow: true },
  { n: 'Drone Dock',         icon: '🛸', dmg: 8,  rate: 3,   range: 340, droneCap: 1 },
];

TURRETS.forEach((fam, fi) => {
  for (let i = 0; i < 16; i++) {
    const tier = clamp(1 + Math.floor((i * 5) / 16), 1, 5);
    const q = QUALITY[tier - 1][i % 4];
    const tm = TIER_MULT[tier] * QUALITY_MULT[tier - 1];
    const dmg = Math.round(fam.dmg * tm * (0.93 + 0.04 * (i % 4)) * 10) / 10;
    const rate = Math.round(fam.rate * (1 + 0.05 * (i % 4)) * 100) / 100;
    const range = Math.round(fam.range * (1 + 0.06 * (tier - 1)));
    const spec = {
      kind: 'turret', dmg, rate, range, splash: fam.splash || 0, chain: !!fam.chain,
      slow: !!fam.slow, droneCap: fam.droneCap || 0,
      armor: Math.round(3 * tier), score: 10 + tier * 4,
      icon: fam.icon, label: fam.n,
    };
    add({
      name: `${q} ${fam.n} ${roman(tier)}`,
      cat: 'turret', type: 'turret', tier,
      icon: fam.icon,
      cost: mkCost('turret', tier, mulberry32(20000 + fi * 137 + i)),
      out: { type: 'build', spec },
      desc: `${dmg} dmg · ${rate}/s · ${range} range${fam.splash ? ' · AoE' : ''}${fam.droneCap ? ' · +1 drone bay' : ''}`,
      tag: fam.n,
    });
  }
});

// ------------------------------------------------------------- DRONES (160)
const DRONES = [
  { n: 'Scout Drone',      icon: '🛸', dmg: 7,  rate: 2.4, range: 380, role: 'scout' },
  { n: 'Gunner Drone',     icon: '🚁', dmg: 12, rate: 3.0, range: 420, role: 'gunner' },
  { n: 'Repair Drone',     icon: '🔧', dmg: 0,  rate: 0,   range: 200, role: 'repair' },
  { n: 'Kamikaze Drone',   icon: '💥', dmg: 55, rate: 0.4, range: 260, role: 'kamikaze' },
  { n: 'Shield Drone',     icon: '🛡️', dmg: 4,  rate: 1.6, range: 320, role: 'shield' },
  { n: 'Looter Drone',     icon: '🎒', dmg: 5,  rate: 1.4, range: 300, role: 'looter' },
  { n: 'Sniper Drone',     icon: '🎯', dmg: 30, rate: 0.7, range: 560, role: 'sniper' },
  { n: 'Swarm Drone',      icon: '🐝', dmg: 5,  rate: 5.5, range: 330, role: 'swarm' },
  { n: 'Flamer Drone',     icon: '🔥', dmg: 8,  rate: 6.0, range: 220, role: 'flamer' },
  { n: 'Tesla Drone',      icon: '🌩️', dmg: 17, rate: 2.0, range: 400, role: 'tesla' },
];

DRONES.forEach((fam, fi) => {
  for (let i = 0; i < 16; i++) {
    const tier = clamp(1 + Math.floor((i * 5) / 16), 1, 5);
    const q = QUALITY[tier - 1][i % 4];
    const tm = TIER_MULT[tier] * QUALITY_MULT[tier - 1] * (0.94 + 0.04 * (i % 4));
    const dmg = Math.round(fam.dmg * tm * 10) / 10;
    const spec = {
      kind: 'drone', role: fam.role, dmg, rate: fam.rate,
      range: Math.round(fam.range * (1 + 0.05 * (tier - 1))),
      hp: 40 + tier * 35, speed: 240 + tier * 14,
      icon: fam.icon, label: fam.n,
    };
    add({
      name: `${q} ${fam.n} ${roman(tier)}`,
      cat: 'drone', type: 'drone', tier,
      icon: fam.icon,
      cost: mkCost('drone', tier, mulberry32(40000 + fi * 139 + i)),
      out: { type: 'drone', spec },
      desc: `${fam.role} drone${dmg ? ` · ${dmg} dmg` : ''} · ${spec.range} range · ${spec.hp} hp`,
      tag: fam.n,
    });
  }
});

// ------------------------------------------------------------- BUILDINGS (200)
const BUILDINGS = [
  { n: 'Floor',          kind: 'floor',    icon: '🟫', score: 2 },
  { n: 'Deck',           kind: 'floor',    icon: '🟫', score: 3, bonus: { lootBonus: 0.01 } },
  { n: 'Wall',           kind: 'wall',     icon: '🧱', score: 3, armor: 5 },
  { n: 'Barricade',      kind: 'wall',     icon: '🚧', score: 4, armor: 7 },
  { n: 'Storage Rack',   kind: 'storage',  icon: '📦', score: 5, cap: 350 },
  { n: 'Cold Locker',    kind: 'storage',  icon: '🧰', score: 6, cap: 450, bonus: { lootBonus: 0.02 } },
  { n: 'Crew Bed',       kind: 'bed',      icon: '🛏️', score: 7, crew: 1 },
  { n: 'Bunk Bed',       kind: 'bed',      icon: '🛌', score: 9, crew: 1, bonus: { crewComfort: 1 } },
  { n: 'Workbench',      kind: 'workbench',icon: '🛠️', score: 9, station: 1 },
  { n: 'Machine Bench',  kind: 'workbench',icon: '🔧', score: 11, station: 1, bonus: { craftDiscount: 0.05 } },
  { n: 'Adv. Workshop',  kind: 'advbench', icon: '🏭', score: 16, station: 2 },
  { n: 'Factory Rig',    kind: 'advbench', icon: '⚙️', score: 20, station: 2, bonus: { craftDiscount: 0.08 } },
  { n: 'Nano Lab',       kind: 'nanolab',  icon: '🧬', score: 26, station: 3 },
  { n: 'Quantum Lab',    kind: 'nanolab',  icon: '🔬', score: 32, station: 3, bonus: { craftDiscount: 0.1 } },
  { n: 'Solar Panel',    kind: 'solar',    icon: '🔆', score: 8, solar: 3, powerCap: 30 },
  { n: 'Battery Bank',   kind: 'battery',  icon: '🔋', score: 6, powerCap: 70 },
  { n: 'Med Bay',        kind: 'medbay',   icon: '⚕️', score: 12, repair: 3 },
  { n: 'Auto Doc',       kind: 'medbay',   icon: '🏥', score: 16, repair: 5 },
  { n: 'Hydroponics',    kind: 'garden',   icon: '🌱', score: 8, lootBonus: 0.06 },
  { n: 'Kitchen',        kind: 'kitchen',  icon: '🍳', score: 9, repair: 1, lootBonus: 0.03 },
  { n: 'Antenna Array',  kind: 'antenna',  icon: '📡', score: 8, radar: 900 },
  { n: 'Drone Bay',      kind: 'dronebay', icon: '🛸', score: 14, droneCap: 1 },
  { n: 'Ram Spikes',     kind: 'spikes',   icon: '⚔️', score: 6, ram: 12 },
  { n: 'Shield Plate',   kind: 'shield',   icon: '🛡️', score: 10, armor: 9 },
  { n: 'Trophy Case',    kind: 'trophy',   icon: '🏆', score: 20 },
  { n: 'Bathroom',       kind: 'bathroom', icon: '🚿', score: 9, repair: 0.8, bonus: { comfort: 2 } },
  { n: 'Window Wall',    kind: 'window',   icon: '🪟', score: 6, armor: 4 },
  { n: 'Campfire',       kind: 'campfire', icon: '🔥', score: 6, bonus: { craftSpeed: 0.35, light: 2 } },
  { n: 'Internet Dish',  kind: 'internet', icon: '🛰️', score: 12, radar: 1200, bonus: { craftDiscount: 0.04, craftSpeed: 0.1 } },
  { n: 'Water Barrel',   kind: 'watertank',icon: '🛢️', score: 7, repair: 0.8, cap: 120 },
  { n: 'Crafting Table', kind: 'crafttable', icon: '🧰', score: 11, station: 1, bonus: { craftSpeed: 0.25 } },
  { n: 'Drone Hive',     kind: 'dronehive', icon: '🐝', score: 18, droneCap: 2 },
];

const BUILD_QUALITY = ['Scrap', 'Wooden', 'Iron', 'Steel', 'Reinforced', 'Composite', 'Nano', 'Golden'];
const BUILD_TIER = [1, 2, 2, 3, 3, 4, 4, 5];

BUILDINGS.forEach((fam, fi) => {
  for (let i = 0; i < 8; i++) {
    // stations gate each other: workshop -> advanced workshop -> nano lab
    const minTier = fam.kind === 'nanolab' ? 3 : fam.kind === 'advbench' ? 2 : 1;
    const tier = Math.max(BUILD_TIER[i], minTier);
    const tm = TIER_MULT[tier] * (0.95 + i * 0.02);
    const spec = {
      kind: fam.kind, icon: fam.icon, label: fam.n,
      score: Math.round((fam.score || 4) * tm),
    };
    if (fam.armor) spec.armor = Math.round(fam.armor * tm);
    if (fam.cap) spec.cap = Math.round(fam.cap * tm);
    if (fam.crew) spec.crew = fam.crew;
    if (fam.station) spec.station = fam.station;
    if (fam.solar) spec.solar = Math.round(fam.solar * tm * 10) / 10;
    if (fam.powerCap) spec.powerCap = Math.round(fam.powerCap * tm);
    if (fam.repair) spec.repair = Math.round(fam.repair * tm * 10) / 10;
    if (fam.lootBonus) spec.lootBonus = fam.lootBonus;
    if (fam.radar) spec.radar = fam.radar;
    if (fam.droneCap) spec.droneCap = fam.droneCap;
    if (fam.ram) spec.ram = Math.round(fam.ram * tm);
    if (fam.bonus) Object.assign(spec, fam.bonus);
    // higher tier variants stack more armour on structural parts
    if (fam.kind === 'wall' || fam.kind === 'shield') spec.armor = Math.round((fam.armor || 6) * (1 + 0.55 * (tier - 1)));
    add({
      name: `${BUILD_QUALITY[i]} ${fam.n}`,
      cat: 'build', type: 'build', tier,
      icon: fam.icon,
      cost: mkCost('build', tier, mulberry32(60000 + fi * 149 + i), fam.kind === 'floor' ? 'wood' : null),
      out: { type: 'build', spec },
      desc: buildDesc(spec),
      tag: fam.n,
    });
    if (fam.kind === 'nanolab') RECIPES[RECIPES.length - 1].station = 2;
  }
});

function buildDesc(s) {
  const bits = [];
  if (s.armor) bits.push(`+${s.armor} armour`);
  if (s.cap) bits.push(`+${s.cap} storage cap`);
  if (s.crew) bits.push('+1 crew slot');
  if (s.station === 1) bits.push('unlocks tier 2–3 crafting');
  else if (s.station === 2) bits.push('unlocks tier 4 crafting');
  else if (s.station === 3) bits.push('unlocks tier 5 crafting');
  if (s.solar) bits.push(`+${s.solar} power/s`);
  if (s.powerCap) bits.push(`+${s.powerCap} power`);
  if (s.repair) bits.push(`+${s.repair} hull/s repair`);
  if (s.lootBonus) bits.push(`+${Math.round(s.lootBonus * 100)}% loot`);
  if (s.radar) bits.push(`${s.radar} radar`);
  if (s.droneCap) bits.push('+1 drone slot');
  if (s.ram) bits.push(`+${s.ram} ram damage`);
  if (s.craftDiscount) bits.push(`-${Math.round(s.craftDiscount * 100)}% craft cost`);
  if (s.craftSpeed) bits.push(`+${Math.round(s.craftSpeed * 100)}% craft speed`);
  if (s.comfort) bits.push(`+${s.comfort} comfort`);
  if (!bits.length) bits.push(`+${s.score} home score`);
  return bits.join(' · ');
}

// ------------------------------------------------------------- UTILITIES (120)
const UTILITIES = [
  { n: 'Repair Kit',      icon: '🔧', effect: 'repair',   unit: 55,  label: 'repairs hull' },
  { n: 'Fuel Can',        icon: '⛽', effect: 'fuel',     unit: 45,  label: 'fuel' },
  { n: 'Ammo Crate',      icon: '📦', effect: 'ammo',     unit: 55,  label: 'ammo' },
  { n: 'Power Cell',      icon: '🔋', effect: 'power',    unit: 80,  label: 'power' },
  { n: 'Armor Patch',     icon: '🛡️', effect: 'armorBuff',unit: 8,   label: 'armour for 90s', dur: 90 },
  { n: 'Overdrive Injector', icon: '🏎️', effect: 'speedBuff', unit: 0.25, label: 'speed for 45s', dur: 45 },
  { n: 'Combat Stim',     icon: '💉', effect: 'dmgBuff',  unit: 0.3, label: 'damage for 45s', dur: 45 },
  { n: 'Scrap Magnet',    icon: '🧲', effect: 'magnet',   unit: 1,   label: 'auto-loot for 60s', dur: 60 },
  { n: 'EMP Grenade',     icon: '⚡', effect: 'emp',      unit: 4,   label: 'stun all enemies', dur: 4 },
  { n: 'Smoke Screen',    icon: '💨', effect: 'smoke',    unit: 1,   label: 'enemies lose aim', dur: 8 },
  { n: 'Nano Swarm',      icon: '✨', effect: 'repair',   unit: 140, label: 'major hull repair' },
  { n: 'Drone Repair Kit',icon: '🤖', effect: 'droneRepair', unit: 1, label: 'restore all drones' },
  { n: 'Ground Anchor',   icon: '⚓', effect: 'anchor',   unit: 1,   label: 'tornado anchor charge' },
];

UTILITIES.forEach((fam, fi) => {
  for (let i = 0; i < 10; i++) {
    const tier = clamp(1 + Math.floor(i / 2), 1, 5);
    const tm = TIER_MULT[tier];
    const amount = fam.unit <= 1
      ? +(fam.unit * (1 + 0.15 * (tier - 1))).toFixed(2)
      : Math.round(fam.unit * tm);
    const spec = {
      kind: 'utility', effect: fam.effect, amount,
      label: fam.label, icon: fam.icon, name: fam.n,
    };
    if (fam.dur) spec.duration = fam.dur + (tier - 1) * 12;
    add({
      name: `${QUALITY[tier - 1][i % 4]} ${fam.n} ${roman(tier)}`,
      cat: 'utility', type: 'utility', tier,
      icon: fam.icon,
      cost: mkCost('utility', tier, mulberry32(80000 + fi * 151 + i), 'chem'),
      out: { type: 'utility', spec },
      desc: `${fam.label}${fam.unit > 1 && fam.effect !== 'armorBuff' ? ` ${amount}` : ''}${spec.duration ? ` · ${spec.duration}s` : ''}`,
      tag: fam.n,
    });
  }
});

// ------------------------------------------------------------- VEHICLE (80)
const VEHICLES = [
  { n: 'Engine Tune',       icon: '🏎️', upg: 'maxSpeed',  base: 20,   label: 'top speed' },
  { n: 'Turbocharger',      icon: '🌀', upg: 'accel',     base: 110,  label: 'acceleration' },
  { n: 'Hull Plating',      icon: '🛡️', upg: 'hull',      base: 90,   label: 'max hull' },
  { n: 'Armor Plating',     icon: '🧱', upg: 'armor',     base: 12,   label: 'armour' },
  { n: 'Weapon Mount',      icon: '🔫', upg: 'weaponDmg', base: 0.09, label: 'weapon damage' },
  { n: 'Turret Capacitor',  icon: '⚡', upg: 'turretDmg', base: 0.09, label: 'turret damage' },
  { n: 'Cargo Rails',       icon: '📦', upg: 'cap',       base: 130,  label: 'storage cap' },
  { n: 'Solar Array',       icon: '🔆', upg: 'solar',     base: 1.4,  label: 'power regen/s' },
  { n: 'Ram Bumper',        icon: '🚜', upg: 'ram',       base: 16,   label: 'ram damage' },
  { n: 'Steering Kit',      icon: '🛞', upg: 'turn',      base: 0.3,  label: 'turning' },
];
const VEH_QUALITY = ['Salvaged', 'Standard', 'Tuned', 'Racing', 'Military', 'Prototype', 'Nano', 'Legendary'];
const VEH_TIER = [1, 1, 2, 2, 3, 4, 4, 5];

VEHICLES.forEach((fam, fi) => {
  for (let i = 0; i < 8; i++) {
    const tier = VEH_TIER[i];
    const tm = TIER_MULT[tier] * (0.95 + 0.03 * i);
    const amount = fam.base < 1 ? +(fam.base * tm).toFixed(2) : Math.round(fam.base * tm);
    add({
      name: `${VEH_QUALITY[i]} ${fam.n}`,
      cat: 'vehicle', type: 'vehicle', tier,
      icon: fam.icon,
      cost: mkCost('vehicle', tier, mulberry32(100000 + fi * 157 + i)),
      out: { type: 'vehicle', upgrade: fam.upg, amount, label: fam.label },
      desc: `+${fam.base < 1 ? Math.round(amount * 100) + '%' : amount} ${fam.label}`,
      tag: fam.n,
    });
  }
});

// ------------------------------------------------------------- SPECIAL (2)
add({
  name: 'Raft Kit (improvised)', cat: 'vehicle', type: 'vehicle', tier: 3, icon: '🛶',
  cost: { wood: 220, rubber: 90, cloth: 120, alloy: 30 },
  out: { type: 'vehicle', upgrade: 'raft', amount: 1, label: 'float on water' },
  desc: 'Lash together floats so the car can cross oceans.', tag: 'Raft Kit',
});
add({
  name: 'Ship Engine (improvised)', cat: 'vehicle', type: 'vehicle', tier: 4, icon: '⛴️',
  cost: { alloy: 90, electronics: 60, rubber: 70, fuel: 100, nano: 2 },
  out: { type: 'vehicle', upgrade: 'engine', amount: 1, label: 'ocean propulsion' },
  desc: 'Marine propeller conversion. Required for deep ocean.', tag: 'Ship Engine',
});

export { RECIPES };
export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
export const CATEGORIES = [
  { id: 'all', label: 'All', icon: '📚' },
  { id: 'weapon', label: 'Weapons', icon: '🔫' },
  { id: 'turret', label: 'Turrets', icon: '🎯' },
  { id: 'drone', label: 'Drones', icon: '🛸' },
  { id: 'build', label: 'Building', icon: '🏠' },
  { id: 'utility', label: 'Items', icon: '🧰' },
  { id: 'vehicle', label: 'Vehicle', icon: '🚗' },
];
export const RECIPE_COUNT = RECIPES.length;
