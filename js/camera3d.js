// Perspective camera + ray helpers for the 3D renderer.
// The simulation still runs in 2D game units (px); 1 px = S world units.
import { clamp, angDiff } from './util.js';

export const S = 0.05; // px -> 3D units
export const ROOF_Y = 2.86; // height of the car roof platform
export const CAR_HALF_W = 3.9; // roof half extents (units)
export const CAR_HALF_D = 2.6;
export const CELL_UNITS = 1.3;

// cabin interior: six mount points inside the body
export const INTERIOR = { cx: -0.5, cz: 0, cols: 3, rows: 2, w: 3.4, d: 3.6, y: 1.15 };

export function interiorSlotLocal(i) {
  const col = i % INTERIOR.cols, row = (i / INTERIOR.cols) | 0;
  const cw = INTERIOR.w / INTERIOR.cols, cd = INTERIOR.d / INTERIOR.rows;
  return {
    x: INTERIOR.cx - INTERIOR.w / 2 + cw * (col + 0.5),
    z: INTERIOR.cz - INTERIOR.d / 2 + cd * (row + 0.5),
  };
}

const v3 = (x, y, z) => ({ x, y, z });
const norm = (v) => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const Camera3D = {
  pos: { x: 0, y: 20, z: -20 },
  yaw: 0,
  pitch: -0.7,
  focal: 900,
  mode: 'car',
  ready: false,
  target: { x: 0, y: 0, z: 0 },

  reset(G) {
    this.ready = false;
    this.update(G, 0.0001);
  },

  update(G, dt) {
    const view = G.view;
    const car = G.car;
    if (!car) return;
    const foot = G.player && G.player.onFoot;
    const mode = G.buildMode
      ? (G.buildTarget === 'interior' ? 'interior' : 'build')
      : foot ? 'foot' : 'car';
    this.mode = mode;
    const carX = car.x * S, carZ = car.y * S;
    let tx, ty, tz, dist, height, yaw;

    if (mode === 'build') {
      tx = carX; ty = 2.2; tz = carZ;
      dist = 8.5; height = 16; yaw = car.angle;
    } else if (mode === 'interior') {
      tx = carX - Math.cos(car.angle) * 0.5; ty = 1.4; tz = carZ - Math.sin(car.angle) * 0.5;
      dist = 7.2; height = 7.4; yaw = car.angle + 1.05;
    } else if (mode === 'foot') {
      const p = G.player;
      tx = p.x * S; ty = 1.5; tz = p.y * S;
      dist = 7.4; height = 4.1; yaw = G.camYaw;
    } else {
      tx = carX + Math.cos(car.angle) * 2.0;
      ty = 1.95;
      tz = carZ + Math.sin(car.angle) * 2.0;
      dist = 16.5; height = 10.6; yaw = car.angle;
    }

    const fx = Math.cos(yaw), fz = Math.sin(yaw);
    const dx = tx - fx * dist;
    const dz = tz - fz * dist;
    const dy = ty + height;

    if (!this.ready) {
      this.pos.x = dx; this.pos.y = dy; this.pos.z = dz;
      this.ready = true;
    } else {
      const k = 1 - Math.exp(-(mode === 'car' ? 7 : mode === 'interior' ? 5 : 9) * Math.max(dt, 0.0001));
      this.pos.x += (dx - this.pos.x) * k;
      this.pos.y += (dy - this.pos.y) * k;
      this.pos.z += (dz - this.pos.z) * k;
    }

    const lx = tx - this.pos.x, ly = ty - this.pos.y, lz = tz - this.pos.z;
    this.yaw = Math.atan2(lz, lx);
    this.pitch = Math.atan2(-ly, Math.hypot(lx, lz));
    this.target.x = tx; this.target.y = ty; this.target.z = tz;
    const fov = 62 * Math.PI / 180;
    this.focal = (view.h / 2) / Math.tan(fov / 2);
  },

  basis() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const forward = { x: cy * cp, y: -sp, z: sy * cp };
    const right = { x: -sy, y: 0, z: cy };
    const up = cross(right, forward);
    return { forward, right, up };
  },

  // camera-space transform of a world point
  toCam(p, b) {
    const dx = p.x - this.pos.x, dy = p.y - this.pos.y, dz = p.z - this.pos.z;
    return {
      x: dx * b.right.x + dy * b.right.y + dz * b.right.z,
      y: dx * b.up.x + dy * b.up.y + dz * b.up.z,
      z: dx * b.forward.x + dy * b.forward.y + dz * b.forward.z,
    };
  },

  projectCam(c, view) {
    const z = Math.max(c.z, 0.0001);
    return {
      x: view.w / 2 + (c.x / z) * this.focal,
      y: view.h / 2 - (c.y / z) * this.focal,
      depth: c.z,
    };
  },

  worldToScreen(G, x, y, z) {
    const b = this._b || this.basis();
    const c = this.toCam(v3(x, y, z), b);
    if (c.z <= 0.05) return null;
    const view = G.view;
    return {
      x: view.w / 2 + (c.x / c.z) * this.focal,
      y: view.h / 2 - (c.y / c.z) * this.focal,
      depth: c.z,
      scale: this.focal / c.z,
    };
  },

  ray(sx, sy, view) {
    const b = this.basis();
    const nx = (sx - view.w / 2) / this.focal;
    const ny = -(sy - view.h / 2) / this.focal;
    const dir = norm({
      x: b.forward.x + b.right.x * nx + b.up.x * ny,
      y: b.forward.y + b.right.y * nx + b.up.y * ny,
      z: b.forward.z + b.right.z * nx + b.up.z * ny,
    });
    return { origin: this.pos, dir };
  },

  // intersect the mouse ray with a horizontal plane -> 2D game point (px)
  screenToPlane(sx, sy, view, planeY) {
    const r = this.ray(sx, sy, view);
    if (Math.abs(r.dir.y) < 1e-5) return null;
    const t = (planeY - r.origin.y) / r.dir.y;
    if (t <= 0) return null;
    const wx = r.origin.x + r.dir.x * t;
    const wz = r.origin.z + r.dir.z * t;
    return { x: wx / S, y: wz / S, wx, wy: planeY, wz };
  },

  // mouse -> cabin interior slot (or -1)
  screenToInterior(G, sx, sy) {
    const p = this.screenToPlane(sx, sy, G.view, INTERIOR.y);
    if (!p) return -1;
    const car = G.car;
    const dx = p.wx - car.x * S, dz = p.wz - car.y * S;
    const c = Math.cos(car.angle), s = Math.sin(car.angle);
    const lx = dx * c + dz * s;
    const lz = -dx * s + dz * c;
    const l = INTERIOR.cx - INTERIOR.w / 2, r = INTERIOR.cx + INTERIOR.w / 2;
    const t = INTERIOR.cz - INTERIOR.d / 2, bo = INTERIOR.cz + INTERIOR.d / 2;
    if (lx < l || lx > r || lz < t || lz > bo) return -1;
    const col = clamp(Math.floor((lx - l) / (INTERIOR.w / INTERIOR.cols)), 0, INTERIOR.cols - 1);
    const row = clamp(Math.floor((lz - t) / (INTERIOR.d / INTERIOR.rows)), 0, INTERIOR.rows - 1);
    return row * INTERIOR.cols + col;
  },

  // mouse -> car roof cell (or -1)
  screenToCell(G, sx, sy) {
    const p = this.screenToPlane(sx, sy, G.view, ROOF_Y);
    if (!p) return -1;
    const car = G.car;
    const dx = p.wx - car.x * S, dz = p.wz - car.y * S;
    const c = Math.cos(car.angle), s = Math.sin(car.angle);
    const lx = dx * c + dz * s;
    const lz = -dx * s + dz * c;
    if (Math.abs(lx) > CAR_HALF_W || Math.abs(lz) > CAR_HALF_D) return -1;
    const col = clamp(Math.floor((lx + CAR_HALF_W) / CELL_UNITS), 0, 5);
    const row = clamp(Math.floor((lz + CAR_HALF_D) / CELL_UNITS), 0, 3);
    return row * 6 + col;
  },
};
