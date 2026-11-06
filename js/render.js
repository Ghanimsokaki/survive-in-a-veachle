// All canvas drawing. The world is top-down; the car is drawn with its
// build grid on the roof so you literally see your house on wheels.
import { BIOMES, MODULE_KINDS } from './data.js';
import { TAU, clamp, mulberry32, hashStr, roundRect } from './util.js';

const patterns = {};

function getPattern(ctx, biome) {
  if (patterns[biome]) return patterns[biome];
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const pal = BIOMES[biome] || BIOMES.java;
  g.fillStyle = pal.ground;
  g.fillRect(0, 0, 256, 256);
  const rng = mulberry32(hashStr(biome));
  for (let i = 0; i < 520; i++) {
    const x = rng() * 256, y = rng() * 256;
    g.globalAlpha = 0.10 + rng() * 0.22;
    g.fillStyle = rng() < 0.55 ? pal.gravel : pal.road;
    const s = 1 + rng() * 3.2;
    g.fillRect(x, y, s, s);
  }
  for (let i = 0; i < 30; i++) {
    g.globalAlpha = 0.025 + rng() * 0.035;
    g.fillStyle = rng() < 0.5 ? pal.accent : pal.gravel;
    g.beginPath();
    g.ellipse(rng() * 256, rng() * 256, 8 + rng() * 26, 6 + rng() * 16, rng() * 3, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 0.18;
  g.strokeStyle = pal.road;
  g.lineWidth = 1;
  for (let i = 0; i < 22; i++) {
    g.beginPath();
    let x = rng() * 256, y = rng() * 256;
    g.moveTo(x, y);
    for (let k = 0; k < 3; k++) { x += (rng() - 0.5) * 60; y += (rng() - 0.5) * 60; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
  patterns[biome] = ctx.createPattern(c, 'repeat');
  return patterns[biome];
}

export function draw(G, ctx, view) {
  const cam = G.camera;
  const z = cam.zoom || 1;
  const w = view.w, h = view.h;
  const pal = BIOMES[G.zone.def.biome] || BIOMES.java;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = pal.ground;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(z, z);
  ctx.translate(-cam.x, -cam.y);

  const left = cam.x - w / 2 / z - 80;
  const right = cam.x + w / 2 / z + 80;
  const top = cam.y - h / 2 / z - 80;
  const bottom = cam.y + h / 2 / z + 80;

  drawGround(G, ctx, pal, left, top, right, bottom);
  if (!G.zone.def.isSea) drawRoads(G, ctx);
  drawDecor(G, ctx, left, top, right, bottom);

  // zone boundary
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 26;
  ctx.setLineDash([60, 26]);
  ctx.strokeRect(0, 0, G.zone.w, G.zone.h);
  ctx.restore();

  for (const lm of G.zone.landmarks || []) drawLandmark(G, ctx, lm);
  for (const r of G.zone.ruins) {
    if (r.x + r.w < left || r.x > right || r.y + r.h < top || r.y > bottom) continue;
    drawRuin(G, ctx, r);
  }
  if (G.zone.dock) drawDock(G, ctx, G.zone.dock);
  drawExit(G, ctx);
  drawCrates(G, ctx, left, top, right, bottom);

  for (const e of G.enemies) drawEnemy(G, ctx, e);
  for (const n of G.zone.ruins) {
    if (n.npc && !n.npc.recruited) drawNPC(G, ctx, n.npc);
  }
  drawDrones(G, ctx);
  drawBullets(G, ctx);
  drawCar(G, ctx);
  drawParticles(G, ctx);
  drawFloaters(G, ctx);

  ctx.restore();
  drawWeather(G, ctx, w, h);
  if (G.zone.def.isSea) drawSeaOverlay(G, ctx, w, h);
}

function drawGround(G, ctx, pal, left, top, right, bottom) {
  const pat = getPattern(ctx, G.zone.def.biome);
  ctx.fillStyle = pat;
  ctx.fillRect(left - 256, top - 256, right - left + 512, bottom - top + 512);
  if (G.zone.def.isSea) {
    // moving swell
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 2;
    const t = G.t;
    const step = 130;
    const y0 = Math.floor(top / step) * step;
    for (let y = y0; y < bottom + step; y += step) {
      const x0 = Math.floor(left / step) * step;
      ctx.beginPath();
      for (let x = x0; x < right + step; x += 26) {
        const yy = y + Math.sin((x * 0.012) + t * 1.3 + y * 0.01) * 5;
        if (x === x0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.globalAlpha = 0.10 + 0.08 * Math.sin(t + y * 0.01);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawRoads(G, ctx) {
  for (const r of G.zone.roads) {
    ctx.fillStyle = '#3d4046';
    ctx.globalAlpha = r.main ? 0.95 : 0.7;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#e8d9a8';
    if (r.main) {
      for (let x = 0; x < r.w; x += 120) {
        ctx.fillRect(x + 20, r.y + r.h / 2 - 3, 62, 6);
      }
    }
    ctx.globalAlpha = 1;
  }
}

function drawDecor(G, ctx, left, top, right, bottom) {
  for (const d of G.zone.decor) {
    if (d.x < left || d.x > right || d.y < top || d.y > bottom) continue;
    if (d.type === 'palm') {
      ctx.save(); ctx.translate(d.x, d.y);
      ctx.fillStyle = '#4b3621'; ctx.fillRect(-2, -4, 4, 10);
      ctx.fillStyle = '#2f6b3d';
      for (let i = 0; i < 5; i++) {
        ctx.rotate(TAU / 5);
        ctx.beginPath(); ctx.ellipse(9, 0, 13 * d.s, 4 * d.s, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    } else if (d.type === 'tree') {
      ctx.save(); ctx.translate(d.x, d.y);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(3, 4, 15 * d.s, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2d5a34';
      ctx.beginPath(); ctx.arc(0, 0, 14 * d.s, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3c7544';
      ctx.beginPath(); ctx.arc(-4 * d.s, -4 * d.s, 9 * d.s, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (d.type === 'bush') {
      ctx.save(); ctx.translate(d.x, d.y);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.arc(2, 3, 9 * d.s, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2f5535';
      ctx.beginPath(); ctx.arc(0, 0, 8.5 * d.s, 0, TAU); ctx.fill();
      ctx.fillStyle = '#42724a';
      ctx.beginPath(); ctx.arc(-3 * d.s, -3 * d.s, 5 * d.s, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (d.type === 'rock') {
      ctx.fillStyle = '#6b7280';
      ctx.beginPath();
      ctx.moveTo(d.x - 11 * d.s, d.y + 6 * d.s);
      ctx.lineTo(d.x - 4 * d.s, d.y - 9 * d.s);
      ctx.lineTo(d.x + 8 * d.s, d.y - 5 * d.s);
      ctx.lineTo(d.x + 12 * d.s, d.y + 6 * d.s);
      ctx.closePath(); ctx.fill();
    } else if (d.type === 'wreck') {
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
      ctx.fillStyle = '#4a3e36';
      roundRect(ctx, -20 * d.s, -9 * d.s, 40 * d.s, 18 * d.s, 4); ctx.fill();
      ctx.fillStyle = '#5e5044';
      ctx.fillRect(-6 * d.s, -7 * d.s, 12 * d.s, 14 * d.s);
      ctx.restore();
    } else if (d.type === 'pole') {
      ctx.strokeStyle = '#5a5048'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(d.x, d.y + 10); ctx.lineTo(d.x, d.y - 26); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(d.x - 12, d.y - 22); ctx.lineTo(d.x + 12, d.y - 22); ctx.stroke();
    } else if (d.type === 'debris') {
      ctx.fillStyle = '#565b61';
      ctx.globalAlpha = 0.8;
      ctx.fillRect(d.x - 6, d.y - 4, 12, 8);
      ctx.globalAlpha = 1;
    } else if (d.type === 'buoy') {
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath(); ctx.arc(d.x, d.y, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = '#b45309';
      ctx.beginPath(); ctx.arc(d.x, d.y - 2, 4, 0, TAU); ctx.fill();
    }
  }
}

function drawLandmark(G, ctx, lm) {
  ctx.save();
  ctx.translate(lm.x, lm.y);
  ctx.rotate(lm.rot || 0);
  ctx.globalAlpha = 0.95;
  const s = lm.s || 1;
  if (lm.t === 'monument') {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(24, 30, 110 * s, 70 * s, 0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5b6470';
    ctx.beginPath(); ctx.arc(0, 0, 76 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath(); ctx.arc(0, 0, 46 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(-16 * s, 12 * s); ctx.lineTo(0, -54 * s); ctx.lineTo(16 * s, 12 * s); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.4)'; ctx.lineWidth = 3; ctx.stroke();
  } else if (lm.t === 'capitol') {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, -150 * s, -70 * s, 300 * s, 150 * s, 16); ctx.fill();
    ctx.fillStyle = '#4b5563';
    roundRect(ctx, -140 * s, -60 * s, 280 * s, 120 * s, 10); ctx.fill();
    ctx.fillStyle = '#94a3b8';
    roundRect(ctx, -140 * s, -60 * s, 280 * s, 22 * s, 8); ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath(); ctx.arc(0, 0, 46 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath(); ctx.arc(-10 * s, -10 * s, 24 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#64748b';
    for (let i = -2; i <= 2; i++) ctx.fillRect(i * 42 * s - 4, 34 * s, 8, 22 * s);
  } else if (lm.t === 'mosque') {
    ctx.fillStyle = '#4b5563';
    roundRect(ctx, -80 * s, -60 * s, 160 * s, 120 * s, 8); ctx.fill();
    ctx.fillStyle = '#8fa8bf';
    ctx.beginPath(); ctx.arc(0, 0, 46 * s, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#dbeafe'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 46 * s, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    [-70, 70].forEach((x) => { ctx.fillRect(x * s - 6, -86 * s, 12 * s, 60 * s); ctx.beginPath(); ctx.arc(x * s, -86 * s, 7 * s, 0, TAU); ctx.fill(); });
  } else if (lm.t === 'tower') {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, -70 * s + 14, -70 * s + 16, 140 * s, 120 * s, 6); ctx.fill();
    ctx.fillStyle = '#374151';
    roundRect(ctx, -70 * s, -70 * s, 140 * s, 120 * s, 6); ctx.fill();
    ctx.fillStyle = '#4b5563';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) ctx.fillRect(-58 * s + i * 30 * s, -58 * s + j * 34 * s, 18 * s, 22 * s);
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-60 * s, -74 * s); ctx.lineTo(60 * s, -74 * s); ctx.stroke();
  } else if (lm.t === 'crane') {
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-60 * s, 40 * s); ctx.lineTo(-20 * s, -80 * s); ctx.lineTo(90 * s, -50 * s); ctx.stroke();
    ctx.fillStyle = '#374151';
    roundRect(ctx, 34 * s, -64 * s, 40 * s, 30 * s, 4); ctx.fill();
    ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(60 * s, -50 * s); ctx.lineTo(60 * s, 10 * s); ctx.stroke();
  } else if (lm.t === 'lighthouse') {
    ctx.fillStyle = '#475569';
    ctx.beginPath(); ctx.arc(0, 0, 42 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath(); ctx.arc(0, 0, 24 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath(); ctx.arc(0, 0, 11 * s, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(0, 0, 12, 0, 0, 190 * s);
    g.addColorStop(0, 'rgba(251,191,36,0.28)');
    g.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 190 * s, -0.5, 0.5); ctx.closePath(); ctx.fill();
  } else if (lm.t === 'market') {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#b45309' : '#7f1d1d';
      roundRect(ctx, -90 * s + i * 46 * s, -26 * s, 40 * s, 48 * s, 4); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-90 * s + i * 46 * s + 4, -22 * s, 32 * s, 6 * s);
    }
  } else if (lm.t === 'shipwreck_big') {
    ctx.fillStyle = 'rgba(10,30,50,0.5)';
    ctx.beginPath(); ctx.ellipse(6, 8, 160 * s, 60 * s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4b5563';
    ctx.beginPath(); ctx.ellipse(0, 0, 150 * s, 50 * s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6b3a2a';
    ctx.fillRect(-40 * s, -34 * s, 90 * s, 68 * s);
    ctx.fillStyle = '#374151';
    ctx.fillRect(-10 * s, -52 * s, 26 * s, 104 * s);
  }
  ctx.restore();
}

function drawRuin(G, ctx, r) {
  ctx.save();
  ctx.translate(r.cx, r.cy);
  if (r.rot) ctx.rotate(r.rot);
  const w = r.w, h = r.h;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(ctx, -w / 2 + 6, -h / 2 + 8, w, h, 8); ctx.fill();

  if (r.wreck) {
    ctx.fillStyle = '#3b3b42';
    roundRect(ctx, -w / 2, -h / 2, w, h, 22); ctx.fill();
    ctx.strokeStyle = '#565660'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#2a2a30';
    ctx.fillRect(-w / 2 + 18, -h / 2 + 16, w - 36, 8);
    ctx.fillStyle = '#6b3a2a';
    ctx.globalAlpha = 0.5;
    ctx.fillRect(-w / 2 + 20, -h / 2 + 30, w * 0.35, h - 50);
    ctx.globalAlpha = 1;
  } else {
    // floor
    const floors = ['#33363c', '#3a352c', '#2f353a', '#383335'];
    ctx.fillStyle = floors[hashStr(r.name) % floors.length];
    roundRect(ctx, -w / 2, -h / 2, w, h, 6); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-w / 2 + 12, -h / 2 + 12, w - 24, h - 24);
    ctx.strokeStyle = '#1f2125'; ctx.lineWidth = 2; ctx.stroke();
    // broken walls
    ctx.strokeStyle = '#6b6257';
    ctx.lineWidth = 9;
    ctx.lineCap = 'butt';
    const rng = mulberry32(hashStr(r.id + r.name));
    const gaps = r.gaps || [false, false, false, false];
    const edges = [
      [-w / 2, -h / 2, w / 2, -h / 2],
      [w / 2, -h / 2, w / 2, h / 2],
      [w / 2, h / 2, -w / 2, h / 2],
      [-w / 2, h / 2, -w / 2, -h / 2],
    ];
    edges.forEach((e, i) => {
      if (gaps[i]) return;
      ctx.beginPath(); ctx.moveTo(e[0], e[1]); ctx.lineTo(e[2], e[3]); ctx.stroke();
    });
    // inner rooms
    ctx.strokeStyle = '#4d4942';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 6); ctx.lineTo(w / 6, -h / 6);
    ctx.moveTo(w / 6, -h / 6); ctx.lineTo(w / 6, h / 2);
    ctx.stroke();
    // rubble
    ctx.fillStyle = '#4b4a45';
    const rubble = r.rubble || [];
    for (const b of rubble) {
      ctx.fillRect(b.x * (w - 40), b.y * (h - 40), b.w, b.h);
    }
  }
  ctx.restore();

  // sign + status
  ctx.save();
  ctx.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  const remaining = r.crates.filter((c) => !c.looted).length;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const label = `${r.name}  ${remaining > 0 ? '· ' + remaining + ' left' : '· EMPTY'}`;
  const tw = ctx.measureText(label).width + 14;
  roundRect(ctx, r.cx - tw / 2, r.y - 24, tw, 20, 6); ctx.fill();
  ctx.fillStyle = remaining > 0 ? '#fbbf24' : '#9ca3af';
  ctx.fillText(label, r.cx, r.y - 10);
  ctx.restore();
}

function drawCrates(G, ctx, left, top, right, bottom) {
  const t = G.t;
  for (const r of G.zone.ruins) {
    if (r.x > right || r.x + r.w < left || r.y > bottom || r.y + r.h < top) continue;
    for (const c of r.crates) {
      if (c.looted) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#4b3a28';
        ctx.fillRect(-9, -7, 18, 14);
        ctx.fillStyle = '#2b2118';
        ctx.fillRect(-7, -5, 14, 4);
        ctx.restore();
        continue;
      }
      const bob = Math.sin(t * 2 + c.bob) * 1.6;
      ctx.save();
      ctx.translate(c.x, c.y + bob);
      ctx.shadowColor = 'rgba(251,191,36,0.8)';
      ctx.shadowBlur = c.big ? 22 : 12;
      ctx.fillStyle = c.big ? '#c084fc' : '#b7791f';
      const s = c.big ? 13 : 10;
      roundRect(ctx, -s, -s, s * 2, s * 2, 3); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(-s + 2, -s + 2, s * 2 - 4, s * 2 - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(-s + 3, -s + 3, s * 2 - 6, 3);
      ctx.restore();
    }
  }
}

function drawExit(G, ctx) {
  const e = G.zone.exit;
  const t = G.t;
  const ready = G.exitReady();
  const color = ready ? '#34d399' : '#f87171';
  ctx.save();
  ctx.translate(e.x, e.y);
  const pulse = 0.5 + 0.5 * Math.sin(t * 2);
  ctx.globalAlpha = 0.16 + pulse * 0.12;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 10]);
  ctx.beginPath(); ctx.arc(0, 0, e.r * 0.8, t * 0.4, t * 0.4 + TAU); ctx.stroke();
  ctx.setLineDash([]);
  // arrow
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(28, 0); ctx.lineTo(-10, -22); ctx.lineTo(-10, -8); ctx.lineTo(-30, -8);
  ctx.lineTo(-30, 8); ctx.lineTo(-10, 8); ctx.lineTo(-10, 22); ctx.closePath();
  ctx.fill();
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e5e7eb';
  ctx.fillText(ready ? 'DEPART →' : 'LOCKED', 0, 48);
  ctx.restore();
}

function drawDock(G, ctx, d) {
  const t = G.t;
  ctx.save();
  ctx.translate(d.x, d.y);
  // water shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(ctx, -110, -78, 232, 150, 14); ctx.fill();
  // pier planks
  ctx.fillStyle = '#6b5844';
  roundRect(ctx, -105, -68, 210, 130, 6); ctx.fill();
  ctx.fillStyle = '#8a7259';
  for (let x = -105; x < 100; x += 20) ctx.fillRect(x, -68, 9, 130);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = -56; y < 60; y += 22) ctx.fillRect(-105, y, 210, 2);
  // moored skiff
  ctx.save();
  ctx.translate(0, 82); ctx.rotate(-0.12);
  ctx.fillStyle = '#4b5563';
  ctx.beginPath(); ctx.ellipse(0, 0, 62, 18, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#6b7280';
  ctx.beginPath(); ctx.ellipse(-10, 0, 26, 10, 0, 0, TAU); ctx.fill();
  ctx.restore();
  // hut
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(ctx, -62, -118, 130, 70, 8); ctx.fill();
  ctx.fillStyle = '#3f4a55';
  roundRect(ctx, -68, -126, 136, 66, 7); ctx.fill();
  ctx.fillStyle = '#2b3440';
  roundRect(ctx, -58, -118, 116, 20, 4); ctx.fill();
  ctx.fillStyle = '#e0a63c';
  roundRect(ctx, -40, -112, 80, 26, 4); ctx.fill();
  ctx.fillStyle = '#1f2937';
  ctx.font = '800 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('DOCK', 0, -93);
  // crates & fuel barrels
  ctx.fillStyle = '#8a6239';
  ctx.fillRect(-88, -30, 18, 18); ctx.fillRect(-88, -8, 18, 18);
  ctx.fillStyle = '#b91c1c';
  ctx.beginPath(); ctx.arc(84, -34, 9, 0, TAU); ctx.fill();
  ctx.fillStyle = '#a16207';
  ctx.beginPath(); ctx.arc(84, -12, 9, 0, TAU); ctx.fill();
  // neon sign
  const glow = 0.55 + 0.35 * Math.sin(t * 2.4);
  ctx.globalAlpha = glow;
  ctx.fillStyle = '#fbbf24';
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText('TRADE · REPAIR · SUPPLIES', 0, 46);
  ctx.globalAlpha = 1;
  const near = G.nearDock();
  if (near) {
    ctx.strokeStyle = 'rgba(251,191,36,' + (0.5 + 0.4 * Math.sin(t * 3)) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, d.r, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ car
export function carCellPos(car, i) {
  const { cols, rows, cell } = car.grid;
  const col = i % cols, row = (i / cols) | 0;
  return {
    x: (col - (cols - 1) / 2) * cell,
    y: (row - (rows - 1) / 2) * cell,
  };
}

function drawCar(G, ctx) {
  const car = G.car;
  const { cols, rows, cell } = car.grid;
  ctx.save();
  ctx.translate(car.x, car.y);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.save();
  ctx.translate(6, 8); ctx.rotate(car.angle);
  roundRect(ctx, -car.w / 2, -car.h / 2, car.w, car.h, 14); ctx.fill();
  ctx.restore();

  ctx.rotate(car.angle);

  // wheels
  const wheel = (wx, wy, steer) => {
    ctx.save(); ctx.translate(wx, wy); ctx.rotate(steer || 0);
    ctx.fillStyle = '#0b0f14';
    roundRect(ctx, -12, -6.5, 24, 13, 4); ctx.fill();
    ctx.fillStyle = '#374151';
    ctx.fillRect(-7, -2.5, 14, 5);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(-2, -5, 4, 10);
    ctx.restore();
  };
  wheel(-car.w * 0.3, -car.h * 0.5 - 2, car.steerFront);
  wheel(-car.w * 0.3, car.h * 0.5 + 2, car.steerFront);
  wheel(car.w * 0.32, -car.h * 0.5 - 2);
  wheel(car.w * 0.32, car.h * 0.5 + 2);

  // raft floats
  if (car.raft) {
    ctx.fillStyle = 'rgba(120, 72, 40, 0.9)';
    for (let i = 0; i < 5; i++) {
      roundRect(ctx, -car.w / 2 - 8, -car.h / 2 + 6 + i * ((car.h - 12) / 5), car.w + 16, 8, 4);
      ctx.fill();
    }
  }

  // body
  const grad = ctx.createLinearGradient(0, -car.h / 2, 0, car.h / 2);
  grad.addColorStop(0, '#54697f');
  grad.addColorStop(0.45, '#39506a');
  grad.addColorStop(1, '#22313f');
  ctx.fillStyle = grad;
  roundRect(ctx, -car.w / 2, -car.h / 2, car.w, car.h, 16); ctx.fill();
  ctx.strokeStyle = car.hull / car.hullMax < 0.35 ? '#ef4444' : '#a8bdd2';
  ctx.lineWidth = 3;
  ctx.stroke();
  // hood + roof rim
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, -car.w / 2 + 4, -car.h / 2 + 4, car.w - 8, 10, 5); ctx.fill();

  // windscreen + headlights
  ctx.fillStyle = '#8fd3ff';
  ctx.globalAlpha = 0.6;
  roundRect(ctx, car.w * 0.32, -car.h * 0.3, 15, car.h * 0.6, 7); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff7cc';
  roundRect(ctx, car.w / 2 - 5, -car.h * 0.35, 4, 11, 2); ctx.fill();
  roundRect(ctx, car.w / 2 - 5, car.h * 0.35 - 11, 4, 11, 2); ctx.fill();
  // side mirrors
  ctx.fillStyle = '#22313f';
  roundRect(ctx, car.w * 0.28, -car.h / 2 - 4, 10, 4, 2); ctx.fill();
  roundRect(ctx, car.w * 0.28, car.h / 2, 10, 4, 2); ctx.fill();

  // deck (the house floor)
  const gw = cols * cell, gh = rows * cell;
  ctx.fillStyle = '#1a2531';
  roundRect(ctx, -gw / 2 - 5, -gh / 2 - 5, gw + 10, gh + 10, 9); ctx.fill();
  ctx.strokeStyle = '#54718c';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-gw / 2, -gh / 2, gw, gh);
  // cell grid
  ctx.strokeStyle = 'rgba(120,160,200,0.12)';
  ctx.lineWidth = 1;
  for (let c = 1; c < cols; c++) {
    ctx.beginPath(); ctx.moveTo(-gw / 2 + c * cell, -gh / 2); ctx.lineTo(-gw / 2 + c * cell, gh / 2); ctx.stroke();
  }
  for (let r = 1; r < rows; r++) {
    ctx.beginPath(); ctx.moveTo(-gw / 2, -gh / 2 + r * cell); ctx.lineTo(gw / 2, -gh / 2 + r * cell); ctx.stroke();
  }

  const turrets = [];
  for (let i = 0; i < car.grid.cells.length; i++) {
    const mod = car.grid.cells[i];
    const p = carCellPos(car, i);
    if (!mod) {
      ctx.fillStyle = 'rgba(10,18,26,0.35)';
      ctx.fillRect(p.x - cell / 2 + 2, p.y - cell / 2 + 2, cell - 4, cell - 4);
      continue;
    }
    drawModule(ctx, mod, p.x, p.y, cell, G);
    if (mod.kind === 'turret') turrets.push({ mod, p });
  }

  // gun barrel from the driver window toward aim
  const aim = G.aimAngle - car.angle;
  ctx.save();
  ctx.rotate(aim);
  ctx.fillStyle = '#0f172a';
  roundRect(ctx, 6, -3.5, 38, 7, 3); ctx.fill();
  ctx.fillStyle = '#64748b';
  roundRect(ctx, 10, -2.5, 30, 5, 2); ctx.fill();
  ctx.fillStyle = G.fireFlash > 0 ? '#fde68a' : '#475569';
  ctx.beginPath(); ctx.arc(45, 0, G.fireFlash > 0 ? 7 : 4, 0, TAU); ctx.fill();
  ctx.restore();

  // turrets rotate independently (draw after body so barrels overhang)
  for (const { mod, p } of turrets) {
    const spec = mod.spec;
    const ang = (mod.aim || 0) - car.angle;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    ctx.fillStyle = '#334155';
    ctx.beginPath(); ctx.arc(0, 0, cell * 0.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = spec.slow ? '#7dd3fc' : spec.chain ? '#c084fc' : '#94a3b8';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    roundRect(ctx, 0, -3, cell * 0.62, 6, 3); ctx.fill();
    if (mod.flash > 0) {
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(cell * 0.62, 0, 5, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // hull bar above the car
  const ratio = clamp(car.hull / car.hullMax, 0, 1);
  ctx.rotate(-car.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, -42, -car.h / 2 - 26, 84, 8, 4); ctx.fill();
  ctx.fillStyle = ratio > 0.5 ? '#34d399' : ratio > 0.25 ? '#fbbf24' : '#ef4444';
  roundRect(ctx, -40, -car.h / 2 - 24, 80 * ratio, 4, 2); ctx.fill();

  ctx.restore();
}

const MODULE_TINT = {
  floor: '#8a6239', deck: '#7a5632', wall: '#8a8f98', storage: '#7c5a35', bed: '#a855f7',
  workbench: '#b45309', advbench: '#0e7490', nanolab: '#6d28d9', solar: '#1e3a8a',
  battery: '#3f3f46', medbay: '#e2e8f0', garden: '#3f6212', antenna: '#1f2937',
  dronebay: '#312e81', spikes: '#4b5563', shield: '#64748b', trophy: '#a16207',
  kitchen: '#7c2d12', lantern: '#b45309',
};

function drawModule(ctx, mod, x, y, cell, G) {
  const k = mod.kind;
  const half = cell / 2 - 1.5;
  ctx.save();
  ctx.translate(x, y);
  if (MODULE_TINT[k]) {
    ctx.fillStyle = MODULE_TINT[k];
    roundRect(ctx, -half, -half, cell - 3, cell - 3, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  switch (k) {
    case 'floor':
      ctx.fillStyle = mod.color || '#8a6239';
      ctx.fillRect(-half, -half, cell - 2, cell - 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(-half, -half + i * (cell / 3)); ctx.lineTo(half, -half + i * (cell / 3)); ctx.stroke();
      }
      break;
    case 'wall':
      ctx.fillStyle = '#8a8f98';
      roundRect(ctx, -half, -half, cell - 2, cell - 2, 2); ctx.fill();
      ctx.fillStyle = '#b7bec7';
      roundRect(ctx, -half + 2, -half + 2, cell - 6, cell / 2 - 3, 2); ctx.fill();
      break;
    case 'storage':
      ctx.fillStyle = '#7c5a35';
      roundRect(ctx, -half, -half, cell - 2, cell - 2, 3); ctx.fill();
      ctx.fillStyle = '#c99a58';
      ctx.fillRect(-half + 3, -2, cell - 8, 4);
      break;
    case 'bed':
      ctx.fillStyle = '#d8b4fe';
      roundRect(ctx, -half, -half, cell - 2, cell - 2, 3); ctx.fill();
      ctx.fillStyle = '#f5f3ff';
      ctx.fillRect(-half + 2, -half + 2, cell - 6, 5);
      break;
    case 'solar':
      ctx.fillStyle = '#1e3a8a';
      roundRect(ctx, -half, -half, cell - 2, cell - 2, 2); ctx.fill();
      ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(-half + i * (cell / 3), -half); ctx.lineTo(-half + i * (cell / 3), half); ctx.stroke();
      }
      break;
    case 'battery':
      ctx.fillStyle = '#3f3f46';
      roundRect(ctx, -half, -half, cell - 2, cell - 2, 3); ctx.fill();
      ctx.fillStyle = '#facc15';
      for (let i = 0; i < 3; i++) ctx.fillRect(-half + 3, -half + 3 + i * 5, cell - 8, 3);
      break;
    case 'medbay':
      ctx.fillStyle = '#f1f5f9';
      roundRect(ctx, -half, -half, cell - 2, cell - 2, 3); ctx.fill();
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-2, -half + 4, 4, cell - 10);
      ctx.fillRect(-half + 4, -2, cell - 10, 4);
      break;
    case 'garden':
      ctx.fillStyle = '#3f6212';
      roundRect(ctx, -half, -half, cell - 2, cell - 2, 3); ctx.fill();
      ctx.fillStyle = '#84cc16';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(-half + 4 + (i % 2) * (cell - 9), -half + 4 + Math.floor(i / 2) * (cell - 9), 2.6, 0, TAU);
        ctx.fill();
      }
      break;
    case 'antenna':
      ctx.fillStyle = '#1f2937';
      roundRect(ctx, -half, -half, cell - 2, cell - 2, 3); ctx.fill();
      ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, cell * 0.28, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -cell * 0.4); ctx.stroke();
      break;
    case 'dronebay':
      ctx.fillStyle = '#312e81';
      roundRect(ctx, -half, -half, cell - 2, cell - 2, 3); ctx.fill();
      ctx.strokeStyle = '#a5b4fc'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, cell * 0.24, 0, TAU); ctx.stroke();
      break;
    case 'spikes':
      ctx.fillStyle = '#4b5563';
      ctx.fillRect(-half, -half, cell - 2, cell - 2);
      ctx.fillStyle = '#d1d5db';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-half + 3 + i * 6, half - 2);
        ctx.lineTo(-half + 6 + i * 6, -half + 3);
        ctx.lineTo(-half + 9 + i * 6, half - 2);
        ctx.fill();
      }
      break;
    case 'shield':
      ctx.fillStyle = '#64748b';
      roundRect(ctx, -half, -half, cell - 2, cell - 2, 2); ctx.fill();
      ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-4, -half + 4); ctx.lineTo(4, -half + 4); ctx.lineTo(0, half - 4); ctx.closePath(); ctx.stroke();
      break;
    default: {
      const spec = mod.spec || {};
      const kindDef = MODULE_KINDS[k] || {};
      const base = spec.color || kindDef.color || '#475569';
      ctx.fillStyle = base;
      roundRect(ctx, -half, -half, cell - 2, cell - 2, 3); ctx.fill();
      ctx.font = `${Math.round(cell * 0.68)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(spec.icon || kindDef.icon || '🏠', 0, 1);
      break;
    }
  }
  if (mod.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,80,80,${mod.hitFlash})`;
    ctx.fillRect(-half, -half, cell - 2, cell - 2);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ entities
function drawEnemy(G, ctx, e) {
  const def = e.def;
  ctx.save();
  ctx.translate(e.x, e.y);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(3, 5, def.r * 0.95, def.r * 0.7, 0, 0, TAU); ctx.fill();

  if (def.vehicle) {
    ctx.rotate(e.angle);
    ctx.fillStyle = def.color;
    roundRect(ctx, -def.r * 1.35, -def.r * 0.75, def.r * 2.7, def.r * 1.5, 7); ctx.fill();
    ctx.fillStyle = '#111827';
    roundRect(ctx, -def.r * 0.6, -def.r * 0.5, def.r * 1.2, def.r, 4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    roundRect(ctx, def.r * 0.5, -def.r * 0.45, def.r * 0.5, def.r * 0.9, 3); ctx.fill();
    ctx.rotate(-e.angle);
  } else if (def.flyer) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0, 18, def.r * 0.8, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(0, 0, def.r * 0.7, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-def.r, -4); ctx.lineTo(def.r, -4); ctx.stroke();
    ctx.beginPath(); ctx.arc(-def.r, -4, 5, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(def.r, -4, 5, 0, TAU); ctx.stroke();
  } else {
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(0, 0, def.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = `${Math.round(def.r * 1.1)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, 0, 1);
  }
  // barrel / facing
  if (!def.melee) {
    ctx.save();
    ctx.rotate(e.angle || 0);
    ctx.fillStyle = '#0f172a';
    roundRect(ctx, def.r * 0.55, -2.6, def.r * (def.vehicle || def.flyer ? 1.1 : 0.95), 5.2, 2); ctx.fill();
    ctx.restore();
  }
  // hp bar
  if (e.hp < e.maxHp) {
    const w = Math.max(26, def.r * 2.2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-w / 2, -def.r - 12, w, 4);
    ctx.fillStyle = def.boss ? '#facc15' : '#ef4444';
    ctx.fillRect(-w / 2, -def.r - 12, w * clamp(e.hp / e.maxHp, 0, 1), 4);
  }
  if (e.stun > 0) {
    ctx.strokeStyle = 'rgba(125,211,252,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, def.r + 5, 0, TAU); ctx.stroke();
  }
  if (e.boss) {
    ctx.fillStyle = '#facc15';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GENERAL', 0, -def.r - 18);
  }
  ctx.restore();
}

function drawNPC(G, ctx, npc) {
  const t = G.t;
  ctx.save();
  ctx.translate(npc.x, npc.y + Math.sin(t * 2 + npc.x) * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 12, 12, 5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(52,211,153,0.16)';
  ctx.beginPath(); ctx.arc(0, 0, 26 + Math.sin(t * 3) * 3, 0, TAU); ctx.fill();
  ctx.fillStyle = '#0f766e';
  ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#6ee7b7'; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = '15px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🧍', 0, 1);
  // marker
  const bob = Math.sin(t * 4) * 3;
  ctx.fillStyle = '#34d399';
  ctx.beginPath();
  ctx.moveTo(0, -30 + bob); ctx.lineTo(-6, -40 + bob); ctx.lineTo(6, -40 + bob);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d1fae5';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText('SURVIVOR', 0, -47 + bob);
  ctx.restore();
}

function drawDrones(G, ctx) {
  for (const d of G.drones) {
    if (!d.deployed) continue;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(3, 14, 9, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0ea5e9';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#bae6fd'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#f0f9ff';
    ctx.fillRect(-13, -2, 6, 4);
    ctx.fillRect(7, -2, 6, 4);
    ctx.font = '9px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.spec.icon || '🛸', 0, 1);
    if (d.hp < d.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(-10, -16, 20, 3);
      ctx.fillStyle = '#38bdf8'; ctx.fillRect(-10, -16, 20 * clamp(d.hp / d.maxHp, 0, 1), 3);
    }
    ctx.restore();
  }
}

function drawBullets(G, ctx) {
  for (const b of G.bullets) {
    const col = b.friendly ? (b.turret ? '#67e8f9' : '#fde68a') : '#fca5a5';
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = b.big ? 5 : 2.4;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
    ctx.stroke();
    if (b.big) {
      ctx.fillStyle = 'rgba(251,146,60,0.7)';
      ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

function drawParticles(G, ctx) {
  for (const p of G.particles) {
    const a = clamp(p.life / p.maxlife, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    if (p.smoke) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (2 - a), 0, TAU); ctx.fill();
    } else {
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;
}

function drawFloaters(G, ctx) {
  ctx.textAlign = 'center';
  for (const f of G.floaters) {
    const a = clamp(f.life / f.maxlife, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = `700 ${f.size || 13}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function drawWeather(G, ctx, w, h) {
  const biome = G.zone.def.biome;
  if (biome !== 'sea') {
    // soft vignette for land zones
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  // rain during the ocean legs
  const stormy = G.zone.def.id === 'bengal' || G.zone.def.id === 'atlantic';
  if (!stormy) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(200,230,255,0.35)';
  ctx.lineWidth = 1;
  const t = G.t * 900;
  for (let i = 0; i < 140; i++) {
    const x = ((i * 977 + t * 0.8) % (w + 200)) - 100;
    const y = ((i * 613 + t) % (h + 200)) - 100;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 6, y + 18);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(15,23,42,0.18)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawSeaOverlay(G, ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,20,40,0)');
  g.addColorStop(1, 'rgba(0,15,35,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// ------------------------------------------------------------------ minimap
export function drawMinimap(G, mctx, mw, mh) {
  const z = G.zone;
  mctx.clearRect(0, 0, mw, mh);
  mctx.fillStyle = G.zone.def.isSea ? '#0b2236' : '#242a26';
  mctx.fillRect(0, 0, mw, mh);
  const sx = mw / z.w, sy = mh / z.h;
  const s = Math.min(sx, sy);
  const ox = (mw - z.w * s) / 2, oy = (mh - z.h * s) / 2;

  mctx.fillStyle = 'rgba(255,255,255,0.08)';
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
  mctx.fillStyle = G.exitReady() ? '#34d399' : '#f87171';
  mctx.beginPath();
  mctx.arc(ox + z.exit.x * s, oy + z.exit.y * s, 4, 0, TAU);
  mctx.fill();

  for (const e of G.enemies) {
    mctx.fillStyle = e.def.boss ? '#facc15' : '#ef4444';
    mctx.fillRect(ox + e.x * s - 1.5, oy + e.y * s - 1.5, 3, 3);
  }
  for (const r of z.ruins) {
    if (r.npc && !r.npc.recruited) {
      mctx.fillStyle = '#34d399';
      mctx.fillRect(ox + r.npc.x * s - 2, oy + r.npc.y * s - 2, 4, 4);
    }
  }
  // car
  mctx.save();
  mctx.translate(ox + G.car.x * s, oy + G.car.y * s);
  mctx.rotate(G.car.angle);
  mctx.fillStyle = '#f8fafc';
  mctx.beginPath();
  mctx.moveTo(6, 0); mctx.lineTo(-4, -4); mctx.lineTo(-4, 4);
  mctx.closePath(); mctx.fill();
  mctx.restore();

  mctx.strokeStyle = 'rgba(255,255,255,0.22)';
  mctx.lineWidth = 1;
  mctx.strokeRect(ox + 0.5, oy + 0.5, z.w * s - 1, z.h * s - 1);
}
