// Static game data: resources, loot, modules, enemies, crew roles, shop.
import { clamp, mulberry32, pick, rand, randInt } from './util.js';

export const RES = {
  scrap:       { name: 'Scrap',       icon: '🔩', color: '#a8b6c6', tier: 1 },
  wood:        { name: 'Wood',        icon: '🪵', color: '#c08b52', tier: 1 },
  cloth:       { name: 'Cloth',       icon: '🧵', color: '#d8c9ab', tier: 1 },
  rubber:      { name: 'Rubber',      icon: '🛞', color: '#8b93a1', tier: 1 },
  glass:       { name: 'Glass',       icon: '🔷', color: '#7dd3fc', tier: 1 },
  food:        { name: 'Food',        icon: '🥫', color: '#f87171', tier: 1 },
  ammo:        { name: 'Ammo',        icon: '📦', color: '#facc15', tier: 1 },
  wire:        { name: 'Wire',        icon: '🔌', color: '#fbbf24', tier: 2 },
  fuel:        { name: 'Fuel',        icon: '⛽', color: '#fb923c', tier: 2 },
  electronics: { name: 'Electronics', icon: '💾', color: '#34d399', tier: 2 },
  chem:        { name: 'Chemicals',   icon: '🧪', color: '#a3e635', tier: 2 },
  meds:        { name: 'Meds',        icon: '💊', color: '#f472b6', tier: 2 },
  alloy:       { name: 'Alloy',       icon: '⚙️', color: '#cbd5e1', tier: 3 },
  nano:        { name: 'Nano Core',   icon: '✨', color: '#a78bfa', tier: 4 },
};
export const RES_KEYS = Object.keys(RES);

const LOOT_W = {
  scrap: 100, wood: 85, cloth: 62, rubber: 55, glass: 45, food: 60, ammo: 48,
  wire: 40, fuel: 42, electronics: 30, chem: 26, meds: 22, alloy: 14, nano: 3,
};

// Roll a loot bundle scaled by zone tier.
export function rollLoot(tier, mult = 1, rng = Math.random) {
  const out = {};
  const n = clamp(2 + Math.floor(rng() * 3) + (tier >= 3 ? 1 : 0), 2, 5);
  const keys = RES_KEYS.slice();
  for (let i = 0; i < n; i++) {
    let total = 0;
    const w = keys.map((k) => {
      const t = RES[k].tier;
      const ww = LOOT_W[k] * (t > tier ? 0.15 : 1) * (t <= tier ? 1 + 0.15 * (tier - t) : 1);
      total += ww;
      return ww;
    });
    let roll = rng() * total;
    let idx = 0;
    for (let j = 0; j < keys.length; j++) { roll -= w[j]; if (roll <= 0) { idx = j; break; } }
    const key = keys[idx];
    if (out[key]) { i--; continue; }
    const t = RES[key].tier;
    const base = t <= 1 ? randInt(14, 30) : t === 2 ? randInt(9, 20) : t === 3 ? randInt(6, 14) : randInt(1, 4);
    out[key] = Math.max(1, Math.round(base * (1 + 0.55 * (tier - 1)) * mult));
  }
  return out;
}

// --------------------------------------------- modules that live on the car
export const MODULE_KINDS = {
  floor:    { label: 'Floor',        icon: '🟫', score: 2,  color: '#8a6239' },
  wall:     { label: 'Wall',         icon: '🧱', score: 3,  armor: 5 },
  storage:  { label: 'Storage',      icon: '📦', score: 5,  cap: 350 },
  bed:      { label: 'Bed',          icon: '🛏️', score: 7,  crew: 1 },
  workbench:{ label: 'Workbench',    icon: '🛠️', score: 9,  station: 1 },
  advbench: { label: 'Adv. Workshop',icon: '🏭', score: 16, station: 2 },
  nanolab:  { label: 'Nano Lab',     icon: '🧬', score: 26, station: 3 },
  turret:   { label: 'Turret',       icon: '🔫', score: 12 },
  solar:    { label: 'Solar Panel',  icon: '🔆', score: 8,  solar: 3, powerCap: 30 },
  battery:  { label: 'Battery Bank', icon: '🔋', score: 6,  powerCap: 70 },
  medbay:   { label: 'Med Bay',      icon: '⚕️', score: 12, repair: 3 },
  garden:   { label: 'Garden',       icon: '🌱', score: 8,  lootBonus: 0.06 },
  antenna:  { label: 'Antenna',      icon: '📡', score: 8,  radar: 900 },
  dronebay: { label: 'Drone Bay',    icon: '🛸', score: 14, droneCap: 1 },
  spikes:   { label: 'Spikes',       icon: '⚔️', score: 6,  ram: 12 },
  kitchen:  { label: 'Kitchen',      icon: '🍳', score: 9,  repair: 1, lootBonus: 0.03 },
  shield:   { label: 'Shield Plate', icon: '🛡️', score: 10, armor: 9 },
  lantern:  { label: 'Lantern',      icon: '🏮', score: 4,  radar: 420 },
  trophy:   { label: 'Trophy',       icon: '🏆', score: 20 },
};

export const STATION_NAMES = ['Field Kit', 'Workbench', 'Advanced Workshop', 'Nano Lab'];

// --------------------------------------------- enemy blueprints
export const ENEMY_TYPES = {
  raider:  { name: 'Raider',        hp: 46,  speed: 108, dmg: 7,  rate: 1.15, range: 380, r: 14, color: '#e85555', cash: [4, 12],  ranged: true, icon: '🪓' },
  scout:   { name: 'Scout',         hp: 34,  speed: 132, dmg: 5,  rate: 1.5,  range: 320, r: 12, color: '#f59e0b', cash: [3, 9],   ranged: true, icon: '🏍️' },
  brute:   { name: 'Brute',         hp: 130, speed: 82,  dmg: 22, rate: 0.9,  range: 54,  r: 19, color: '#f97316', cash: [8, 18],  melee: true, icon: '💪' },
  gunner:  { name: 'Gunner',        hp: 80,  speed: 88,  dmg: 11, rate: 1.5,  range: 460, r: 15, color: '#ef4444', cash: [6, 16],  ranged: true, icon: '🔫' },
  car:     { name: 'Raider Car',    hp: 160, speed: 205, dmg: 12, rate: 1.2,  range: 420, r: 26, color: '#fb7185', cash: [14, 32], ranged: true, icon: '🚙', vehicle: true },
  pirate:  { name: 'Pirate Skiff',  hp: 140, speed: 165, dmg: 13, rate: 1.3,  range: 430, r: 25, color: '#38bdf8', cash: [12, 30], ranged: true, icon: '🚤', vehicle: true },
  soldier: { name: 'Army Soldier',  hp: 120, speed: 118, dmg: 14, rate: 1.35, range: 520, r: 15, color: '#22c55e', cash: [10, 22], ranged: true, icon: '🎖️' },
  heavy:   { name: 'Army Heavy',    hp: 260, speed: 78,  dmg: 20, rate: 1.0,  range: 500, r: 20, color: '#16a34a', cash: [20, 40], ranged: true, icon: '🪖' },
  apc:     { name: 'Army APC',      hp: 520, speed: 150, dmg: 26, rate: 1.1,  range: 460, r: 32, color: '#4ade80', cash: [30, 60], ranged: true, vehicle: true, icon: '🚛' },
  heli:    { name: 'Gunship',       hp: 420, speed: 195, dmg: 18, rate: 2.2,  range: 540, r: 27, color: '#86efac', cash: [35, 70], ranged: true, flyer: true, icon: '🚁' },
  boss:    { name: 'General Tank',  hp: 2600, speed: 92, dmg: 32, rate: 1.5, range: 560, r: 44, color: '#facc15', cash: [300, 500], ranged: true, vehicle: true, boss: true, icon: '🛡️' },
};

// --------------------------------------------- recruitable crew
export const ROLES = {
  scavenger: { name: 'Scavenger', icon: '🎒', desc: '+35% loot from every container', cost: { food: 25 } },
  engineer:  { name: 'Engineer',  icon: '🔧', desc: 'Auto-repairs the car, crafts 15% cheaper', cost: { scrap: 70, wire: 12 } },
  gunner:    { name: 'Gunner',    icon: '🎯', desc: '+35% turret damage and fire rate', cost: { ammo: 45 } },
  medic:     { name: 'Medic',     icon: '💉', desc: 'Slow constant hull repair, more med loot', cost: { meds: 18 } },
  driver:    { name: 'Driver',    icon: '🏎️', desc: '+18% top speed and steering', cost: { fuel: 35 } },
  trader:    { name: 'Trader',    icon: '💰', desc: '+25% cash from kills, 12% better prices', cost: { scrap: 110 } },
  sniper:    { name: 'Sniper',    icon: '🔭', desc: 'Rides along and snipes enemies', cost: { ammo: 70, scrap: 55 } },
  mechanic:  { name: 'Mechanic',  icon: '⚙️', desc: '+40 armour and repairs during travel', cost: { alloy: 20, scrap: 90 } },
};
export const ROLE_KEYS = Object.keys(ROLES);

export const NAMES = [
  'Budi', 'Siti', 'Agus', 'Rina', 'Joko', 'Dewi', 'Bayu', 'Ayu', 'Eko', 'Putri',
  'Wayan', 'Nur', 'Rizky', 'Indah', 'Hendra', 'Maya', 'Fajar', 'Lestari', 'Tono', 'Sari',
  'Marcus', 'Elena', 'Darnell', 'Rosa', 'Cody', 'June', 'Wes', 'Tasha', 'Omar', 'Ruth',
  'Kwame', 'Ingrid', 'Diego', 'Nadia', 'Hank', 'Mei', 'Aja', 'Viktor', 'Sasha', 'Lee',
];
export const ROLE_TITLES = ['Mechanic', 'Scout', 'Cook', 'Nurse', 'Drifter', 'Veteran', 'Tinker', 'Hauler'];

// --------------------------------------------- dock shop
export const SHOP_ITEMS = [
  { id: 'raft',      name: 'Raft Kit',        icon: '🛶', price: 950,  desc: 'Lash floats to the car so it can cross water.' },
  { id: 'engine',    name: 'Ship Engine',     icon: '⛴️', price: 1500, desc: 'Marine propeller + drive shaft. Needed for ocean legs.' },
  { id: 'repair',    name: 'Full Repair',     icon: '🔧', price: 180,  desc: 'Restore the car to full hull.' },
  { id: 'fuel',      name: 'Fuel Can (60)',   icon: '⛽', price: 90,   desc: 'Adds 60 fuel.' },
  { id: 'ammo',      name: 'Ammo Crate (80)', icon: '📦', price: 80,   desc: 'Adds 80 ammo.' },
  { id: 'meds',      name: 'Med Kit (25)',    icon: '💊', price: 70,   desc: 'Adds 25 meds.' },
  { id: 'scrap',     name: 'Scrap Bundle (60)', icon: '🔩', price: 75, desc: 'Adds 60 scrap.' },
  { id: 'wood',      name: 'Lumber Bundle (60)', icon: '🪵', price: 65, desc: 'Adds 60 wood.' },
  { id: 'electronics', name: 'Tech Bundle (25)', icon: '💾', price: 140, desc: 'Adds 25 electronics.' },
  { id: 'alloy',     name: 'Alloy Bundle (20)', icon: '⚙️', price: 220, desc: 'Adds 20 alloy.' },
  { id: 'nano',      name: 'Nano Core',       icon: '✨', price: 480,  desc: 'Adds 1 nano core. Endgame crafting.' },
];

// --------------------------------------------- zone palette used by world/render
export const BIOMES = {
  java:     { ground: '#3f4a37', gravel: '#4a5640', road: '#5b594f', accent: '#86a06a' },
  city:     { ground: '#3a3d42', gravel: '#4a4e55', road: '#575b63', accent: '#8b94a3' },
  dock:     { ground: '#3c4248', gravel: '#4c545c', road: '#5f6871', accent: '#7f9cb5' },
  sea:      { ground: '#123047', gravel: '#17405d', road: '#1b4a6b', accent: '#3b82f6' },
  coast:    { ground: '#4a4a3a', gravel: '#5a5945', road: '#67665a', accent: '#c9b079' },
  dc:       { ground: '#33383a', gravel: '#454c4e', road: '#585f61', accent: '#94a3a8' },
};
