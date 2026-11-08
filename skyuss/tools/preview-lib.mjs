// Shared offscreen rasteriser for the SKYUSS preview tools.
// jsdom has no WebGL, so this draws the real Three.js object graph with a tiny
// painter's-algorithm renderer on @napi-rs/canvas. Slow and flat-shaded, but it
// is enough to actually look at a model outside a browser.
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as THREE from 'three';

// --------------------------------------------------------------- rasteriser
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function hashHue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function trianglesOf(root, colorByGroup = false, onlyNames = null) {
  const tris = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (o.visible === false) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    if (!pos) return;
    const idx = g.index;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mat) return;
    if (onlyNames) {
      const names = [];
      let p = o;
      while (p && p !== root) { if (p.name) names.push(p.name); p = p.parent; }
      if (!names.some((n) => n.includes(onlyNames))) return;
    }
    let color = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
    if (colorByGroup) {
      // paint every named ancestor chain so the build can be debugged by eye
      const names = [];
      let p = o;
      while (p && p !== root) { if (p.name) names.push(p.name); p = p.parent; }
      const key = names[0] || o.type;
      color = new THREE.Color().setHSL((hashHue(key) % 360) / 360, 0.62, 0.55);
    }
    if (mat.emissive && mat.emissiveIntensity) {
      color.lerp(mat.emissive, Math.min(1, 0.35 * mat.emissiveIntensity));
    }
    const glowMat = !mat.isMeshStandardMaterial;
    const alpha = mat.transparent ? (mat.opacity ?? 1) : 1;
    const m = o.matrixWorld;
    const colAttr = g.attributes.color || null;
    const a = v3(), b = v3(), c = v3();
    const ca = new THREE.Color(), cb = new THREE.Color(), cc = new THREE.Color();
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const ia = idx ? idx.getX(i) : i;
      const ib = idx ? idx.getX(i + 1) : i + 1;
      const ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(m);
      b.fromBufferAttribute(pos, ib).applyMatrix4(m);
      c.fromBufferAttribute(pos, ic).applyMatrix4(m);
      let faceColor = color;
      if (colAttr) {
        // vertex colours (rock strata, moss) — average the three corners
        ca.fromBufferAttribute(colAttr, ia);
        cb.fromBufferAttribute(colAttr, ib);
        cc.fromBufferAttribute(colAttr, ic);
        faceColor = color.clone().multiply(ca.clone().add(cb).add(cc).multiplyScalar(1 / 3));
      }
      tris.push({ a: a.clone(), b: b.clone(), c: c.clone(), color: faceColor, glow: glowMat, alpha });
    }
  });
  return tris;
}

function cameraBasis(eye, target, up = v3(0, 1, 0)) {
  const fwd = target.clone().sub(eye).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const trueUp = new THREE.Vector3().crossVectors(right, fwd).normalize();
  return { eye, fwd, right, up: trueUp };
}

function renderView(canvas, tris, eye, target, opts = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const fov = opts.fov ?? 38;
  const focal = (H / 2) / Math.tan((fov * Math.PI) / 360);
  const cam = cameraBasis(eye, target);
  const light = (opts.light || v3(-0.5, 0.8, 0.6)).clone().normalize();
  const light2 = v3(0.7, 0.2, -0.8).normalize();
  const light3 = v3(0.15, -0.35, 1).normalize();

  const cx = W / 2, cy = H / 2 + (opts.offsetY ?? 0);
  const project = (p) => {
    const d = p.clone().sub(cam.eye);
    const x = d.dot(cam.right);
    const y = d.dot(cam.up);
    const z = d.dot(cam.fwd);
    if (z <= 0.1) return null;
    return { x: cx + (x * focal) / z, y: cy - (y * focal) / z, z };
  };

  const faces = [];
  const n = v3();
  const viewDir = v3();
  for (const t of tris) {
    const p0 = project(t.a), p1 = project(t.b), p2 = project(t.c);
    if (!p0 || !p1 || !p2) continue;
    n.subVectors(t.b, t.a).cross(v3().subVectors(t.c, t.a));
    const len = n.length() || 1;
    n.multiplyScalar(1 / len);
    viewDir.copy(t.a).sub(cam.eye).normalize();
    const facing = n.dot(viewDir);
    if (facing > 0.08 && !t.glow) continue; // backface cull solid hull only
    // winding is not guaranteed across hand-built geometry, so light both sides.
    // Three lights + a sky term: enough that no hull panel reads pure black.
    const key = Math.abs(n.dot(light));
    const fill = Math.abs(n.dot(light2));
    const bounce = Math.abs(n.dot(light3));
    const rim = Math.max(0, 1 - Math.abs(facing)) * 0.22;
    const shade = 0.5 + key * 0.5 + fill * 0.2 + bounce * 0.22 + Math.abs(n.y) * 0.1 + rim;
    const col = t.color.clone();
    if (t.glow) col.lerp(new THREE.Color(0xffffff), 0.18);
    const r = Math.min(255, Math.round(col.r * 255 * shade));
    const g = Math.min(255, Math.round(col.g * 255 * shade));
    const b = Math.min(255, Math.round(col.b * 255 * shade));
    faces.push({ p0, p1, p2, z: (p0.z + p1.z + p2.z) / 3, fill: `rgb(${r},${g},${b})`, alpha: t.alpha });
  }
  faces.sort((u, w) => w.z - u.z);
  for (const f of faces) {
    ctx.beginPath();
    ctx.moveTo(f.p0.x, f.p0.y);
    ctx.lineTo(f.p1.x, f.p1.y);
    ctx.lineTo(f.p2.x, f.p2.y);
    ctx.closePath();
    ctx.globalAlpha = Math.max(0.15, f.alpha);
    ctx.fillStyle = f.fill;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  return faces.length;
}

function backdrop(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#08131f');
  g.addColorStop(0.55, '#0d2233');
  g.addColorStop(1, '#050a12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // stars
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W, y = rnd() * H * 0.85;
    ctx.globalAlpha = 0.15 + rnd() * 0.6;
    ctx.fillStyle = '#cfe9ff';
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  ctx.globalAlpha = 1;
}

function label(ctx, text, x, y, sub) {
  ctx.fillStyle = 'rgba(190,225,245,0.92)';
  ctx.font = '600 20px system-ui, sans-serif';
  ctx.fillText(text, x, y);
  if (sub) {
    ctx.fillStyle = 'rgba(150,195,220,0.7)';
    ctx.font = '400 14px system-ui, sans-serif';
    ctx.fillText(sub, x, y + 22);
  }
}



/** Compose up to four camera angles of the same triangle soup into one PNG. */
function shot(path, panels) {
  const W = 1400, H = 900;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  backdrop(ctx, W, H);
  const cols = panels.length === 1 ? 1 : 2;
  const rows = Math.ceil(panels.length / cols);
  const cw = W / cols, ch = H / rows;
  let total = 0;
  panels.forEach((p, i) => {
    const sub = createCanvas(cw, ch);
    const sctx = sub.getContext('2d');
    const g = sctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, '#0a1826');
    g.addColorStop(1, '#060d16');
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, cw, ch);
    const dist = p.dist ?? 34;
    const eye = v3(
      Math.sin(p.yaw ?? 0.9) * dist,
      (p.elev ?? 0.42) * dist,
      Math.cos(p.yaw ?? 0.9) * dist,
    ).add(v3(0, p.focusY ?? 0, 0));
    total += renderView(sub, p.tris, eye, v3(0, p.focusY ?? 0, 0), { fov: p.fov ?? 40, offsetY: 10 });
    ctx.drawImage(sub, (i % cols) * cw, Math.floor(i / cols) * ch);
    label(ctx, p.title, (i % cols) * cw + 22, Math.floor(i / cols) * ch + 34, p.sub);
    ctx.strokeStyle = 'rgba(120,180,215,0.18)';
    ctx.strokeRect((i % cols) * cw + 0.5, Math.floor(i / cols) * ch + 0.5, cw - 1, ch - 1);
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canvas.toBuffer('image/png'));
  return { path, tris: total };
}

export { THREE, trianglesOf, renderView, backdrop, label, shot, v3 };
