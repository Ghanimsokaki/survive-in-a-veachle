// Software 3D renderer: perspective camera, painter-sorted flat-shaded
// low-poly geometry drawn with the Canvas2D API. No WebGL, no dependencies.
import { BIOMES, INTERIOR_ITEMS } from './data.js';
import { TAU, clamp, hashStr, angDiff } from './util.js';
import { Camera3D, S, ROOF_Y, CAR_HALF_W, CAR_HALF_D, CELL_UNITS, INTERIOR, interiorSlotLocal } from './camera3d.js';
import { box, limbBox, prismZ, prismY, cone, quad, disc, ring } from './geo3d.js';

const THEMES = {
  java:  { g: '#33402b', g2: '#3b4831', road: '#2b2d27', fog: '#33402c', skyTop: '#0a1210', skyBot: '#3d4b3a' },
  city:  { g: '#2c2f34', g2: '#34383d', road: '#25282c', fog: '#33383d', skyTop: '#0a0d12', skyBot: '#3a4048' },
  dock:  { g: '#2f3835', g2: '#37413d', road: '#282f2d', fog: '#323c38', skyTop: '#081214', skyBot: '#3a4643' },
  sea:   { g: '#0e2740', g2: '#123049', road: '#0a2133', fog: '#123950', skyTop: '#050f18', skyBot: '#1f4257' },
  coast: { g: '#3b3a2f', g2: '#454437', road: '#312f27', fog: '#43422f', skyTop: '#0d0f0b', skyBot: '#4a4736' },
  dc:    { g: '#2c2f31', g2: '#34383a', road: '#25282a', fog: '#333739', skyTop: '#090c0e', skyBot: '#3b4144' },
};

const LIGHT = (() => {
  const l = { x: 0.55, y: 0.82, z: 0.25 };
  const n = Math.hypot(l.x, l.y, l.z);
  return { x: l.x / n, y: l.y / n, z: l.z / n };
})();

const PLAYER_COLORS = { shirt: '#e2a13b', pants: '#2b3644', skin: '#cf9b6f', hair: '#241b13', pack: '#5c482c', boots: '#191f27' };
const NPC_COLORS = { shirt: '#2dd4bf', pants: '#1f2937', skin: '#b98457', hair: '#1b1512', pack: '#475569', boots: '#111827' };
const ENEMY_COLORS = {
  raider: { shirt: '#b91c1c', pants: '#27272a', skin: '#b07a55', hair: '#171717' },
  scout: { shirt: '#d97706', pants: '#1f2937', skin: '#c08a5e', hair: '#221a12' },
  brute: { shirt: '#9a3412', pants: '#3f3f46', skin: '#a9744c', hair: '#111' },
  gunner: { shirt: '#dc2626', pants: '#27272a', skin: '#b98a63', hair: '#171717' },
  soldier: { shirt: '#15803d', pants: '#1f3d2a', skin: '#c08a5e', hair: '#161616', helmet: '#166534' },
  heavy: { shirt: '#166534', pants: '#14351f', skin: '#b07a55', hair: '#111', helmet: '#14532d' },
};

export const faceStats = { static: 0, dyn: 0, drawn: 0 };

let staticZone = null;
let staticFaces = [];
let theme = THEMES.java;
let colorCache = new Map();
const L = LIGHT;

// ------------------------------------------------------------------ helpers
function hexRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function shadeColor(hex, shade, fog) {
  const si = Math.round(clamp(shade, 0, 1.5) * 10);
  const fi = Math.round(clamp(fog, 0, 1) * 9);
  const key = hex + '|' + si + '|' + fi;
  const hit = colorCache.get(key);
  if (hit) return hit;
  const c = hexRgb(hex);
  const f = fi / 9;
  const r = Math.round(c.r * (shade / 1) * (1 - f) + hexRgb(theme.fog).r * f);
  const g = Math.round(c.g * (shade / 1) * (1 - f) + hexRgb(theme.fog).g * f);
  const b = Math.round(c.b * (shade / 1) * (1 - f) + hexRgb(theme.fog).b * f);
  const str = `rgb(${clamp(r, 0, 255)},${clamp(g, 0, 255)},${clamp(b, 0, 255)})`;
  colorCache.set(key, str);
  return str;
}

function faceNormal(p) {
  const a = p[0], b = p[1], c = p[2];
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}

function finalizeFaces(faces) {
  for (const f of faces) {
    let cx = 0, cy = 0, cz = 0;
    for (const p of f.p) { cx += p.x; cy += p.y; cz += p.z; }
    const n = f.p.length;
    f.cx = cx / n; f.cy = cy / n; f.cz = cz / n;
    let r = 0;
    for (const p of f.p) r = Math.max(r, Math.hypot(p.x - f.cx, p.y - f.cy, p.z - f.cz));
    f.cr = r;
    if (!f.ds) f.n = faceNormal(f.p);
  }
  return faces;
}

export function carCellPos(car, i) {
  const { cols, rows, cell } = car.grid;
  const col = i % cols, row = (i / cols) | 0;
  return { x: (col - (cols - 1) / 2) * cell, y: (row - (rows - 1) / 2) * cell };
}

function cellLocal(i) {
  const col = i % 6, row = (i / 6) | 0;
  return {
    x: -CAR_HALF_W + CELL_UNITS / 2 + col * CELL_UNITS,
    z: -CAR_HALF_D + CELL_UNITS / 2 + row * CELL_UNITS,
  };
}

// ------------------------------------------------------------------ static world
function buildStatic(zone) {
  const out = [];
  for (const r of zone.ruins) buildRuin(out, r);
  for (const d of zone.decor) buildDecor(out, d);
  for (const lm of zone.landmarks || []) buildLandmark(out, lm);
  return finalizeFaces(out);
}

function buildRuin(out, r) {
  const x = r.cx * S, z = r.cy * S;
  const w = r.w * S, d = r.h * S;
  const h1 = hashStr(r.name);
  if (r.wreck) {
    const tint = h1 % 2 ? '#4b5563' : '#52525b';
    box(out, x, 0.35, z, w * 0.92, 0.7, d * 0.85, tint, (r.rot || 0) * 0.35, 0, 0.02);
    box(out, x - w * 0.18, 0.95, z, w * 0.34, 0.9, d * 0.55, '#6b3a2a', (r.rot || 0) * 0.35);
    box(out, x + w * 0.24, 0.85, z + d * 0.16, w * 0.22, 0.7, d * 0.3, '#374151', (r.rot || 0) * 0.35);
    box(out, x, 1.2, z - d * 0.3, 0.7, 1.4, 0.5, '#7f1d1d');
    // broken hull ribs
    for (let i = -1; i <= 1; i++) {
      box(out, x + i * w * 0.26, 1.0, z + d * 0.36, 0.16, 1.2, 0.16, '#6b7280', (r.rot || 0) * 0.35);
    }
  } else {
    const floorCol = ['#5b574d', '#615c50', '#565a5e', '#5f5a52'][h1 % 4];
    box(out, x, 0.08, z, w, 0.16, d, floorCol);
    // interior partition
    box(out, x, 1.0, z + d * 0.08, 0.28, 2.0, d * 0.5, '#4f4a42', 0, 0, 0.01);
    const wallCol = '#8b8377';
    const wallH = 2.5;
    const t = 0.3;
    const gaps = r.gaps || [false, false, false, false];
    const sides = [
      { ax: 'x', z: z - d / 2, len: w },
      { ax: 'z', x: x + w / 2, len: d },
      { ax: 'x', z: z + d / 2, len: w },
      { ax: 'z', x: x - w / 2, len: d },
    ];
    sides.forEach((side, i) => {
      const len = side.len;
      if (!gaps[i]) {
        if (side.ax === 'x') box(out, x, wallH / 2, side.z, len, wallH, t, wallCol);
        else box(out, side.x, wallH / 2, z, t, wallH, len, wallCol);
      } else {
        const seg = len * 0.34;
        const halves = [-1, 1];
        for (const sgn of halves) {
          if (side.ax === 'x') {
            box(out, x + sgn * (len / 2 - seg / 2), wallH / 2, side.z, seg, wallH, t, wallCol);
          } else {
            box(out, side.x, wallH / 2, z + sgn * (len / 2 - seg / 2), t, wallH, seg, wallCol);
          }
        }
        // lintel above the door
        if (side.ax === 'x') box(out, x, wallH - 0.25, side.z, len * 0.32, 0.5, t, wallCol);
        else box(out, side.x, wallH - 0.25, z, t, 0.5, len * 0.32, wallCol);
      }
    });
    // rubble
    for (const b of r.rubble || []) {
      const bx = x + b.x * (w - 2), bz = z + b.y * (d - 2);
      box(out, bx, 0.2, bz, b.w * S, 0.4, b.h * S, '#6f6a60', b.x * 3);
    }
    // sign post
    box(out, x, 1.6, z + d / 2 - 0.4, 0.12, 3.2, 0.12, '#4b4238');
    box(out, x, 3.1, z + d / 2 - 0.4, 1.6, 0.5, 0.1, '#c9a227');
  }
}

function buildDecor(out, dcd) {
  const x = dcd.x * S, z = dcd.y * S;
  const s = dcd.s || 1;
  switch (dcd.type) {
    case 'tree':
      box(out, x, 0.8 * s, z, 0.35 * s, 1.6 * s, 0.35 * s, '#4b3621');
      box(out, x, 2.0 * s, z, 1.7 * s, 1.4 * s, 1.7 * s, '#2f5d36', dcd.rot);
      box(out, x - 0.3 * s, 2.9 * s, z + 0.2 * s, 1.0 * s, 0.9 * s, 1.0 * s, '#3b7043', dcd.rot);
      break;
    case 'palm':
      box(out, x, 1.25 * s, z, 0.3 * s, 2.5 * s, 0.3 * s, '#5b4327', 0, 0, 0.06);
      box(out, x, 2.62 * s, z, 0.55 * s, 0.4 * s, 0.55 * s, '#3f6b2f');
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + dcd.rot;
        const fx = x + Math.cos(a) * 0.85 * s, fz = z + Math.sin(a) * 0.85 * s;
        box(out, fx, 2.5 * s, fz, 1.6 * s, 0.14, 0.5 * s, '#2f6b3d', -a, 0, -0.22);
      }
      break;
    case 'bush':
      box(out, x, 0.3 * s, z, 1.1 * s, 0.6 * s, 1.0 * s, '#2f5535', dcd.rot);
      box(out, x - 0.2 * s, 0.55 * s, z + 0.1 * s, 0.6 * s, 0.4 * s, 0.6 * s, '#3f6b45', dcd.rot);
      break;
    case 'rock':
      box(out, x, 0.3 * s, z, 1.1 * s, 0.65 * s, 0.9 * s, '#6b7280', dcd.rot, 0.2, 0.15);
      break;
    case 'wreck':
      box(out, x, 0.55, z, 2.4 * s, 0.7, 1.3 * s, '#4a3e36', dcd.rot);
      box(out, x - 0.2, 1.15, z, 1.1 * s, 0.6, 1.1 * s, '#5e5044', dcd.rot);
      break;
    case 'pole':
      box(out, x, 1.6, z, 0.16, 3.2, 0.16, '#5a5048');
      box(out, x, 3.0, z, 1.4, 0.1, 0.1, '#4b4238');
      break;
    case 'debris':
      box(out, x, 0.2, z, 0.8 * s, 0.3, 0.6 * s, '#565b61', dcd.rot);
      break;
    case 'buoy':
      prismY(out, x, 0, z, 0.4, 1.0, '#f59e0b', 6);
      box(out, x, 1.15, z, 0.25, 0.3, 0.25, '#fbbf24');
      break;
    default:
      break;
  }
}

function buildLandmark(out, lm) {
  const x = lm.x * S, z = lm.y * S;
  const s = lm.s || 1;
  switch (lm.t) {
    case 'monument':
      disc(out, x, 0.05, z, 9 * s, '#5b6470', 14);
      disc(out, x, 0.09, z, 5 * s, '#cbd5e1', 12);
      box(out, x, 1.2, z, 2.2 * s, 2.4 * s, 2.2 * s, '#d7dfe8');
      box(out, x, 7.5 * s, z, 1.0 * s, 11 * s, 1.0 * s, '#e2e8f0');
      box(out, x, 13.2 * s, z, 0.5 * s, 1.2 * s, 0.5 * s, '#f8fafc');
      break;
    case 'capitol':
      box(out, x, 2.0, z, 26 * s, 4.0, 16 * s, '#7b838d');
      box(out, x, 4.3, z, 27 * s, 0.6, 17 * s, '#9aa3ad');
      prismY(out, x, 4.5, z, 5 * s, 4 * s, '#cbd5e1', 10);
      cone(out, x, 8.5 * s, z, 1.2 * s, 2.5 * s, '#e2e8f0', 8);
      for (let i = -3; i <= 3; i++) box(out, x + i * 3 * s, 2.2, z + 9.2 * s, 0.7, 4.4, 0.7, '#aab3bd');
      break;
    case 'mosque':
      box(out, x, 1.6, z, 14 * s, 3.2, 12 * s, '#7d8794');
      prismY(out, x, 3.4, z, 4.6 * s, 3.2 * s, '#a8c2d6', 10);
      cone(out, x, 6.6 * s, z, 3.2 * s, 2.4 * s, '#c8dceb', 10);
      box(out, x - 7.5 * s, 3.6, z + 4 * s, 0.9, 7.2, 0.9, '#94a3b8');
      box(out, x + 7.5 * s, 3.6, z + 4 * s, 0.9, 7.2, 0.9, '#94a3b8');
      box(out, x - 7.5 * s, 7.6, z + 4 * s, 1.4, 0.5, 1.4, '#dbeafe');
      box(out, x + 7.5 * s, 7.6, z + 4 * s, 1.4, 0.5, 1.4, '#dbeafe');
      break;
    case 'tower':
      box(out, x, 9, z, 10 * s, 18, 10 * s, '#3f4753');
      box(out, x, 18.6, z, 10.4 * s, 1.2, 10.4 * s, '#4b5563');
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        box(out, x + i * 3.2, 10, z + j * 3.2, 1.2, 14, 0.2, '#5b6672');
      }
      break;
    case 'crane':
      box(out, x, 4, z, 0.8, 8, 0.8, '#f59e0b');
      box(out, x + 4 * s, 8.2, z, 14 * s, 0.5, 0.5, '#f59e0b');
      box(out, x + 9 * s, 7.4, z, 2.4, 1.6, 1.2, '#374151');
      box(out, x + 10 * s, 4.0, z, 0.14, 7, 0.14, '#6b7280');
      break;
    case 'lighthouse':
      prismY(out, x, 0, z, 3.4 * s, 2.2, '#475569', 10);
      prismY(out, x, 0, z, 1.9 * s, 9 * s, '#e2e8f0', 10);
      box(out, x, 4.5, z, 4.4, 0.3, 4.4, '#64748b');
      prismY(out, x, 9, z, 1.4 * s, 1.6, '#fbbf24', 8);
      box(out, x, 10.8, z, 3.0, 0.3, 3.0, '#334155');
      break;
    case 'market': {
      const cols = ['#b45309', '#7f1d1d', '#b45309', '#7f1d1d'];
      for (let i = 0; i < 4; i++) {
        const sx = x + (i - 1.5) * 4.4;
        box(out, sx, 1.0, z, 3.8, 2.0, 2.6, '#5b4a36');
        box(out, sx, 2.3, z, 4.2, 0.3, 3.0, cols[i]);
        box(out, sx, 2.8, z, 3.6, 0.6, 2.4, cols[i]);
      }
      break;
    }
    case 'shipwreck_big':
      box(out, x, 1.0, z, 18 * s, 1.5, 7 * s, '#4b5563', lm.rot || 0.2);
      box(out, x - 2, 2.2, z, 8 * s, 1.4, 5.5 * s, '#6b3a2a', lm.rot || 0.2);
      box(out, x + 5, 2.0, z, 4 * s, 1.2, 4 * s, '#374151', lm.rot || 0.2);
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------ car
let CAR_ALPHA = null;

function carBox(out, G, lx, ly, lz, sx, sy, sz, color, rx = 0, rz = 0, alpha, opts = {}) {
  const c = G.car;
  const cos = Math.cos(c.angle), sin = Math.sin(c.angle);
  const wx = c.x * S + lx * cos - lz * sin;
  const wz = c.y * S + lx * sin + lz * cos;
  box(out, wx, ly, wz, sx, sy, sz, color, c.angle, rx, rz, { ...opts, alpha: alpha == null ? CAR_ALPHA : alpha });
}

function buildCar(G, out) {
  const car = G.car;
  const cx = car.x * S, cz = car.y * S, yaw = car.angle;
  const shallow = car.hull / car.hullMax < 0.35;
  const xray = G.buildMode && G.buildTarget === 'interior';
  CAR_ALPHA = xray ? 0.2 : null;

  if (car.raft) {
    for (const side of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        const bx = cx + Math.cos(yaw) * i * 2.9 - Math.sin(yaw) * side * 3.5;
        const bz = cz + Math.sin(yaw) * i * 2.9 + Math.cos(yaw) * side * 3.5;
        box(out, bx, 0.36, bz, 2.6, 0.52, 0.95, '#8a5a32', yaw);
        box(out, bx, 0.36, bz, 2.66, 0.14, 1.0, '#6b4423', yaw);
      }
    }
    box(out, cx, 0.5, cz, 9.2, 0.22, 6.2, '#7a5230', yaw);
  }

  // chassis
  carBox(out, G, 0, 0.62, 0, 8.7, 0.55, 5.7, '#22313f');
  const paint = car.paint || '#35506b';
  const paintDark = car.paintDark || '#2f4a66';
  const paintTrim = car.paintTrim || '#3b5875';
  carBox(out, G, 0, 1.16, 0, 8.6, 0.9, 5.6, shallow ? '#5a4b45' : paint, 0, 0, null, { skipTop: true });
  carBox(out, G, 2.7, 1.62, 0, 3.0, 0.5, 5.1, paintTrim);
  carBox(out, G, -0.5, 1.86, 0, 4.4, 1.0, 5.0, paintDark, 0, 0, null, { skipTop: true });
  // glass
  carBox(out, G, 1.62, 1.98, 0, 0.14, 0.62, 4.2, '#9fd8ff');
  carBox(out, G, -0.5, 1.98, 2.52, 3.6, 0.55, 0.06, '#8fd3ff');
  carBox(out, G, -0.5, 1.98, -2.52, 3.6, 0.55, 0.06, '#8fd3ff');
  // bumpers, lights
  carBox(out, G, 4.34, 0.95, 0, 0.3, 0.55, 5.3, '#4b5563');
  carBox(out, G, -4.34, 0.95, 0, 0.3, 0.55, 5.3, '#4b5563');
  carBox(out, G, 4.3, 1.55, 2.0, 0.16, 0.34, 0.8, '#fff7cc');
  carBox(out, G, 4.3, 1.55, -2.0, 0.16, 0.34, 0.8, '#fff7cc');
  carBox(out, G, -4.3, 1.55, 1.9, 0.14, 0.3, 0.7, '#b91c1c');
  carBox(out, G, -4.3, 1.55, -1.9, 0.14, 0.3, 0.7, '#b91c1c');
  // spare wheel + jerry cans
  carBox(out, G, -4.4, 1.9, 0, 0.16, 1.2, 1.2, '#111827', 0, Math.PI / 2);
  carBox(out, G, -3.2, 2.2, 2.2, 0.5, 0.5, 0.5, '#b45309');
  carBox(out, G, -3.2, 2.2, -2.2, 0.5, 0.5, 0.5, '#b45309');

  // wheels
  const spin = car.wheelSpin || 0;
  const wheelPos = [[2.7, 2.95], [2.7, -2.95], [-2.7, 2.95], [-2.7, -2.95]];
  for (const [lx, lz] of wheelPos) {
    const wx = cx + lx * Math.cos(yaw) - lz * Math.sin(yaw);
    const wz = cz + lx * Math.sin(yaw) + lz * Math.cos(yaw);
    prismZ(out, wx, 0.85, wz, 0.9, 0.62, '#111827', 8, yaw);
    prismZ(out, wx, 0.85, wz, 0.44, 0.66, '#4b5563', 6, yaw);
    for (let i = 0; i < 2; i++) {
      box(out, wx, 0.85, wz, 0.72, 0.1, 0.68, '#9ca3af', yaw, 0, spin + i * (Math.PI / 2));
    }
  }

  // interior floor + furniture (visible through the glass, or in x-ray build mode)
  const icx = cx + INTERIOR.cx * Math.cos(yaw) - INTERIOR.cz * Math.sin(yaw);
  const icz = cz + INTERIOR.cx * Math.sin(yaw) + INTERIOR.cz * Math.cos(yaw);
  box(out, icx, 1.02, icz, INTERIOR.w, 0.08, INTERIOR.d, '#4a3b2c', yaw, 0, 0,
    { alpha: 1 });
  for (let i = 0; i < 6; i++) {
    const m = car.interior && car.interior[i];
    if (!m) continue;
    const p = interiorSlotLocal(i);
    const wx = cx + p.x * Math.cos(yaw) - p.z * Math.sin(yaw);
    const wz = cz + p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
    buildInteriorItem(out, m, wx, wz, yaw);
  }

  if (!xray) {
    // roof deck + railing
    carBox(out, G, 0, 2.78, 0, CAR_HALF_W * 2 + 0.1, 0.16, CAR_HALF_D * 2 + 0.1, '#8a6239');
    carBox(out, G, 0, 2.86, 0, CAR_HALF_W * 2 - 0.3, 0.03, CAR_HALF_D * 2 - 0.3, '#9c7147');
    for (let i = -3; i <= 3; i++) {
      carBox(out, G, i * 1.1, 2.87, 0, 0.04, 0.02, CAR_HALF_D * 2 - 0.4, '#6f4f30');
    }
    for (const sx of [-1, 1]) {
      carBox(out, G, sx * CAR_HALF_W, 3.02, 0, 0.14, 0.36, CAR_HALF_D * 2, '#b08a5a');
      carBox(out, G, 0, 3.02, sx * CAR_HALF_D, CAR_HALF_W * 2, 0.36, 0.14, '#b08a5a');
      for (let i = -2; i <= 2; i++) {
        carBox(out, G, sx * CAR_HALF_W, 3.02, i * 1.25, 0.2, 0.5, 0.2, '#6b7280');
        carBox(out, G, i * 1.55, 3.02, sx * CAR_HALF_D, 0.2, 0.5, 0.2, '#6b7280');
      }
    }
    // modules
    car.grid.cells.forEach((m, i) => {
      if (!m) return;
      const p = cellLocal(i);
      const wx = cx + p.x * Math.cos(yaw) - p.z * Math.sin(yaw);
      const wz = cz + p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
      buildModule(out, G, m, wx, wz, yaw);
    });
  } else {
    // x-ray: cabin shell outline + mount points
    const hover = Camera3D.screenToInterior(G, G.mouse.x, G.mouse.y);
    for (let i = 0; i < 6; i++) {
      const p = interiorSlotLocal(i);
      const wx = cx + p.x * Math.cos(yaw) - p.z * Math.sin(yaw);
      const wz = cz + p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
      const taken = !!(car.interior && car.interior[i]);
      const sel = i === hover;
      if (!taken) {
        quad(out, wx, 1.11, wz, 1.2, 1.9, sel ? '#fde68a' : '#38bdf8', yaw, sel ? 0.6 : 0.3);
        for (const [ox, oz] of [[-0.5, -0.85], [0.5, -0.85], [-0.5, 0.85], [0.5, 0.85]]) {
          box(out, wx + ox * Math.cos(yaw) - oz * Math.sin(yaw), 1.24,
            wz + ox * Math.sin(yaw) + oz * Math.cos(yaw), 0.08, 0.34, 0.08,
            sel ? '#fde68a' : '#38bdf8', yaw, 0, 0, { alpha: 0.9 });
        }
        const bob2 = 1.55 + Math.sin(G.t * 2.4 + i) * 0.06;
        box(out, wx, bob2, wz, 0.24, 0.24, 0.24, sel ? '#fde68a' : '#38bdf8', G.t * 1.4, 0, 0, { alpha: 0.95 });
      }
    }
  }
  CAR_ALPHA = null;

  // damage smoke
  if (shallow && Math.random() < 0.6) {
    // handled by particles in game; nothing here
  }
}

function buildModule(out, G, m, wx, wz, yaw) {
  const spec = m.spec || {};
  const y0 = ROOF_Y + 0.14;
  const kind = m.kind;
  const rot = yaw;
  switch (kind) {
    case 'floor':
      box(out, wx, y0, wz, 1.24, 0.1, 1.24, '#8a6239', rot);
      box(out, wx, y0 + 0.06, wz, 1.14, 0.03, 1.14, '#9b7147', rot);
      break;
    case 'wall':
      box(out, wx, y0 + 0.55, wz, 1.24, 1.1, 0.34, '#9aa2ac', rot, 0, 0);
      box(out, wx, y0 + 1.12, wz, 1.3, 0.1, 0.42, '#c4ccd6', rot);
      break;
    case 'storage':
      box(out, wx, y0 + 0.42, wz, 1.0, 0.84, 0.95, '#8a6239', rot);
      box(out, wx, y0 + 0.86, wz, 1.04, 0.1, 1.0, '#c99a58', rot);
      box(out, wx, y0 + 0.5, wz + 0.49, 0.2, 0.28, 0.04, '#facc15', rot);
      break;
    case 'bed':
      box(out, wx, y0 + 0.16, wz, 1.16, 0.32, 0.95, '#7e22ce', rot);
      box(out, wx, y0 + 0.34, wz, 1.1, 0.1, 0.9, '#c084fc', rot);
      box(out, wx + 0.42 * Math.cos(rot), y0 + 0.4, wz + 0.42 * Math.sin(rot), 0.24, 0.14, 0.5, '#f5f3ff', rot);
      break;
    case 'solar':
      box(out, wx, y0 + 0.22, wz, 1.2, 0.06, 1.05, '#1e3a8a', rot, -0.45);
      box(out, wx, y0 + 0.07, wz, 0.9, 0.1, 0.7, '#334155', rot);
      break;
    case 'battery':
      box(out, wx, y0 + 0.36, wz, 0.9, 0.72, 0.7, '#3f3f46', rot);
      box(out, wx, y0 + 0.5, wz, 0.92, 0.12, 0.72, '#facc15', rot);
      box(out, wx, y0 + 0.3, wz, 0.92, 0.08, 0.72, '#facc15', rot);
      break;
    case 'medbay':
      box(out, wx, y0 + 0.4, wz, 1.0, 0.8, 0.9, '#e2e8f0', rot);
      box(out, wx, y0 + 0.45, wz + 0.46 * Math.cos(rot), 0.16, 0.5, 0.04, '#dc2626', rot);
      box(out, wx, y0 + 0.45, wz + 0.46 * Math.cos(rot), 0.5, 0.16, 0.04, '#dc2626', rot);
      break;
    case 'garden':
      box(out, wx, y0 + 0.2, wz, 1.1, 0.4, 1.1, '#3f6212', rot);
      for (let i = 0; i < 4; i++) {
        box(out, wx + Math.cos(i * 2) * 0.3, y0 + 0.5, wz + Math.sin(i * 2) * 0.3, 0.24, 0.3, 0.24, '#84cc16', rot);
      }
      break;
    case 'antenna':
      box(out, wx, y0 + 0.12, wz, 0.6, 0.24, 0.6, '#334155', rot);
      box(out, wx, y0 + 1.2, wz, 0.1, 2.2, 0.1, '#94a3b8', rot);
      box(out, wx, y0 + 2.2, wz, 0.8, 0.08, 0.08, '#94a3b8', rot);
      box(out, wx, y0 + 2.4, wz, 0.16, 0.16, 0.16, '#f87171', rot);
      break;
    case 'dronebay':
      box(out, wx, y0 + 0.08, wz, 1.2, 0.16, 1.2, '#312e81', rot);
      box(out, wx, y0 + 0.22, wz, 0.5, 0.16, 0.5, '#6366f1', rot);
      break;
    case 'spikes':
      box(out, wx, y0 + 0.1, wz, 1.1, 0.2, 1.1, '#4b5563', rot);
      for (const [ox, oz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
        cone(out, wx + ox * Math.cos(rot) - oz * Math.sin(rot), y0 + 0.15,
          wz + ox * Math.sin(rot) + oz * Math.cos(rot), 0.16, 0.7, '#d1d5db', 4);
      }
      break;
    case 'shield':
      box(out, wx, y0 + 0.5, wz, 1.2, 1.0, 0.2, '#64748b', rot);
      box(out, wx, y0 + 1.0, wz, 1.26, 0.1, 0.26, '#cbd5e1', rot);
      break;
    case 'trophy':
      box(out, wx, y0 + 0.1, wz, 0.9, 0.2, 0.9, '#3f3f46', rot);
      box(out, wx, y0 + 0.5, wz, 0.34, 0.55, 0.34, '#facc15', rot);
      box(out, wx, y0 + 0.85, wz, 0.6, 0.18, 0.6, '#eab308', rot);
      break;
    case 'kitchen':
      box(out, wx, y0 + 0.36, wz, 1.1, 0.72, 1.0, '#7c2d12', rot);
      box(out, wx, y0 + 0.75, wz, 1.14, 0.08, 1.04, '#a16207', rot);
      box(out, wx, y0 + 0.86, wz, 0.36, 0.2, 0.36, '#d1d5db', rot);
      break;
    case 'lantern':
      box(out, wx, y0 + 0.9, wz, 0.1, 1.8, 0.1, '#4b5563', rot);
      box(out, wx, y0 + 1.9, wz, 0.34, 0.34, 0.34, '#fde68a', rot);
      break;
    case 'turret': {
      const aim = m.aim || 0;
      prismY(out, wx, y0, wz, 0.36, 0.35, '#334155', 8);
      box(out, wx, y0 + 0.5, wz, 0.46, 0.32, 0.46, '#475569', rot);
      const bx = wx + Math.cos(aim) * 0.62;
      const bz = wz + Math.sin(aim) * 0.62;
      box(out, bx, y0 + 0.5, bz, 1.15, 0.16, 0.16, '#0f172a', aim);
      box(out, bx + Math.cos(aim) * 0.5, y0 + 0.5, bz + Math.sin(aim) * 0.5, 0.18, 0.2, 0.2, '#94a3b8', aim);
      if (m.flash > 0) {
        box(out, bx + Math.cos(aim) * 0.72, y0 + 0.5, bz + Math.sin(aim) * 0.72, 0.26, 0.26, 0.26, '#fde68a');
      }
      break;
    }
    default: {
      const tint = {
        workbench: '#b45309', advbench: '#0e7490', nanolab: '#6d28d9',
      }[kind] || '#475569';
      box(out, wx, y0 + 0.34, wz, 1.05, 0.68, 0.9, tint, rot);
      box(out, wx, y0 + 0.72, wz, 1.1, 0.08, 0.95, '#1f2937', rot);
      break;
    }
  }
}

function buildInteriorItem(out, m, wx, wz, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const O = (lx, lz) => ({ x: wx + lx * c - lz * s, z: wz + lx * s + lz * c });
  const y = 1.06;
  switch (m.id) {
    case 'cot': {
      const a = O(0, 0);
      box(out, a.x, y + 0.22, a.z, 1.0, 0.16, 0.72, '#6b7280', yaw);
      box(out, a.x, y + 0.34, a.z, 0.92, 0.14, 0.66, '#7e22ce', yaw);
      const h = O(0.32, 0);
      box(out, h.x, y + 0.42, h.z, 0.26, 0.12, 0.4, '#e9d5ff', yaw);
      break;
    }
    case 'stove': {
      const a = O(0, 0);
      box(out, a.x, y + 0.18, a.z, 0.56, 0.36, 0.46, '#3f3f46', yaw);
      box(out, a.x, y + 0.4, a.z, 0.3, 0.16, 0.3, '#fca5a5', yaw);
      break;
    }
    case 'shelf': {
      const a = O(0, 0.45);
      box(out, a.x, y + 0.3, a.z, 0.9, 0.6, 0.22, '#8a6239', yaw);
      box(out, a.x, y + 0.42, a.z, 0.86, 0.06, 0.26, '#d6a03f', yaw);
      break;
    }
    case 'tank': {
      const a = O(0, 0);
      prismY(out, a.x, y + 0.1, a.z, 0.24, 0.62, '#38bdf8', 8);
      box(out, a.x, y + 0.78, a.z, 0.16, 0.12, 0.16, '#0ea5e9', yaw);
      break;
    }
    case 'fridge': {
      const a = O(0, 0.1);
      box(out, a.x, y + 0.36, a.z, 0.56, 0.72, 0.5, '#e2e8f0', yaw);
      box(out, a.x, y + 0.52, a.z, 0.58, 0.05, 0.52, '#94a3b8', yaw);
      break;
    }
    case 'lamp': {
      const a = O(-0.2, -0.2);
      box(out, a.x, y + 0.4, a.z, 0.07, 0.8, 0.07, '#4b5563', yaw);
      box(out, a.x, y + 0.86, a.z, 0.26, 0.26, 0.26, '#fde68a', yaw);
      break;
    }
    case 'radio': {
      const a = O(0, 0.2);
      box(out, a.x, y + 0.16, a.z, 0.36, 0.24, 0.22, '#1f2937', yaw);
      box(out, a.x, y + 0.42, a.z, 0.04, 0.3, 0.04, '#9ca3af', yaw);
      break;
    }
    case 'bench': {
      const a = O(0, -0.1);
      box(out, a.x, y + 0.42, a.z, 0.9, 0.1, 0.5, '#a16207', yaw);
      for (const sgn of [-1, 1]) {
        const l = O(sgn * 0.34, -0.1);
        box(out, l.x, y + 0.2, l.z, 0.1, 0.42, 0.1, '#4b5563', yaw);
      }
      break;
    }
    case 'medkit': {
      const a = O(-0.2, 0.5);
      box(out, a.x, y + 0.36, a.z, 0.34, 0.42, 0.14, '#e2e8f0', yaw);
      box(out, a.x, y + 0.38, a.z + 0.09, 0.12, 0.24, 0.03, '#dc2626', yaw);
      break;
    }
    case 'safe': {
      const a = O(0, 0);
      box(out, a.x, y + 0.24, a.z, 0.5, 0.48, 0.44, '#27272a', yaw);
      box(out, a.x, y + 0.26, a.z + 0.24, 0.16, 0.16, 0.04, '#facc15', yaw);
      break;
    }
    case 'plant': {
      const a = O(0, 0);
      prismY(out, a.x, y, a.z, 0.2, 0.28, '#b45309', 6);
      box(out, a.x, y + 0.46, a.z, 0.42, 0.36, 0.42, '#4d7c0f', yaw);
      break;
    }
    case 'heater': {
      const a = O(0, 0.2);
      box(out, a.x, y + 0.22, a.z, 0.46, 0.38, 0.34, '#52525b', yaw);
      box(out, a.x, y + 0.4, a.z, 0.4, 0.1, 0.3, '#fb923c', yaw);
      break;
    }
    default: {
      const a = O(0, 0);
      box(out, a.x, y + 0.24, a.z, 0.6, 0.5, 0.5, '#475569', yaw);
    }
  }
}

// ------------------------------------------------------------------ humans
function addHuman(out, o) {
  const { x, z, yaw } = o;
  const cols = o.colors;
  const sc = o.scale || 1;
  const phase = o.phase || 0;
  const moving = o.moving ? 1 : 0;
  const jaw = o.aiming ? 1 : 0;
  const legSwing = Math.sin(phase) * 0.55 * moving;
  const legSwing2 = -legSwing;
  const armSwing = -Math.sin(phase) * 0.42 * moving;
  const bob = Math.abs(Math.sin(phase)) * 0.05 * moving;

  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const W = (lx, lz) => ({ x: x + (lx * cos - lz * sin) * sc, z: z + (lx * sin + lz * cos) * sc });

  // shadow
  disc(out, x, 0.03, z, 0.55 * sc, '#0b0f14', 10, 0.25);

  const hipY = (1.0 + bob) * sc;
  // legs
  for (const side of [-1, 1]) {
    const hip = W(0, side * 0.19);
    limbBox(out, hip.x, 0, hip.z, yaw, 0, hipY, 0, 0.95 * sc, 0.24 * sc,
      (side > 0 ? legSwing : legSwing2) * (o.crouch ? 0.6 : 1), cols.pants || '#1f2937');
    const footSwing = (side > 0 ? legSwing : legSwing2);
    const fx = Math.sin(footSwing) * 0.95 * sc;
    const fy = hipY - Math.cos(footSwing) * 0.95 * sc;
    const foot = W(fx + 0.12 * sc, side * 0.19);
    box(out, foot.x, fy + 0.05, foot.z, 0.42 * sc, 0.16 * sc, 0.3 * sc, cols.boots || '#111827', yaw);
  }
  // pelvis + torso
  const pelvis = W(0, 0);
  box(out, pelvis.x, hipY + 0.12 * sc, pelvis.z, 0.5 * sc, 0.28 * sc, 0.62 * sc, cols.pants || '#1f2937', yaw);
  const torsoY = (1.36 + bob) * sc;
  const torso = W(o.lean || 0, 0);
  box(out, torso.x, torsoY, torso.z, 0.44 * sc, 0.72 * sc, 0.66 * sc, cols.shirt || '#64748b', yaw, 0, 0);
  // backpack
  const pack = W(-0.3, 0);
  box(out, pack.x, torsoY, pack.z, 0.24 * sc, 0.52 * sc, 0.46 * sc, cols.pack || '#334155', yaw);
  // head + hair + helmet
  const head = W(0.02, 0);
  box(out, head.x, (1.86 + bob) * sc, head.z, 0.32 * sc, 0.32 * sc, 0.32 * sc, cols.skin || '#c08a5e', yaw);
  box(out, head.x, (2.04 + bob) * sc, head.z, 0.35 * sc, 0.1 * sc, 0.35 * sc, cols.helmet || cols.hair, yaw);
  box(out, head.x + Math.cos(yaw) * 0.17 * sc, (1.84 + bob) * sc, head.z + Math.sin(yaw) * 0.17 * sc,
    0.05 * sc, 0.06 * sc, 0.09 * sc, cols.skin || '#c08a5e', yaw);
  // arms
  for (const side of [-1, 1]) {
    const sh = W(0, side * 0.42);
    let swing;
    if (jaw) swing = side > 0 ? 1.42 : 1.2;
    else swing = side > 0 ? armSwing : -armSwing;
    limbBox(out, sh.x, 0, sh.z, yaw, 0, (1.62 + bob) * sc, 0, 0.78 * sc, 0.18 * sc, swing, cols.shirt || '#64748b');
    // hand
    const hx = Math.sin(swing) * 0.78;
    const hy = (1.62 + bob) * sc - Math.cos(swing) * 0.78 * sc;
    const hand = W(hx, side * 0.42);
    box(out, hand.x, hy, hand.z, 0.16 * sc, 0.16 * sc, 0.16 * sc, cols.skin || '#c08a5e', yaw);
    // weapon in the right hand
    if (o.weapon && side > 0) {
      const gunY = jaw ? (1.5 + bob) * sc : hy;
      const gunX = jaw ? 0.74 * sc : hx + 0.1;
      const gun = W(gunX, 0.1);
      box(out, gun.x, gunY, gun.z, jaw ? 0.8 * sc : 0.78 * sc, 0.15 * sc, 0.13 * sc, '#1f2937', yaw);
      box(out, gun.x - 0.05, gunY - 0.12 * sc, gun.z, 0.2 * sc, 0.22 * sc, 0.11 * sc, '#111827', yaw);
      const g2 = W(gunX + 0.24, 0.1);
      box(out, g2.x, gunY + 0.01, g2.z, 0.34 * sc, 0.07 * sc, 0.07 * sc, '#0b0f14', yaw);
      if (o.flash) {
        const mz = W(gunX + 0.5, 0.1);
        box(out, mz.x, gunY + 0.01, mz.z, 0.3 * sc, 0.3 * sc, 0.3 * sc, '#fde68a', yaw);
      }
    }
  }
}

function buildPlayer(G, out) {
  const p = G.player;
  if (!p || !p.onFoot) return;
  addHuman(out, {
    x: p.x * S, z: p.y * S, yaw: p.face,
    phase: p.walkPhase, moving: p.moving, aiming: true,
    colors: PLAYER_COLORS, weapon: 'rifle', scale: 1,
    flash: G.fireFlash > 0.01,
  });
}

function buildNPC(out, npc) {
  addHuman(out, {
    x: npc.x * S, z: npc.y * S, yaw: npc.yaw || 0.6,
    phase: 0, moving: false, aiming: false,
    colors: NPC_COLORS, weapon: null, scale: 1,
  });
}

function buildEnemy(G, out, e) {
  const d = e.def;
  const x = e.x * S, z = e.y * S;
  if (d.flyer) {
    const y = 4.6 + Math.sin(G.t * 1.7 + e.seed) * 0.3;
    box(out, x, y, z, 2.2, 0.9, 1.4, d.color, e.angle);
    box(out, x - 1.5, y + 0.1, z, 1.6, 0.35, 0.5, d.color, e.angle);
    box(out, x, y + 0.55, z, 0.4, 0.4, 0.4, '#0f172a', e.angle);
    const spin = G.t * 26;
    box(out, x, y + 0.75, z, 5.0, 0.06, 0.22, '#cbd5e1', spin);
    box(out, x, y + 0.75, z, 0.22, 0.06, 5.0, '#cbd5e1', spin + 1.5);
    disc(out, x, 0.05, z, 1.6, '#0b0f14', 10, 0.25);
    return;
  }
  if (d.boss) {
    // tank
    const yaw = e.angle;
    box(out, x, 0.9, z, 9.0, 1.6, 4.6, '#4d5a3a', yaw);
    box(out, x, 1.9, z, 6.0, 1.0, 3.6, '#5b6b45', yaw);
    box(out, x + Math.cos(yaw) * 0.6, 2.6, z + Math.sin(yaw) * 0.6, 2.6, 0.9, 2.6, '#66794c', yaw);
    box(out, x + Math.cos(yaw) * 3.4, 2.6, z + Math.sin(yaw) * 3.4, 4.2, 0.28, 0.28, '#28331c', yaw);
    for (const s of [-1, 1]) {
      box(out, x - Math.sin(yaw) * s * 2.3, 0.55, z + Math.cos(yaw) * s * 2.3, 9.2, 1.1, 0.9, '#1f2418', yaw);
    }
    box(out, x, 3.5, z, 0.22, 0.9, 0.22, '#facc15', yaw);
    disc(out, x, 0.05, z, 5.2, '#0b0f14', 14, 0.3);
    return;
  }
  if (d.vehicle) {
    const yaw = e.angle;
    const len = d.r * 0.14, wid = d.r * 0.07;
    box(out, x, 0.85, z, len, 0.65, wid, d.color, yaw);
    box(out, x, 1.25, z, len * 0.55, 0.5, wid * 0.9, '#243041', yaw);
    box(out, x + Math.cos(yaw) * len * 0.55, 0.9, z + Math.sin(yaw) * len * 0.55, 0.3, 0.4, wid * 1.05, '#111827', yaw);
    for (const [fx, fz] of [[-len * 0.3, -wid * 0.55], [-len * 0.3, wid * 0.55], [len * 0.3, -wid * 0.55], [len * 0.3, wid * 0.55]]) {
      const wx = x + fx * Math.cos(yaw) - fz * Math.sin(yaw);
      const wz = z + fx * Math.sin(yaw) + fz * Math.cos(yaw);
      prismZ(out, wx, 0.45, wz, 0.42, 0.24, '#0b0f14', 7, yaw);
    }
    box(out, x + Math.sin(yaw) * wid * 0.5, 1.7, z - Math.cos(yaw) * wid * 0.5, 0.2, 0.2, 0.2, '#f87171', yaw);
    disc(out, x, 0.05, z, 1.9, '#0b0f14', 10, 0.25);
    return;
  }
  // humanoid enemies
  const cols = ENEMY_COLORS[e.type] || ENEMY_COLORS.raider;
  const moving = true;
  addHuman(out, {
    x, z, yaw: e.angle || 0,
    phase: G.t * 8 + e.seed * 4, moving,
    aiming: !!d.ranged, weapon: d.ranged ? 'rifle' : 'club',
    colors: cols,
    scale: e.type === 'brute' ? 1.28 : e.type === 'heavy' ? 1.16 : 1,
  });
}

function buildDrones(G, out) {
  for (const d of G.drones) {
    if (!d.deployed) continue;
    const x = d.x * S, z = d.y * S, y = 2.2 + Math.sin(G.t * 3 + d.orbit) * 0.12;
    const yaw = d.angle || 0;
    box(out, x, y, z, 0.7, 0.22, 0.7, '#0ea5e9', yaw);
    box(out, x + Math.cos(yaw) * 0.45, y - 0.02, z + Math.sin(yaw) * 0.45, 0.2, 0.08, 0.5, '#bae6fd', yaw);
    const spin = G.t * 40 + d.orbit;
    for (const [ox, oz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
      const wx = x + ox * Math.cos(yaw) - oz * Math.sin(yaw);
      const wz = z + ox * Math.sin(yaw) + oz * Math.cos(yaw);
      box(out, wx, y + 0.14, wz, 0.5, 0.03, 0.06, '#e0f2fe', spin);
      box(out, wx, y + 0.14, wz, 0.06, 0.03, 0.5, '#e0f2fe', spin);
    }
  }
}

// ------------------------------------------------------------------ props
function buildCrates(G, out, camX, camZ) {
  for (const r of G.zone.ruins) {
    const d = Math.hypot(r.cx * S - camX, r.cy * S - camZ);
    if (d > 65) continue;
    for (const c of r.crates) {
      const x = c.x * S, z = c.y * S;
      if (Math.hypot(x - camX, z - camZ) > 45) continue;
      if (c.looted) {
        box(out, x, 0.3, z, 1.0, 0.6, 1.0, '#4b3a28', 0.2);
        box(out, x, 0.62, z, 0.9, 0.1, 0.9, '#2b2118', 0.2);
      } else {
        const big = c.big;
        const col = big ? '#7c3aed' : '#b7791f';
        box(out, x, 0.45, z, 1.05, 0.9, 1.05, col, 0.1);
        box(out, x, 0.9, z, 1.1, 0.14, 1.1, big ? '#a78bfa' : '#d6a03f', 0.1);
        // floating marker
        const bob = Math.sin(G.t * 2.2 + c.bob) * 0.12;
        box(out, x, 1.7 + bob, z, 0.38, 0.38, 0.08, big ? '#e9d5ff' : '#fde68a', G.t);
        ring(out, x, 0.06, z, 1.0, 0.22, big ? '#c084fc' : '#fbbf24', 7, 0.35);
      }
    }
  }
}

function buildDock(G, out, d) {
  const x = d.x * S, z = d.y * S;
  box(out, x, 0.22, z, 14, 0.44, 9.5, '#6b5844');
  for (let i = -3; i <= 3; i++) box(out, x + i * 1.9, 0.46, z, 0.28, 0.06, 9.2, '#8a7259');
  box(out, x - 1, 1.3, z - 3.4, 3.6, 2.6, 3.0, '#3f4a55');
  box(out, x - 1, 2.75, z - 3.4, 4.2, 0.3, 3.6, '#2b3440');
  box(out, x - 1, 3.4, z - 3.4, 1.8, 0.6, 0.1, '#e0a63c');
  box(out, x + 4.0, 0.9, z + 1.6, 1.2, 1.4, 1.2, '#8a6239');
  box(out, x + 4.0, 0.9, z + 3.0, 1.2, 1.4, 1.2, '#8a6239');
  prismY(out, x + 5.4, 0.44, z - 1.2, 0.55, 1.1, '#b91c1c', 8);
  prismY(out, x + 5.4, 0.44, z - 2.6, 0.55, 1.1, '#a16207', 8);
  // skiff
  box(out, x + 1, 0.5, z + 7.0, 5.2, 0.7, 1.9, '#4b5563', 0.12);
  box(out, x + 1, 1.0, z + 7.0, 2.6, 0.7, 1.4, '#6b7280', 0.12);
  disc(out, x, 0.05, z, d.r * S, '#fbbf24', 16, 0.12);
}

function buildExit(G, out) {
  const e = G.zone.exit;
  const x = e.x * S, z = e.y * S;
  const ready = G.exitReady();
  const col = ready ? '#34d399' : '#f87171';
  const r = e.r * S;
  ring(out, x, 0.06, z, r * 0.8, 0.5, col, 18, 0.45);
  ring(out, x, 0.06, z, r * 0.55, 0.22, col, 16, 0.3);
  // light beam
  box(out, x, 4.0, z, 1.1, 8.0, 1.1, col, 0, 0, 0, 0.12);
  box(out, x + Math.cos(G.t * 0.8) * r * 0.45, 1.6, z + Math.sin(G.t * 0.8) * r * 0.45, 1.3, 0.35, 0.35, col, G.t * 0.8 + Math.PI / 2);
}

function buildBuildOverlay(G, out) {
  if (!G.buildMode || G.buildTarget === 'interior') return;
  const car = G.car;
  const hover = Camera3D.screenToCell(G, G.mouse.x, G.mouse.y);
  const y = ROOF_Y + 0.22;
  const cx = car.x * S, cz = car.y * S, yaw = car.angle;
  for (const i of [hover]) {
    if (i < 0) continue;
    const p = cellLocal(i);
    const wx = cx + p.x * Math.cos(yaw) - p.z * Math.sin(yaw);
    const wz = cz + p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
    quad(out, wx, y, wz, CELL_UNITS * 0.96, CELL_UNITS * 0.96, '#f5b642', yaw, 0.4);
    quad(out, wx, y + 0.01, wz, CELL_UNITS * 0.96, CELL_UNITS * 0.96, '#fff3cf', yaw, 0.2);
  }
  // ghost of the selected module
  if (G.buildSelected && hover >= 0) {
    const cell = cellLocal(hover);
    const wx = cx + cell.x * Math.cos(yaw) - cell.z * Math.sin(yaw);
    const wz = cz + cell.x * Math.sin(yaw) + cell.z * Math.cos(yaw);
    box(out, wx, y + 0.5, wz, 1.22, 1.0, 1.22, '#f5b642', yaw, 0, 0, 0.18);
  }
}

// ------------------------------------------------------------------ draw pipeline
function drawSky(ctx, view, theme2) {
  const horizon = view.h / 2 - Camera3D.focal * Math.tan(Camera3D.pitch);
  const g = ctx.createLinearGradient(0, 0, 0, Math.max(60, horizon));
  g.addColorStop(0, theme2.skyTop);
  g.addColorStop(0.7, theme2.skyBot);
  g.addColorStop(1, theme2.fog);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);

  // sun glow
  if (horizon > -200) {
    const sx = view.w * 0.72;
    const sy = clamp(horizon - 30, -40, view.h);
    const rg = ctx.createRadialGradient(sx, sy, 4, sx, sy, view.h * 0.5);
    rg.addColorStop(0, 'rgba(255,224,168,0.32)');
    rg.addColorStop(0.22, 'rgba(255,190,110,0.10)');
    rg.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, view.w, view.h);
  }
}

function drawWeather(G, ctx, view) {
  if (G.zone.def.isSea) {
    ctx.fillStyle = 'rgba(6,20,34,0.22)';
    ctx.fillRect(0, 0, view.w, view.h);
  }
  const stormy = G.zone.def.id === 'bengal' || G.zone.def.id === 'atlantic';
  if (stormy) {
    ctx.save();
    ctx.strokeStyle = 'rgba(200,230,255,0.28)';
    ctx.lineWidth = 1;
    const t = G.t * 900;
    for (let i = 0; i < 130; i++) {
      const x = ((i * 977 + t * 0.8) % (view.w + 200)) - 100;
      const y = ((i * 613 + t) % (view.h + 200)) - 100;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 6, y + 18);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(10,18,28,0.22)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.restore();
  }
}

// project a world polygon; returns screen points or null
function projectPoly(pts, b, view) {
  const camPts = [];
  for (const p of pts) camPts.push(Camera3D.toCam(p, b));
  let allOut = true;
  for (const c of camPts) if (c.z > 0.45) { allOut = false; break; }
  if (allOut) return null;
  // clip near
  const out = [];
  const near = 0.45;
  for (let i = 0; i < camPts.length; i++) {
    const a = camPts[i];
    const bb = camPts[(i + 1) % camPts.length];
    const ain = a.z >= near;
    const bin = bb.z >= near;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (near - a.z) / (bb.z - a.z);
      out.push({ x: a.x + (bb.x - a.x) * t, y: a.y + (bb.y - a.y) * t, z: near });
    }
  }
  if (out.length < 3) return null;
  const scr = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of out) {
    const x = view.w / 2 + (c.x / c.z) * Camera3D.focal;
    const y = view.h / 2 - (c.y / c.z) * Camera3D.focal;
    scr.push({ x, y });
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < -40 || minX > view.w + 40 || maxY < -40 || minY > view.h + 40) return null;
  return scr;
}

function fillPoly(ctx, pts, color, alpha) {
  if (pts.length < 3) return;
  ctx.globalAlpha = alpha == null ? 1 : alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawGround(G, ctx, view, b) {
  const isSea = G.zone.def.isSea;
  const cam = Camera3D.pos;
  const tile = 17;
  const gx = Math.floor(cam.x / tile), gz = Math.floor(cam.z / tile);
  const zx0 = 0, zx1 = G.zone.w * S, zz0 = 0, zz1 = G.zone.h * S;
  for (let i = -7; i <= 7; i++) {
    for (let j = -7; j <= 7; j++) {
      const tx = (gx + i) * tile, tz = (gz + j) * tile;
      const d = Math.hypot(tx + tile / 2 - cam.x, tz + tile / 2 - cam.z);
      if (d > 125) continue;
      const inside = tx > zx0 - tile && tx < zx1 && tz > zz0 - tile && tz < zz1;
      const h = hashStr(tx + ':' + tz);
      let base = (h % 2) ? theme.g : theme.g2;
      if (!inside) base = isSea ? '#0d2233' : '#2a2d29';
      const fog = clamp((d - 25) / 85, 0, 1);
      const color = shadeColor(base, 1, fog);
      const pts = projectPoly([
        { x: tx, y: 0, z: tz },
        { x: tx + tile, y: 0, z: tz },
        { x: tx + tile, y: 0, z: tz + tile },
        { x: tx, y: 0, z: tz + tile },
      ], b, view);
      if (pts) fillPoly(ctx, pts, color, 1);
    }
  }

  // roads
  if (!isSea) {
    for (const r of G.zone.roads) {
      const x0 = r.x * S, z0 = r.y * S;
      const w = r.w * S, d = r.h * S;
      const pts = projectPoly([
        { x: x0, y: 0.03, z: z0 },
        { x: x0 + w, y: 0.03, z: z0 },
        { x: x0 + w, y: 0.03, z: z0 + d },
        { x: x0, y: 0.03, z: z0 + d },
      ], b, view);
      if (pts) {
        const dc = Math.hypot((x0 + w / 2) - cam.x, (z0 + d / 2) - cam.z);
        fillPoly(ctx, pts, shadeColor(theme.road, 1, clamp((dc - 25) / 85, 0, 1)), 0.95);
      }
      if (r.main) {
        for (let x = 0; x < r.w; x += 120) {
          const dash = projectPoly([
            { x: (r.x + x + 20) * S, y: 0.05, z: (r.y + r.h / 2 - 3) * S },
            { x: (r.x + x + 82) * S, y: 0.05, z: (r.y + r.h / 2 - 3) * S },
            { x: (r.x + x + 82) * S, y: 0.05, z: (r.y + r.h / 2 + 3) * S },
            { x: (r.x + x + 20) * S, y: 0.05, z: (r.y + r.h / 2 + 3) * S },
          ], b, view);
          if (dash) fillPoly(ctx, dash, 'rgba(232,217,168,0.55)', 1);
        }
      }
    }
  } else {
    // swell
    const step = 9;
    const sx = Math.floor(cam.x / step) * step;
    const sz = Math.floor(cam.z / step) * step;
    for (let i = -8; i <= 8; i++) {
      for (let j = -8; j <= 8; j++) {
        const h = hashStr('w' + (sx + i * step) + ':' + (sz + j * step));
        if (h % 5 !== 0) continue;
        const x = sx + i * step + (h % 3);
        const z = sz + j * step + (h % 7);
        const d = Math.hypot(x - cam.x, z - cam.z);
        if (d > 90) continue;
        const wobble = Math.sin(G.t * 1.6 + h % 10) * 0.35;
        const pts = projectPoly([
          { x, y: 0.05, z: z + wobble },
          { x: x + 4.5, y: 0.05, z: z + wobble },
          { x: x + 4.5, y: 0.05, z: z + 0.4 + wobble },
          { x, y: 0.05, z: z + 0.4 + wobble },
        ], b, view);
        if (pts) {
          fillPoly(ctx, pts, shadeColor('#7dd3fc', 1, clamp((d - 20) / 80, 0, 0.8)), 0.18);
        }
      }
    }
  }
}

function renderFaces(ctx, faces, b, view) {
  const visible = [];
  const cam = Camera3D.pos;
  for (const f of faces) {
    const dx = f.cx - cam.x, dy = f.cy - cam.y, dz = f.cz - cam.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 105 * 105) continue;
    // skip sub-pixel geometry early
    if (f.cr * Camera3D.focal / Math.sqrt(d2 || 1) < 0.6) continue;
    if (!f.ds) {
      const n = f.n;
      if (n.x * dx + n.y * dy + n.z * dz >= 0) continue;
    }
    f._d = Math.sqrt(d2);
    visible.push(f);
  }
  visible.sort((a, b2) => b2._d - a._d);
  for (const f of visible) {
    const pts = projectPoly(f.p, b, view);
    if (!pts) continue;
    let shade = 1;
    if (f.n) {
      const nd = f.n.x * L.x + f.n.y * L.y + f.n.z * L.z;
      shade = 0.5 + 0.55 * Math.max(0, nd);
    } else {
      shade = 0.92;
    }
    const fog = clamp((f._d - 30) / 80, 0, 0.92);
    fillPoly(ctx, pts, shadeColor(f.c, shade, fog), f.a);
  }
}

// ------------------------------------------------------------------ overlays
function label(ctx, view, world, text, color, bg = 'rgba(8,12,17,0.72)') {
  const p = Camera3D.worldToScreen(G, world.x, world.y, world.z);
  if (!p || p.x < -100 || p.x > view.w + 100 || p.y < -60 || p.y > view.h + 60) return;
  ctx.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(p.x - w / 2, p.y - 10, w, 20, 6) : ctx.rect(p.x - w / 2, p.y - 10, w, 20);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, p.x, p.y + 1);
}

let G = null; // set per frame for label()

function drawOverlays(g, ctx, view) {
  G = g;
  const cam = Camera3D.pos;
  // ruin labels
  for (const r of g.zone.ruins) {
    const d = Math.hypot(r.cx * S - cam.x, r.cy * S - cam.z);
    if (d > 62) continue;
    const left = r.crates.filter((c) => !c.looted).length;
    const p = Camera3D.worldToScreen(g, r.cx * S, 4.4, r.cy * S);
    if (!p || p.depth < 0) continue;
    const text = `${r.name} · ${left > 0 ? left + ' left' : 'EMPTY'}`;
    label(ctx, view, { x: r.cx * S, y: 4.4, z: r.cy * S }, text, left ? '#fbbf24' : '#9ca3af');
  }
  // npc labels
  for (const r of g.zone.ruins) {
    if (!r.npc || r.npc.recruited) continue;
    const d = Math.hypot(r.npc.x * S - cam.x, r.npc.y * S - cam.z);
    if (d > 45) continue;
    const p = Camera3D.worldToScreen(g, r.npc.x * S, 2.9, r.npc.y * S);
    if (!p) continue;
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#34d399';
    ctx.fillText('SURVIVOR', p.x, p.y - 16);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - 5, p.y - 9);
    ctx.lineTo(p.x + 5, p.y - 9);
    ctx.closePath();
    ctx.fill();
  }
  // enemy hp / boss label
  for (const e of g.enemies) {
    if (e.dead) continue;
    const ex = e.x * S, ez = e.y * S;
    const d = Math.hypot(ex - cam.x, ez - cam.z);
    if (d > 55) continue;
    const top = e.def.boss ? 5.2 : e.def.vehicle ? 2.4 : e.def.flyer ? 6.2 : 2.7;
    const p = Camera3D.worldToScreen(g, ex, top, ez);
    if (!p) continue;
    if (e.def.boss) {
      ctx.font = '800 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#facc15';
      ctx.fillText('GENERAL', p.x, p.y - 12);
    }
    if (e.hp < e.maxHp) {
      const w = 38;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(p.x - w / 2, p.y, w, 4);
      ctx.fillStyle = e.def.boss ? '#facc15' : '#ef4444';
      ctx.fillRect(p.x - w / 2, p.y, w * clamp(e.hp / e.maxHp, 0, 1), 4);
    }
  }
  // bullets
  for (const b of g.bullets) {
    const p = Camera3D.worldToScreen(g, b.x * S, 1.25, b.y * S);
    if (!p) continue;
    const px2 = Camera3D.worldToScreen(g, (b.x - b.vx * 0.02) * S, 1.25, (b.y - b.vy * 0.02) * S);
    ctx.strokeStyle = b.friendly ? (b.turret ? '#67e8f9' : '#fde68a') : '#fca5a5';
    ctx.lineWidth = b.big ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (px2) ctx.lineTo(px2.x, px2.y); else ctx.lineTo(p.x, p.y - 6);
    ctx.stroke();
    if (b.big) {
      ctx.fillStyle = 'rgba(251,146,60,0.65)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, TAU);
      ctx.fill();
    }
  }
  // particles
  for (const pt of g.particles) {
    const p = Camera3D.worldToScreen(g, pt.x * S, 0.6 + (pt.life * 0.5), pt.y * S);
    if (!p) continue;
    ctx.globalAlpha = clamp(pt.life / pt.maxlife, 0, 1);
    ctx.fillStyle = pt.color;
    const s = Math.max(1, pt.size * (p.scale || 1) * 0.06);
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
  // floating text
  for (const f of g.floaters) {
    const p = Camera3D.worldToScreen(g, f.x * S, 2.2, f.y * S);
    if (!p) continue;
    ctx.globalAlpha = clamp(f.life / f.maxlife, 0, 1);
    ctx.font = `700 ${f.size || 13}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText(f.text, p.x + 1, p.y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  // dock label
  if (g.zone.dock) {
    const d = g.zone.dock;
    const dist = Math.hypot(d.x * S - cam.x, d.y * S - cam.z);
    if (dist < 45) label(ctx, view, { x: d.x * S, y: 5.6, z: d.y * S }, '⚓ DOCK · TRADE · REPAIR', '#fbbf24');
  }
  // exit label
  {
    const e = g.zone.exit;
    const dist = Math.hypot(e.x * S - cam.x, e.y * S - cam.z);
    if (dist < 55) {
      label(ctx, view, { x: e.x * S, y: 7.5, z: e.y * S }, g.exitReady() ? 'DEPART →' : 'LOCKED', g.exitReady() ? '#34d399' : '#f87171');
    }
  }
  // interior build tooltip
  if (g.buildMode && g.buildTarget === 'interior') {
    const slot = Camera3D.screenToInterior(g, g.mouse.x, g.mouse.y);
    const item = g.interiorSelected
      ? INTERIOR_ITEMS.find((x) => x.id === g.interiorSelected)
      : null;
    if (slot >= 0) {
      const car = g.car;
      const p = interiorSlotLocal(slot);
      const wx = car.x * S + p.x * Math.cos(car.angle) - p.z * Math.sin(car.angle);
      const wz = car.y * S + p.x * Math.sin(car.angle) + p.z * Math.cos(car.angle);
      const scr = Camera3D.worldToScreen(g, wx, INTERIOR.y + 0.5, wz);
      if (scr) {
        const taken = !!(car.interior && car.interior[slot]);
        const txt = taken ? 'occupied · right-click to remove' : (item ? `click to install ${item.name}` : 'pick furniture');
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(8,12,17,0.8)';
        const w = ctx.measureText(txt).width + 16;
        ctx.fillRect(scr.x - w / 2, scr.y - 26, w, 20);
        ctx.fillStyle = '#fde68a';
        ctx.fillText(txt, scr.x, scr.y - 12);
      }
    }
  }

  // aim reticle
  if (g.aimPoint && !g.buildMode) {
    const p = Camera3D.worldToScreen(g, g.aimPoint.x * S, 0.08, g.aimPoint.y * S);
    if (p) {
      ctx.strokeStyle = 'rgba(245,182,66,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, TAU);
      ctx.moveTo(p.x - 13, p.y); ctx.lineTo(p.x - 4, p.y);
      ctx.moveTo(p.x + 4, p.y); ctx.lineTo(p.x + 13, p.y);
      ctx.moveTo(p.x, p.y - 13); ctx.lineTo(p.x, p.y - 4);
      ctx.moveTo(p.x, p.y + 4); ctx.lineTo(p.x, p.y + 13);
      ctx.stroke();
    }
  }
}

export function draw(g, ctx, view) {
  if (!g.zone) return;
  theme = THEMES[g.zone.def.biome] || THEMES.java;
  if (staticZone !== g.zone) {
    staticZone = g.zone;
    staticFaces = buildStatic(g.zone);
    colorCache = new Map();
  }
  const cam = Camera3D;
  // screen shake
  const shake = Math.min(g.shake || 0, 14);
  const px = cam.pos.x, py = cam.pos.y, pz = cam.pos.z;
  if (shake > 0.1) {
    cam.pos.x += (Math.random() - 0.5) * shake * 0.18;
    cam.pos.y += (Math.random() - 0.5) * shake * 0.14;
    cam.pos.z += (Math.random() - 0.5) * shake * 0.18;
  }
  const b = cam.basis();
  cam._b = b;

  drawSky(ctx, view, theme);
  drawGround(g, ctx, view, b);

  const staticCount = staticFaces.length;
  const faces = [];
  const camX = cam.pos.x, camZ = cam.pos.z;
  for (const f of staticFaces) {
    const dx = f.cx - cam.pos.x, dz = f.cz - cam.pos.z;
    if (dx * dx + dz * dz > 92 * 92) continue;
    faces.push(f);
  }

  // dynamic objects, culled by distance
  const dyn = [];
  buildCar(g, dyn);
  buildPlayer(g, dyn);
  buildDrones(g, dyn);
  buildCrates(g, dyn, camX, camZ);
  for (const r of g.zone.ruins) {
    if (!r.npc || r.npc.recruited) continue;
    if (Math.hypot(r.npc.x * S - camX, r.npc.y * S - camZ) > 62) continue;
    buildNPC(dyn, r.npc);
  }
  for (const e of g.enemies) {
    if (e.dead) continue;
    if (Math.hypot(e.x * S - camX, e.y * S - camZ) > 70) continue;
    buildEnemy(g, dyn, e);
  }
  if (g.zone.dock) {
    const d = g.zone.dock;
    if (Math.hypot(d.x * S - camX, d.y * S - camZ) < 85) buildDock(g, dyn, d);
  }
  buildExit(g, dyn);
  buildBuildOverlay(g, dyn);
  finalizeFaces(dyn);
  for (const f of dyn) faces.push(f);

  faceStats.static = staticCount;
  faceStats.drawn = faces.length;
  faceStats.dyn = dyn.length;
  renderFaces(ctx, faces, b, view);
  drawWeather(g, ctx, view);
  drawOverlays(g, ctx, view);

  cam.pos.x = px; cam.pos.y = py; cam.pos.z = pz;
  cam._b = null;
}

// ------------------------------------------------------------------ minimap
export function drawMinimap(G2, mctx, mw, mh) {
  const z = G2.zone;
  mctx.clearRect(0, 0, mw, mh);
  mctx.fillStyle = z.def.isSea ? '#0b2236' : '#242a26';
  mctx.fillRect(0, 0, mw, mh);
  const s = Math.min(mw / z.w, mh / z.h);
  const ox = (mw - z.w * s) / 2, oy = (mh - z.h * s) / 2;

  mctx.fillStyle = 'rgba(255,255,255,0.07)';
  mctx.fillRect(ox, oy, z.w * s, z.h * s);

  for (const r of z.ruins) {
    const left = r.crates.filter((c) => !c.looted).length;
    mctx.fillStyle = left ? '#fbbf24' : 'rgba(120,120,120,0.6)';
    mctx.fillRect(ox + r.x * s, oy + r.y * s, Math.max(2, r.w * s), Math.max(2, r.h * s));
  }
  if (z.dock) {
    mctx.fillStyle = '#38bdf8';
    mctx.fillRect(ox + z.dock.x * s - 3, oy + z.dock.y * s - 3, 6, 6);
  }
  mctx.fillStyle = G2.exitReady() ? '#34d399' : '#f87171';
  mctx.beginPath();
  mctx.arc(ox + z.exit.x * s, oy + z.exit.y * s, 4, 0, TAU);
  mctx.fill();

  for (const e of G2.enemies) {
    mctx.fillStyle = e.def.boss ? '#facc15' : '#ef4444';
    mctx.fillRect(ox + e.x * s - 1.5, oy + e.y * s - 1.5, 3, 3);
  }
  for (const r of z.ruins) {
    if (r.npc && !r.npc.recruited) {
      mctx.fillStyle = '#34d399';
      mctx.fillRect(ox + r.npc.x * s - 2, oy + r.npc.y * s - 2, 4, 4);
    }
  }
  // player
  if (G2.player && G2.player.onFoot) {
    mctx.fillStyle = '#fde68a';
    mctx.beginPath();
    mctx.arc(ox + G2.player.x * s, oy + G2.player.y * s, 2.4, 0, TAU);
    mctx.fill();
  }
  mctx.save();
  mctx.translate(ox + G2.car.x * s, oy + G2.car.y * s);
  mctx.rotate(G2.car.angle);
  mctx.fillStyle = '#f8fafc';
  mctx.beginPath();
  mctx.moveTo(6, 0); mctx.lineTo(-4, -4); mctx.lineTo(-4, 4);
  mctx.closePath(); mctx.fill();
  mctx.restore();

  mctx.strokeStyle = 'rgba(255,255,255,0.22)';
  mctx.lineWidth = 1;
  mctx.strokeRect(ox + 0.5, oy + 0.5, z.w * s - 1, z.h * s - 1);
}
