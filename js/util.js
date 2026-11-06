// Small shared helpers: math, random, formatting, sound.
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function rand(a = 1, b) {
  if (b === undefined) { b = a; a = 0; }
  return a + Math.random() * (b - a);
}
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;

export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
export const dist2 = (x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1;
  return dx * dx + dy * dy;
};
export const angTo = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);

export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const angLerp = (a, b, t) => a + angDiff(a, b) * t;

export function fmt(n) {
  n = Math.round(n);
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 10000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

// Deterministic PRNG (mulberry32)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function roman(n) {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] || String(n);
}

// Circular body (entity) vs rotated car rectangle collision.
export function circleInBox(px, py, r, cx, cy, ang, hw, hh) {
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const dx = px - cx, dy = py - cy;
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  const qx = clamp(lx, -hw, hw);
  const qy = clamp(ly, -hh, hh);
  const ddx = lx - qx, ddy = ly - qy;
  return ddx * ddx + ddy * ddy <= r * r;
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Tiny synthesized sound effects (no external assets).
export const Sfx = {
  ctx: null,
  muted: false,
  master: null,
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch (e) { /* audio is optional */ }
  },
  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },
  tone(freq = 440, dur = 0.08, type = 'square', vol = 0.12, slide = 0) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t0 = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  },
  shoot() { this.tone(320, 0.05, 'square', 0.05, -160); },
  turret() { this.tone(520, 0.045, 'sawtooth', 0.035, -220); },
  hit() { this.tone(140, 0.07, 'triangle', 0.09, -60); },
  loot() { this.tone(620, 0.07, 'sine', 0.09, 240); setTimeout(() => this.tone(880, 0.08, 'sine', 0.07), 60); },
  craft() { this.tone(400, 0.09, 'triangle', 0.08, 200); setTimeout(() => this.tone(700, 0.12, 'sine', 0.07), 90); },
  boom() { this.tone(90, 0.28, 'sawtooth', 0.16, -55); },
  error() { this.tone(180, 0.12, 'square', 0.06, -40); },
  click() { this.tone(500, 0.03, 'square', 0.04); },
  travel() { [330, 440, 550, 660].forEach((f, i) => setTimeout(() => this.tone(f, 0.14, 'sine', 0.06), i * 110)); },
};
