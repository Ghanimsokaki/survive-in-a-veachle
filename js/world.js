// Route from Java to Washington DC, and the procedural zone builder.
import { mulberry32, randInt, rand, pick, hashStr } from './util.js';
import { NAMES, ROLE_KEYS } from './data.js';

const RUIN_NAMES_ID = [
  'Warung Budi', 'Toko Sembako', 'Bengkel Motor', 'Rumah Sakit Desa', 'Masjid Al-Huda',
  'Sekolah Dasar 03', 'Gudang Kopi', 'Kantor Desa', 'Pabrik Tahu', 'Pos Ronda',
  'Klinik Sehat', 'Pasar Ikan', 'Gudang Beras', 'Warung Sate', 'Balai Warga',
];
const RUIN_NAMES_US = [
  'Gas & Go', 'Route 9 Diner', 'Sunset Motel', 'First Baptist Church', 'Police Dept',
  'Save-A-Lot Market', 'Hardware Store', 'County Clinic', 'Auto Repair', 'Town Hall',
  'High School Gym', 'Bodega', 'Laundromat', 'Fire Station', 'Radio Shack',
];
export const NPC_NAMES_EXTRA = NAMES;

export const ZONES = [
  {
    id: 'java', name: 'Kampung Ruins', sub: 'Java · Indonesia', biome: 'java', isSea: false,
    tier: 1, w: 3800, h: 2600, ruins: 15, maxEnemies: 6, spawnEvery: 7,
    enemies: { raider: 1 }, greeting: 'The eviction notice was a fire. Build a home on the car.',
  },
  {
    id: 'jakarta', name: 'Jakarta Outskirts', sub: 'Java · Indonesia', biome: 'city', isSea: false,
    tier: 2, w: 4200, h: 2800, ruins: 18, maxEnemies: 8, spawnEvery: 6,
    enemies: { raider: 3, scout: 2, brute: 1 }, greeting: 'Raider gangs own the ring road. Loot fast, drive faster.',
  },
  {
    id: 'sunda', name: 'Sunda Docks', sub: 'Sunda Strait · Indonesia', biome: 'dock', isSea: false,
    tier: 2, w: 3400, h: 2400, ruins: 10, maxEnemies: 8, spawnEvery: 7, dock: true,
    enemies: { raider: 2, gunner: 2, brute: 1 },
    greeting: 'The last dock. You will need a raft and a ship engine to leave the country.',
  },
  {
    id: 'malacca', name: 'Malacca Strait', sub: 'Indian Ocean', biome: 'sea', isSea: true,
    tier: 2, w: 4600, h: 3000, ruins: 12, maxEnemies: 7, spawnEvery: 7,
    enemies: { pirate: 1, scout: 1 }, greeting: 'Open water. Pirates hunt anything that floats.',
  },
  {
    id: 'bengal', name: 'Bay of Bengal', sub: 'Indian Ocean', biome: 'sea', isSea: true,
    tier: 3, w: 5000, h: 3200, ruins: 13, maxEnemies: 9, spawnEvery: 6,
    enemies: { pirate: 3, gunner: 1 }, greeting: 'A storm front is building. Keep the hull together.',
  },
  {
    id: 'mumbai', name: 'Mumbai Ruins', sub: 'India · Coast', biome: 'coast', isSea: false,
    tier: 3, w: 4400, h: 3000, ruins: 18, maxEnemies: 10, spawnEvery: 6, dock: true,
    enemies: { raider: 3, gunner: 3, car: 1 }, greeting: 'A half-sunk city, still full of loot and worse company.',
  },
  {
    id: 'arabian', name: 'Arabian Sea', sub: 'Indian Ocean', biome: 'sea', isSea: true,
    tier: 3, w: 5200, h: 3200, ruins: 13, maxEnemies: 10, spawnEvery: 6,
    enemies: { pirate: 4, car: 1 },
    greeting: 'Nothing but water for a thousand kilometres. Watch the fuel and the hull.',
  },
  {
    id: 'atlantic', name: 'Atlantic Crossing', sub: 'Atlantic Ocean', biome: 'sea', isSea: true,
    tier: 4, w: 5600, h: 3400, ruins: 15, maxEnemies: 12, spawnEvery: 5,
    enemies: { pirate: 5, heli: 1, car: 1 }, greeting: 'Halfway to America. The wrecks here are older than you.',
  },
  {
    id: 'miami', name: 'Miami Coast', sub: 'Florida · USA', biome: 'coast', isSea: false,
    tier: 4, w: 4800, h: 3200, ruins: 20, maxEnemies: 12, spawnEvery: 5, dock: true,
    enemies: { soldier: 3, raider: 2, apc: 1 },
    greeting: 'You made it to America. The army has orders to stop anyone like you.',
  },
  {
    id: 'dc', name: 'Washington D.C.', sub: 'The Capital · USA', biome: 'dc', isSea: false,
    tier: 5, w: 4600, h: 3200, ruins: 16, maxEnemies: 14, spawnEvery: 999, dock: true,
    enemies: { soldier: 4, heavy: 2, apc: 1 }, finale: true,
    greeting: 'Final stand. Build the best house on wheels, then survive five army waves.',
  },
];

function overlaps(r, list, pad = 90) {
  return list.some((o) => !(
    r.x + r.w + pad < o.x || o.x + o.w + pad < r.x ||
    r.y + r.h + pad < o.y || o.y + o.h + pad < r.y
  ));
}

export function genZone(index) {
  const def = ZONES[index];
  const rng = mulberry32(hashStr(def.id) + 1337);
  const z = {
    def, index, w: def.w, h: def.h,
    start: { x: 210, y: def.h / 2 },
    exit: { x: def.w - 210, y: def.h / 2, r: 96 },
    dock: def.dock ? { x: 330, y: def.h / 2 + 240, r: 150 } : null,
    ruins: [], decor: [], roads: [], seed: hashStr(def.id),
  };

  const LANDMARKS = {
    java: [['mosque', 0.2, 0.24], ['market', 0.78, 0.76]],
    city: [['tower', 0.17, 0.72], ['tower', 0.74, 0.2]],
    dock: [['crane', 0.52, 0.18], ['market', 0.8, 0.82]],
    coast: [['lighthouse', 0.84, 0.2], ['shipwreck_big', 0.28, 0.82]],
    dc: [['monument', 0.23, 0.26], ['capitol', 0.76, 0.74]],
    sea: [['shipwreck_big', 0.3, 0.34], ['shipwreck_big', 0.72, 0.78]],
  };
  z.landmarks = (LANDMARKS[def.biome] || []).map(([t, fx, fy]) => ({
    t, x: def.w * fx, y: def.h * fy, rot: rand(-0.35, 0.35), s: t === 'monument' ? 1.15 : rand(0.85, 1.15),
  }));

  const names = def.biome === 'java' || def.biome === 'city' || def.biome === 'dock'
    ? RUIN_NAMES_ID : RUIN_NAMES_US;

  const count = def.ruins;
  let tries = 0;
  while (z.ruins.length < count && tries < count * 40) {
    tries++;
    const isWreck = def.isSea;
    const w = isWreck ? randInt(130, 240) : randInt(210, 430);
    const h = isWreck ? randInt(100, 170) : randInt(170, 310);
    const x = randInt(300, def.w - 380);
    const y = randInt(170, def.h - h - 170);
    const cand = { x, y, w, h };
    if (x < 520 && Math.abs(y + h / 2 - def.h / 2) < 300) continue; // keep the spawn clear
    if (x > def.w - 620 && Math.abs(y + h / 2 - def.h / 2) < 260) continue; // and the exit
    if (z.dock && Math.abs(x - z.dock.x) < 320 && Math.abs(y - z.dock.y) < 320) continue;
    if (overlaps(cand, z.ruins)) continue;
    if (z.landmarks.some((lm) => Math.abs(lm.x - (x + w / 2)) < 260 && Math.abs(lm.y - (y + h / 2)) < 220)) continue;

    const ruin = {
      id: 'u' + z.ruins.length,
      x, y, w, h,
      cx: x + w / 2, cy: y + h / 2,
      rot: isWreck ? rand(-0.6, 0.6) : (rng() < 0.5 ? 0 : Math.PI / 2) * (rng() < 0.5 ? 0 : 1),
      wreck: isWreck,
      name: isWreck
        ? pick(['Cargo Wreck', 'Sunken Trawler', 'Container Hull', 'Old Freighter', 'Oil Barge', 'Ghost Ferry', 'Broken Catamaran'])
        : names[Math.floor(rng() * names.length)],
      crates: [],
      npc: null,
      looted: false,
    };
    const rr = mulberry32(hashStr(ruin.id + ruin.name + z.seed));
    ruin.gaps = [0, 1, 2, 3].map(() => rr() < 0.55);
    ruin.rubble = Array.from({ length: 7 }, () => ({ x: (rr() - 0.5), y: (rr() - 0.5), w: 6 + rr() * 10, h: 4 + rr() * 8 }));
    const crateCount = isWreck ? randInt(2, 4) : randInt(3, 6);
    for (let c = 0; c < crateCount; c++) {
      ruin.crates.push({
        x: x + 34 + rng() * (w - 68),
        y: y + 30 + rng() * (h - 60),
        looted: false,
        bob: rng() * Math.PI * 2,
        big: rng() < 0.22,
      });
    }
    // A survivor hides in some ruins.
    if (def.finale ? rng() < 0.28 : rng() < 0.33) {
      ruin.npc = {
        name: NAMES[Math.floor(rng() * NAMES.length)],
        role: ROLE_KEYS[Math.floor(rng() * ROLE_KEYS.length)],
        x: ruin.cx + rand(-30, 30),
        y: ruin.cy + rand(-24, 24),
        recruited: false,
      };
    }
    z.ruins.push(ruin);
  }

  // Guarantee at least one recruitable survivor in the first few zones.
  if (index <= 2) {
    const known = z.ruins.find((r) => r.npc);
    if (!known && z.ruins[0]) {
      z.ruins[0].npc = {
        name: NAMES[Math.floor(rng() * NAMES.length)],
        role: index === 0 ? 'scavenger' : ROLE_KEYS[Math.floor(rng() * ROLE_KEYS.length)],
        x: z.ruins[0].cx, y: z.ruins[0].cy, recruited: false,
      };
    }
  }

  // Decoration
  const decorCount = Math.round((def.w * def.h) / (def.isSea ? 62000 : 42000));
  for (let i = 0; i < decorCount; i++) {
    const x = randInt(0, def.w);
    const y = randInt(0, def.h);
    if (z.ruins.some((r) => x > r.x - 20 && x < r.x + r.w + 20 && y > r.y - 20 && y < r.y + r.h + 20)) continue;
    let type;
    if (def.isSea) type = pick(['debris', 'debris', 'buoy', 'buoy', 'rock']);
    else if (def.biome === 'java' || def.biome === 'coast') type = pick(['palm', 'palm', 'tree', 'rock', 'bush', 'bush', 'wreck']);
    else type = pick(['bush', 'rock', 'debris', 'pole', 'wreck', 'tree']);
    z.decor.push({ type, x, y, r: rand(8, 26), rot: rand(0, Math.PI * 2), s: rand(0.7, 1.5) });
  }

  // Roads across land zones
  if (!def.isSea) {
    const mainY = def.h / 2;
    z.roads.push({ x: 0, y: mainY - 62, w: def.w, h: 124, main: true });
    for (let i = 0; i < 3; i++) {
      if (rng() < 0.7) {
        const y = randInt(200, def.h - 260);
        z.roads.push({ x: 0, y, w: def.w, h: randInt(36, 60), main: false });
      }
    }
  }
  return z;
}
