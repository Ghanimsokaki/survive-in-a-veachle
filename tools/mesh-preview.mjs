// Dev tool: render an imported mesh on its own so we can eyeball orientation,
// colours and face count before wiring it into the game.
//   node tools/mesh-preview.mjs
import fs from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { LOCOMOTIVE_MESH } from '../js/models/locomotive.js';

const W = 900, H = 620;

function render(faces, { yaw = -0.7, pitch = 0.42, dist = 16, target = [0, 1.4, 0] } = {}) {
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#1b2733');
  sky.addColorStop(1, '#0d141b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  const focal = (H / 2) / Math.tan((62 * Math.PI / 180) / 2);
  const cy = Math.cos(pitch), sy = Math.sin(pitch);
  const cx = Math.cos(yaw), sx = Math.sin(yaw);
  const cam = [
    target[0] + Math.cos(yaw) * Math.cos(pitch) * dist,
    target[1] + Math.sin(pitch) * dist,
    target[2] + Math.sin(yaw) * Math.cos(pitch) * dist,
  ];
  const forward = [target[0] - cam[0], target[1] - cam[1], target[2] - cam[2]];
  const fl = Math.hypot(...forward);
  forward[0] /= fl; forward[1] /= fl; forward[2] /= fl;
  const right = [-forward[2], 0, forward[0]];
  const rl = Math.hypot(...right) || 1;
  right[0] /= rl; right[1] /= rl; right[2] /= rl;
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const light = [0.42, 0.78, -0.46];

  const project = (p) => {
    const d = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
    const z = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2];
    const x = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
    const y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    if (z < 0.05) return null;
    return { x: W / 2 + (x / z) * focal, y: H / 2 - (y / z) * focal, z };
  };

  const list = [];
  for (const [tri, colour] of faces) {
    const pts = tri.map(project);
    if (pts.some((p) => !p) || pts.length < 3) continue;
    const ax = tri[1][0] - tri[0][0], ay = tri[1][1] - tri[0][1], az = tri[1][2] - tri[0][2];
    const bx = tri[2][0] - tri[0][0], by = tri[2][1] - tri[0][1], bz = tri[2][2] - tri[0][2];
    const n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    const nl = Math.hypot(...n) || 1;
    n[0] /= nl; n[1] /= nl; n[2] /= nl;
    const view = [cam[0] - tri[0][0], cam[1] - tri[0][1], cam[2] - tri[0][2]];
    if (n[0] * view[0] + n[1] * view[1] + n[2] * view[2] <= 0) continue;
    const nd = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
    const shade = 0.55 + 0.5 * nd;
    const depth = pts.reduce((acc, p) => acc + p.z, 0) / pts.length;
    list.push({ pts, colour, shade, depth });
  }
  list.sort((a, b) => b.depth - a.depth);
  for (const f of list) {
    const r = parseInt(f.colour.slice(1, 3), 16) * f.shade;
    const g = parseInt(f.colour.slice(3, 5), 16) * f.shade;
    const b = parseInt(f.colour.slice(5, 7), 16) * f.shade;
    ctx.fillStyle = `rgb(${Math.min(255, r) | 0},${Math.min(255, g) | 0},${Math.min(255, b) | 0})`;
    ctx.beginPath();
    ctx.moveTo(f.pts[0].x, f.pts[0].y);
    for (let i = 1; i < f.pts.length; i++) ctx.lineTo(f.pts[i].x, f.pts[i].y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillText(`${list.length} of ${faces.length} faces drawn · yaw ${yaw}`, 16, H - 16);
  void cy; void sy; void cx; void sx;
  return cv;
}

const out = new URL('../shots/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(new URL('mesh-loco.png', out), render(LOCOMOTIVE_MESH, { yaw: -0.7, dist: 11 }).toBuffer('image/png'));
fs.writeFileSync(new URL('mesh-loco-b.png', out), render(LOCOMOTIVE_MESH, { yaw: 2.3, pitch: 0.3, dist: 10 }).toBuffer('image/png'));
console.log('wrote shots/mesh-loco.png, shots/mesh-loco-b.png');
