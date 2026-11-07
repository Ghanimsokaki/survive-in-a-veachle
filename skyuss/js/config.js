// SKYUSS — tunables. Everything numeric that designers like to tweak lives here
// so the sim (js/sim.js) and the renderer (js/main.js) read the same truth.

export const WORLD = {
  seed: 20261107,
  // The cloud sea sits around y = 0. There is no ground — only vapour.
  cloudBand: 260,          // half-extent of the playable square in metres
  cloudTop: 46,            // soft ceiling of the cloud deck
  safeFloor: -30,          // above this you are flying; below it you are falling
  abyssY: -140,            // past this the sky tears you apart
  // Open world: content is generated per cell and streamed around the ship,
  // so there is no edge to the cloud sea.
  cellSize: 320,           // metres per world cell
  viewRadius: 1,           // cells kept loaded around the ship (3x3)
  farLimit: 40000,         // sanity clamp only, far beyond any real flight
  islands: 16,
  derelicts: 7,
  storms: 5,
  graveyard: { x: 0, z: 0, r: 150 },
};

// ------------------------------------------------------------------ the ship
// Five tiers per component. index 0 = stock Enterprise, 4 = cinematic refit.
export const SHIP_TIERS = {
  saucer: {
    label: 'Saucer Section',
    icon: '🛸',
    desc: 'Crew capacity and 360° phaser bank coverage.',
    keys: ['crew', 'banks', 'shieldCap'],
  },
  nacelles: {
    label: 'Warp Nacelles',
    icon: '⚡',
    desc: 'Top speed, turn agility and warp-dash cooldown.',
    keys: ['maxSpeed', 'turnRate', 'warpCd'],
  },
  deflector: {
    label: 'Deflector Dish',
    icon: '🔵',
    desc: 'Shield capacity, deflection rate and tractor strength.',
    keys: ['maxShields', 'regen', 'tractor'],
  },
  weapons: {
    label: 'Weapons Systems',
    icon: '🔥',
    desc: 'Damage, rate of fire, torpedoes and lock-on cone.',
    keys: ['weaponDamage', 'fireRate', 'lockCone'],
  },
};

// per tier: name + the stat values it installs + what it costs to reach it
export const SHIP_UPGRADES = {
  saucer: [
    { name: 'Constitution Hull', crew: 4, banks: 2, shieldCap: 60, cost: {} },
    { name: 'Refit Saucer', crew: 6, banks: 3, shieldCap: 90, cost: { titanium: 120, dilithium: 40 } },
    { name: 'Sovereign Ring', crew: 9, banks: 4, shieldCap: 140, cost: { titanium: 260, dilithium: 90 } },
    { name: 'Vesta Command Ring', crew: 14, banks: 6, shieldCap: 200, cost: { titanium: 460, dilithium: 170, matrix: 3 } },
    { name: 'Odyssey Crown', crew: 22, banks: 8, shieldCap: 300, cost: { titanium: 780, dilithium: 300, matrix: 8 } },
  ],
  nacelles: [
    { name: 'Class-2 Warp Nacelles', maxSpeed: 34, turnRate: 1.15, warpCd: 12, cost: {} },
    { name: 'LF-9 Warp Coils', maxSpeed: 44, turnRate: 1.3, warpCd: 10, cost: { titanium: 100, dilithium: 55 } },
    { name: 'Variable Geometry Nacelles', maxSpeed: 56, turnRate: 1.5, warpCd: 8, cost: { titanium: 230, dilithium: 110 } },
    { name: 'Transwarp Conduit Pair', maxSpeed: 72, turnRate: 1.72, warpCd: 6, cost: { titanium: 420, dilithium: 200, matrix: 4 } },
    { name: 'Quantum Slipstream Vectors', maxSpeed: 92, turnRate: 1.95, warpCd: 4, cost: { titanium: 700, dilithium: 340, matrix: 10 } },
  ],
  deflector: [
    { name: 'Mk-I Deflector', maxShields: 120, regen: 6, tractor: 1, cost: {} },
    { name: 'Mk-III Deflector', maxShields: 180, regen: 9, tractor: 1.3, cost: { titanium: 110, dilithium: 60 } },
    { name: 'Regenerative Dish', maxShields: 260, regen: 14, tractor: 1.6, cost: { titanium: 240, dilithium: 120 } },
    { name: 'Ablative Array', maxShields: 360, regen: 20, tractor: 2, cost: { titanium: 430, dilithium: 210, matrix: 4 } },
    { name: 'Adaptive Shielding', maxShields: 500, regen: 30, tractor: 2.6, cost: { titanium: 720, dilithium: 330, matrix: 9 } },
  ],
  weapons: [
    { name: 'Plasma Bolts', weaponDamage: 9, fireRate: 5.5, lockCone: 0.22, cost: {} },
    { name: 'Phaser Banks', weaponDamage: 15, fireRate: 7, lockCone: 0.3, cost: { titanium: 120, dilithium: 70 } },
    { name: 'Photon Torpedoes', weaponDamage: 24, fireRate: 8.5, lockCone: 0.36, cost: { titanium: 260, dilithium: 140 } },
    { name: 'Quantum Torpedoes', weaponDamage: 36, fireRate: 10, lockCone: 0.42, cost: { titanium: 480, dilithium: 240, matrix: 5 } },
    { name: 'Quantum Spire Array', weaponDamage: 52, fireRate: 12, lockCone: 0.5, cost: { titanium: 800, dilithium: 400, matrix: 12 } },
  ],
};

export const SHIP_BASE = {
  hull: 400,
  energy: 100,
  energyRegen: 9,
  boostCost: 18,
  boltSpeed: 260,
  torpedoSpeed: 190,
  torpedoDamageMult: 4,
  torpedoCost: 12,
  torpCooldown: 3.2,
};

// ------------------------------------------------------------- sky fortress
// Sleek sci-fi platform pieces (not voxel blocks): each piece is a cell in a
// 12×12 holographic grid, must touch an existing piece, and pays its cost.
export const FORT = {
  size: 12,              // grid is size × size cells, origin at the core
  cell: 12,              // metres per cell
  maxPieces: 96,
  coreCell: { ix: 6, iz: 6 },
  depositRange: 90,      // how close the ship must be to bank resources
  buildRange: 220,
};

export const FORT_PIECES = {
  platform: {
    label: 'Deck Platform', icon: '🟦', cost: { titanium: 20 },
    desc: 'The spine of the fortress. Every piece must touch a deck.',
  },
  phaser: {
    label: 'Phaser Turret', icon: '🎯', cost: { titanium: 55, dilithium: 15 },
    desc: 'Auto-tracks hostiles inside 220 m. 14 dmg / 0.9 s.',
    turret: { range: 220, damage: 14, interval: 0.9 },
  },
  shield: {
    label: 'Shield Pylon', icon: '🛡️', cost: { titanium: 70, dilithium: 30 },
    desc: 'Adds 240 fortress shield and slows siege damage.',
    shield: 240,
  },
  missile: {
    label: 'SAM Battery', icon: '🚀', cost: { titanium: 90, dilithium: 40, matrix: 1 },
    desc: 'Long-range missiles: 46 dmg / 2.4 s out to 380 m.',
    turret: { range: 380, damage: 46, interval: 2.4, missile: true },
  },
  refinery: {
    label: 'Refinery Node', icon: '⛏️', cost: { titanium: 60 },
    desc: 'Passively mines +0.9 titanium/s and +0.35 dilithium/s.',
    yield: { titanium: 0.9, dilithium: 0.35 },
  },
  matrix: {
    label: 'Matrix Condenser', icon: '💠', cost: { titanium: 110, dilithium: 60 },
    desc: 'Rare matrix components: +0.06/s while you are away.',
    yield: { matrix: 0.06 },
  },
  habitat: {
    label: 'Crew Habitat', icon: '🏙️', cost: { titanium: 40 },
    desc: 'Housing for your crew. +40 fortress hull, faster repairs.',
    hull: 40,
  },
  turbolift: {
    label: 'Turbolift Hub', icon: '🔗', cost: { titanium: 30, dilithium: 10 },
    desc: 'Extends turret coverage: +12% range for every turret on the fort.',
  },
};

export const PIECE_ORDER = ['platform', 'phaser', 'shield', 'missile', 'refinery', 'matrix', 'habitat', 'turbolift'];

// --------------------------------------------------------------- hostiles
export const PIRATE_TYPES = {
  skiff: { name: 'Pirate Skiff', hp: 70, speed: 26, damage: 7, range: 170, rate: 1.4, size: 1, bounty: { titanium: 18, dilithium: 6 } },
  raider: { name: 'Raider', hp: 130, speed: 24, damage: 11, range: 210, rate: 1.1, size: 1.3, bounty: { titanium: 30, dilithium: 10 } },
  siege: { name: 'Siege Barge', hp: 320, speed: 15, damage: 20, range: 260, rate: 1.6, size: 2, bounty: { titanium: 70, dilithium: 26, matrix: 1 } },
  dread: { name: 'Dread Corsair', hp: 620, speed: 13, damage: 28, range: 300, rate: 1.3, size: 2.6, bounty: { titanium: 140, dilithium: 60, matrix: 3 } },
};

export const SIEGE = {
  firstAt: 150,          // seconds before the first siege
  interval: 190,
  waveSize: [3, 5, 7, 9],
};

export const SCAVENGE = {
  derelictRange: 70,
  derelictLoot: { titanium: [40, 110], dilithium: [15, 55], matrix: [0, 2] },
  islandRange: 60,
  islandLoot: { titanium: [20, 60], dilithium: [8, 30] },
};
