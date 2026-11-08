// Tiny low-poly geometry kit for the software 3D renderer.
// Faces are plain objects: { p: [{x,y,z}...], c: '#rrggbb', a?: alpha, ds?: doubleSided }

export function addFace(out, pts, color, alpha) {
  out.push({ p: pts, c: color, a: alpha });
}

function rotPt(x, y, z, rx, ry, rz) {
  let nx = x, ny = y, nz = z;
  if (rz) {
    const c = Math.cos(rz), s = Math.sin(rz);
    const tx = nx * c - ny * s;
    const ty = nx * s + ny * c;
    nx = tx; ny = ty;
  }
  if (rx) {
    const c = Math.cos(rx), s = Math.sin(rx);
    const ty = ny * c - nz * s;
    const tz = ny * s + nz * c;
    ny = ty; nz = tz;
  }
  if (ry) {
    // Same sense as the layout transform used everywhere else
    // (carBox / quad / prismZ): world = (lx·cos − lz·sin, lx·sin + lz·cos).
    // Getting this backwards made every yawed box spin the other way round,
    // so a turning vehicle looked sheared apart.
    const c = Math.cos(ry), s = Math.sin(ry);
    const tx = nx * c - nz * s;
    const tz = nx * s + nz * c;
    nx = tx; nz = tz;
  }
  return [nx, ny, nz];
}

// Axis aligned box (optionally rotated about its own centre).
export function box(out, x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0, opts = {}) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const local = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ];
  const v = local.map(([lx, ly, lz]) => {
    const [rx2, ry2, rz2] = rotPt(lx, ly, lz, rx, ry, rz);
    return { x: x + rx2, y: y + ry2, z: z + rz2 };
  });
  const F = [
    [4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6],
    [0, 4, 7, 3], [7, 6, 2, 3], [0, 1, 5, 4],
  ];
  const alpha = opts.alpha;
  for (let fi = 0; fi < F.length; fi++) {
    if (opts.skipTop && fi === 4) continue;
    if (opts.skipBottom && fi === 5) continue;
    const f = F[fi];
    out.push({
      p: [v[f[0]], v[f[1]], v[f[2]], v[f[3]]],
      c: color,
      a: alpha,
      ds: opts.ds,
    });
  }
  return v;
}

// A box that hangs from a joint (used for limbs). Rotation happens around the
// joint, not the centre.
export function limbBox(out, px, py, pz, yaw, jx, jy, jz, len, thick, swing, color, opts = {}) {
  const cx = jx + Math.sin(swing) * (len / 2);
  const cy = jy - Math.cos(swing) * (len / 2);
  const cz = jz;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const wx = px + cx * c - cz * s;
  const wz = pz + cx * s + cz * c;
  return box(out, wx, py + cy, wz, thick, len, thick, color, yaw, 0, swing, opts);
}

export function prismZ(out, x, y, z, radius, len, color, sides = 8, ry = 0, opts = {}) {
  const h = len / 2;
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  const c = Math.cos(ry), s = Math.sin(ry);
  const tp = (lx, ly, lz) => {
    const wx = x + lx * c - lz * s;
    const wz = z + lx * s + lz * c;
    return { x: wx, y: y + ly, z: wz };
  };
  for (let i = 0; i < sides; i++) {
    const a = ring[i], b = ring[(i + 1) % sides];
    out.push({
      p: [tp(a[0], a[1], -h), tp(b[0], b[1], -h), tp(b[0], b[1], h), tp(a[0], a[1], h)],
      c: color, a: opts.alpha, ds: opts.ds,
    });
  }
  // caps
  const capA = ring.map((p) => tp(p[0], p[1], -h)).reverse();
  const capB = ring.map((p) => tp(p[0], p[1], h));
  out.push({ p: capA, c: color, a: opts.alpha });
  out.push({ p: capB, c: color, a: opts.alpha });
}

export function prismY(out, x, y, z, radius, height, color, sides = 8, opts = {}) {
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  const y0 = y, y1 = y + height;
  for (let i = 0; i < sides; i++) {
    const a = ring[i], b = ring[(i + 1) % sides];
    out.push({
      p: [
        { x: x + a[0], y: y0, z: z + a[1] },
        { x: x + b[0], y: y0, z: z + b[1] },
        { x: x + b[0], y: y1, z: z + b[1] },
        { x: x + a[0], y: y1, z: z + a[1] },
      ],
      c: color, a: opts.alpha,
    });
  }
  out.push({ p: ring.map((p) => ({ x: x + p[0], y: y1, z: z + p[1] })), c: color, a: opts.alpha });
}

export function cone(out, x, y, z, radius, height, color, sides = 6, ry = 0, opts = {}) {
  const apex = { x, y: y + height, z };
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push({ x: x + Math.cos(a) * radius, y, z: z + Math.sin(a) * radius });
  }
  for (let i = 0; i < sides; i++) {
    out.push({ p: [ring[i], ring[(i + 1) % sides], apex], c: color, a: opts.alpha });
  }
}

export function quad(out, x, y, z, w, d, color, ry = 0, alpha) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const hw = w / 2, hd = d / 2;
  const pt = (lx, lz) => ({ x: x + lx * c - lz * s, y, z: z + lx * s + lz * c });
  out.push({
    p: [pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd)],
    c: color,
    a: alpha,
    ds: true,
  });
}

export function disc(out, x, y, z, radius, color, sides = 10, alpha) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    pts.push({ x: x + Math.cos(a) * radius, y, z: z + Math.sin(a) * radius });
  }
  out.push({ p: pts, c: color, a: alpha, ds: true });
}

export function ring(out, x, y, z, radius, width, color, sides = 14, alpha = 0.5) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const p = (a, r) => ({ x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r });
    out.push({
      p: [p(a0, radius), p(a1, radius), p(a1, radius + width), p(a0, radius + width)],
      c: color, a: alpha, ds: true,
    });
  }
}
