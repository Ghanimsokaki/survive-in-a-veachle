// SKYUSS interface: HUD wiring, refit/fortress panels, toasts and the radar.
// Pure DOM — no Three.js here.

import { tierRows } from './enterprise.js';
import { FORT, FORT_PIECES, PIECE_ORDER } from './config.js';

const $ = (id) => document.getElementById(id);

export const UI = {
  el: {},
  handlers: {},
  panel: null,
  piece: 'platform',
  _last: {},
  toastSeq: 0,
  bannerTimer: 0,

  init(handlers = {}) {
    this.handlers = handlers;
    this.el = {
      hud: $('hud'), menu: $('menu'), panelLayer: $('panelLayer'),
      toastBox: $('toasts'), banner: $('banner'), bannerTitle: $('bannerTitle'), bannerText: $('bannerText'),
      objective: $('objective'), siegeLine: $('siegeLine'), sectorLine: $('sectorLine'), prompt: $('prompt'),
      hullFill: $('hullFill'), hullText: $('hullText'),
      shieldFill: $('shieldFill'), shieldText: $('shieldText'),
      energyFill: $('energyFill'), energyText: $('energyText'),
      speedText: $('speedText'), warpLine: $('warpLine'),
      resTi: $('resTi'), resDi: $('resDi'), resMx: $('resMx'),
      cargoFill: $('cargoFill'), cargoText: $('cargoText'),
      lockRing: $('lockRing'), abyssWarn: $('abyssWarn'), reticle: $('reticle'),
      radar: $('radar'), tierRows: $('tierRows'), pieceGrid: $('pieceGrid'), fortStats: $('fortStats'),
      dmgFlash: $('dmgFlash'), soundIcon: $('soundIcon'),
      styleChip: $('styleChip'), aimChip: $('aimChip'), touchChip: $('touchChip'), aimMode: $('aimMode'),
      hotbar: $('hotbar'), fatal: $('fatal'),
    };
    this.rctx = this.el.radar.getContext('2d');

    // hotbar + panel buttons
    document.addEventListener('pointerdown', (e) => {
      const hb = e.target.closest && e.target.closest('[data-act]');
      if (hb) { handlers.action && handlers.action(hb.dataset.act); return; }
      const act = e.target.closest && e.target.closest('[data-action]');
      if (act) {
        const a = act.dataset.action;
        if (a === 'close') this.close();
        else if (a === 'upgrade') handlers.upgrade && handlers.upgrade(act.dataset.id);
        else if (a === 'piece') this.pickPiece(act.dataset.id);
        else if (a === 'buildall') handlers.buildAll && handlers.buildAll();
        else if (a === 'upgradeall') handlers.upgradeAll && handlers.upgradeAll();
        else if (a === 'style') handlers.style && handlers.style();
        else if (a === 'aim') handlers.aim && handlers.aim();
        else if (a === 'touch') handlers.touch && handlers.touch();
      }
    });

    $('btnNew').addEventListener('click', () => handlers.start && handlers.start(false));
    $('btnResume').addEventListener('click', () => handlers.start && handlers.start(true));
    this.el.panelLayer.addEventListener('pointerdown', (e) => {
      if (e.target === this.el.panelLayer) this.close();
    });
  },

  // -------------------------------------------------------------- chrome
  showMenu(on, hasSave) {
    this.el.menu.classList.toggle('hidden', !on);
    if (hasSave !== undefined) $('btnResume').classList.toggle('hidden', !hasSave);
  },

  showHUD(on) {
    this.el.hud.classList.toggle('hidden', !on);
    this._last = {};
  },

  fatal(msg) {
    const el = (this.el && this.el.fatal) || document.getElementById('fatal');
    if (!el) return;
    el.classList.remove('hidden');
    const p = el.querySelector('p');
    if (msg && p) p.textContent = msg;
  },

  toast(text, kind = '', ms = 3600) {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.innerHTML = text;
    this.el.toastBox.appendChild(d);
    const id = ++this.toastSeq;
    setTimeout(() => {
      if (d.parentNode) d.parentNode.removeChild(d);
      if (id === this.toastSeq && !this.el.toastBox.children.length) this.toastSeq = 0;
    }, ms);
    while (this.el.toastBox.children.length > 5) this.el.toastBox.removeChild(this.el.toastBox.firstChild);
  },

  banner(title, text, ms = 4200) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerText.innerHTML = text || '';
    this.el.banner.classList.remove('hidden');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.el.banner.classList.add('hidden'), ms);
  },

  // ---------------------------------------------------------------- panels
  panelOpen() { return this.panel !== null; },
  /** Modals pause the simulation; the fortress tray does not. */
  modalOpen() { return this.panel !== null && this.panel !== 'build'; },

  close() {
    this.panel = null;
    this.el.panelLayer.classList.add('hidden');
    this.el.panelLayer.classList.remove('tray');
    document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
    if (this.handlers.onClose) this.handlers.onClose();
  },

  open(name) {
    this.panel = name;
    this.el.panelLayer.classList.remove('hidden');
    this.el.panelLayer.classList.toggle('tray', name === 'build');
    document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
    const el = $('panel' + name[0].toUpperCase() + name.slice(1));
    if (el) el.classList.remove('hidden');
    if (this.handlers.onOpen) this.handlers.onOpen(name);
  },

  openTiers(game) { this.open('tiers'); this.refreshTiers(game); },
  openBuild(game) { this.open('build'); this.refreshBuild(game); },
  openHelp() { this.open('help'); },
  toggle(name, game) {
    if (this.panel === name) this.close();
    else if (name === 'tiers') this.openTiers(game);
    else if (name === 'build') this.openBuild(game);
    else this.openHelp();
  },

  /** The three preference chips + the aim-mode readout under the reticle. */
  refreshSettings(game) {
    const st = game.settings || {};
    if (this.el.styleChip) {
      this.el.styleChip.textContent = st.style === 'voxel' ? '🧱 Fortress: VOXEL BLOCKS' : '🏛️ Fortress: SCI-FI';
      this.el.styleChip.classList.toggle('on', st.style === 'voxel');
    }
    if (this.el.aimChip) {
      this.el.aimChip.textContent = st.aimAssist === false ? '🎯 Weapons: FULL MANUAL' : '🎯 Weapons: AUTO-LOCK';
      this.el.aimChip.classList.toggle('on', st.aimAssist === false);
    }
    if (this.el.touchChip) {
      const t = st.touch || 'auto';
      this.el.touchChip.textContent = `📱 Touch: ${t.toUpperCase()}`;
      this.el.touchChip.classList.toggle('on', t === 'on');
    }
    if (this.el.aimMode) {
      const manual = st.aimAssist === false;
      this.el.aimMode.textContent = manual ? 'MANUAL' : 'AUTO';
      this.el.aimMode.classList.toggle('manual', manual);
    }
  },

  refreshTiers(game) {
    this.refreshSettings(game);
    const rows = tierRows(game.ship);
    this.el.tierRows.innerHTML = rows.map((r) => {
      const pips = Array.from({ length: r.max + 1 }, (_, i) => `<span class="pip ${i <= r.tier ? 'on' : ''}"></span>`).join('');
      const stats = Object.entries(r.stats)
        .map(([k, v]) => `<span>${labelOf(k)} <b>${typeof v === 'number' ? Math.round(v * 10) / 10 : v}</b></span>`)
        .join(' · ');
      const cost = r.cost
        ? Object.entries(r.cost).map(([k, v]) => `${v} ${short(k)}`).join(' · ')
        : 'max refit';
      const affordable = r.cost && Object.entries(r.cost).every(([k, v]) => (game.bank[k] || 0) >= v);
      return `<div class="tier-row">
        <div class="icon">${r.icon}</div>
        <div>
          <div class="name">${r.label} — ${r.name}</div>
          <div class="desc">${r.desc}</div>
          <div class="pips">${pips}</div>
        </div>
        <div class="stats">${stats}</div>
        <button data-action="upgrade" data-id="${r.component}" ${!r.cost || !affordable ? 'disabled' : ''}>
          ${r.cost ? 'INSTALL ' + r.nextName : 'FINAL REFIT'}
          <span class="cost">${cost}</span>
        </button>
      </div>`;
    }).join('');
  },

  refreshBuild(game) {
    this.el.pieceGrid.innerHTML = PIECE_ORDER.map((kind) => {
      const p = FORT_PIECES[kind];
      const cost = Object.entries(p.cost).map(([k, v]) => `${v} ${short(k)}`).join(' · ');
      const affordable = Object.entries(p.cost).every(([k, v]) => (game.bank[k] || 0) >= v);
      return `<button class="piece ${kind === this.piece ? 'active' : ''}" data-action="piece" data-id="${kind}">
        <b>${p.icon} ${p.label}</b>
        <small>${p.desc}</small>
        <span class="cost" style="${affordable ? '' : 'color:#ff8b96'}">${cost}</span>
      </button>`;
    }).join('');
    const f = game.fort;
    this.el.fortStats.innerHTML = `
      <span>Pieces <b>${f.count}/${FORT.maxPieces}</b></span>
      <span>Hull <b>${Math.round(f.hull)}/${Math.round(f.hullMax)}</b></span>
      <span>Shield <b>${Math.round(f.shield)}/${Math.round(f.shieldMax)}</b></span>
      <span>Turrets <b>${f.turrets.length}</b></span>
      <span>Range bonus <b>+${Math.round((f.rangeMult - 1) * 100)}%</b></span>
      <span>Mining <b>${(f.yields.titanium || 0).toFixed(1)} Ti/s</b></span>`;
  },

  flash() {
    const el = this.el.dmgFlash;
    if (!el) return;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  },

  setSoundIcon(on) {
    if (this.el.soundIcon) this.el.soundIcon.textContent = on ? '🔊' : '🔇';
  },

  pickPiece(kind) {
    this.piece = kind;
    this.el.pieceGrid.querySelectorAll('.piece').forEach((b) => {
      b.classList.toggle('active', b.dataset.id === kind);
    });
    if (this.handlers.onPiece) this.handlers.onPiece(kind);
  },

  // ------------------------------------------------------------------ HUD
  update(game) {
    const st = game.ship.stats;
    const l = this._last;
    const set = (key, val, fn) => { if (l[key] !== val) { l[key] = val; fn(val); } };

    set('hull', Math.round(game.hull), (v) => {
      const pct = Math.max(0, (game.hull / st.hull) * 100);
      this.el.hullFill.style.width = pct + '%';
      this.el.hullFill.classList.toggle('low', pct < 35);
      this.el.hullText.textContent = `${v}/${Math.round(st.hull)}`;
    });
    set('shield', Math.round(game.shields), (v) => {
      this.el.shieldFill.style.width = Math.max(0, (game.shields / st.maxShields) * 100) + '%';
      this.el.shieldText.textContent = `${v}/${Math.round(st.maxShields)}`;
    });
    set('energy', Math.round(game.energy), (v) => {
      this.el.energyFill.style.width = Math.max(0, (game.energy / st.energy) * 100) + '%';
      this.el.energyText.textContent = `${v}`;
    });
    set('speed', Math.round(game.speed), (v) => { this.el.speedText.textContent = `${v} m/s`; });
    set('warp', game.warpCd > 0 ? Math.ceil(game.warpCd) : 0, (v) => {
      this.el.warpLine.textContent = v > 0 ? `WARP ${v}s` : 'WARP READY';
      this.el.warpLine.classList.toggle('cool', v > 0);
    });
    set('ti', Math.floor(game.bank.titanium), (v) => { this.el.resTi.textContent = v; });
    set('di', Math.floor(game.bank.dilithium), (v) => { this.el.resDi.textContent = v; });
    set('mx', Math.floor(game.bank.matrix), (v) => { this.el.resMx.textContent = v; });
    set('cargo', Math.round(game.cargoTotal), () => {
      this.el.cargoFill.style.width = Math.min(100, (game.cargoTotal / game.cargoMax) * 100) + '%';
      this.el.cargoText.textContent = `${Math.round(game.cargoTotal)}/${game.cargoMax}`;
    });
    set('obj', game.objectiveText(), (v) => { this.el.objective.innerHTML = v; });
    const siegeTxt = game.siegeTimer > 0 ? `Next siege in <b>${Math.ceil(game.siegeTimer)}s</b>` : 'SIEGE UNDERWAY';
    set('siege', siegeTxt, (v) => {
      this.el.siegeLine.innerHTML = v;
      this.el.siegeLine.classList.toggle('hot', game.siegeTimer < 25 || game.siegeTimer <= 0);
    });

    const cx = game.stream ? game.stream.cx : 0;
    const cz = game.stream ? game.stream.cz : 0;
    set('sector', `${cx},${cz},${game.charted || 0}`, () => {
      this.el.sectorLine.innerHTML = `SECTOR <b>${cx},${cz}</b> · ${game.charted || 0} charted`;
    });

    // reticle / lock / abyss
    const locked = !!game.lockedEnemy;
    if (l.locked !== locked) { l.locked = locked; this.el.lockRing.classList.toggle('hidden', !locked); }
    const abyss = game.abyss;
    if (l.abyss !== abyss) { l.abyss = abyss; this.el.abyssWarn.classList.toggle('hidden', !abyss); }

    // interact prompt
    let prompt = '';
    if (game.nearFort && game.cargoTotal > 0) prompt = 'E — deposit salvage';
    else if (game.nearDerelict) prompt = `E — strip ${game.nearDerelict.name}`;
    else if (game.nearIsland && !game.nearIsland.looted) prompt = `E — survey ${game.nearIsland.name}`;
    else if (game.abyss) prompt = 'PULL UP — the abyss is eating the hull';
    set('prompt', prompt, (v) => {
      this.el.prompt.classList.toggle('hidden', !v);
      if (v) this.el.prompt.textContent = v;
    });

    if (this.panel === 'tiers') {
      if ((l.tierRefresh = (l.tierRefresh || 0) + 1) > 20) this.refreshTiers(game);
    } else if (this.panel === 'build') {
      if ((l.buildRefresh = (l.buildRefresh || 0) + 1) > 20) this.el.fortStats && this.refreshBuildStats(game);
    }
    this.drawRadar(game);
  },

  refreshBuildStats(game) {
    const f = game.fort;
    this.el.fortStats.innerHTML = `
      <span>Pieces <b>${f.count}/${FORT.maxPieces}</b></span>
      <span>Hull <b>${Math.round(f.hull)}/${Math.round(f.hullMax)}</b></span>
      <span>Shield <b>${Math.round(f.shield)}/${Math.round(f.shieldMax)}</b></span>
      <span>Turrets <b>${f.turrets.length}</b></span>
      <span>Range bonus <b>+${Math.round((f.rangeMult - 1) * 100)}%</b></span>
      <span>Mining <b>${(f.yields.titanium || 0).toFixed(1)} Ti/s</b></span>`;
  },

  // ---------------------------------------------------------------- radar
  drawRadar(game) {
    const ctx = this.rctx;
    if (!ctx) return;
    const w = this.el.radar.width, h = this.el.radar.height;
    const cx = w / 2, cy = h / 2, R = w / 2 - 4;
    ctx.clearRect(0, 0, w, h);

    // rings
    ctx.strokeStyle = 'rgba(103,224,255,0.16)';
    ctx.lineWidth = 1;
    for (const r of [R * 0.35, R * 0.7, R]) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    // sweep
    const sweep = (game.t * 0.9) % (Math.PI * 2);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    grad.addColorStop(0, 'rgba(103,224,255,0.20)');
    grad.addColorStop(1, 'rgba(103,224,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, sweep - 0.5, sweep);
    ctx.closePath();
    ctx.fill();

    // heading-up projection
    const range = 320;
    const yaw = game.yaw;
    const sin = Math.sin(-yaw), cos = Math.cos(-yaw);
    const place = (x, z) => {
      const dx = x - game.pos.x, dz = z - game.pos.z;
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      return { x: cx + (rx / range) * R, y: cy + (rz / range) * R };
    };
    for (const b of game.radar()) {
      const p = place(b.x, b.z);
      if (Math.hypot(p.x - cx, p.y - cy) > R - 2) continue;
      if (b.kind === 'island') {
        ctx.fillStyle = 'rgba(127,209,138,0.55)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 2 + (b.size || 1) * 1.6, 0, Math.PI * 2); ctx.fill();
      } else if (b.kind === 'derelict') {
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      } else if (b.kind === 'fort') {
        ctx.strokeStyle = '#67e0ff';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.stroke();
      } else if (b.kind === 'loot') {
        ctx.fillStyle = '#c4a8ff';
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      } else {
        ctx.fillStyle = '#ff6b7a';
        ctx.beginPath(); ctx.arc(p.x, p.y, 2 + (b.size || 1), 0, Math.PI * 2); ctx.fill();
      }
    }
    // own ship
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6); ctx.lineTo(cx - 4, cy + 4); ctx.lineTo(cx + 4, cy + 4);
    ctx.closePath(); ctx.fill();
  },
};

function short(k) {
  return { titanium: 'Ti', dilithium: 'Di', matrix: 'Mx' }[k] || k;
}
function labelOf(k) {
  return {
    crew: 'crew', banks: 'banks', shieldCap: 'shield+', maxSpeed: 'speed', turnRate: 'turn',
    warpCd: 'warp cd', maxShields: 'shields', regen: 'regen', tractor: 'tractor',
    weaponDamage: 'damage', fireRate: 'rate', lockCone: 'lock',
  }[k] || k;
}
