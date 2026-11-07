// DOM interface: HUD, crafting book, build tray, crew, satchel, dock shop, route.
import { RECIPES, RECIPE_BY_ID, CATEGORIES, RECIPE_COUNT } from './recipes.js';
import { RES, RES_KEYS, ROLES, SHOP_ITEMS, STATION_NAMES, INTERIOR_ITEMS, CAR_PAINTS } from './data.js';
import { ZONES } from './world.js';
import { fmt, clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const UI = {
  G: null,
  actions: null,
  panel: null,
  el: {},
  _craft: { cat: 'all', tier: 0, q: '', afford: false, shown: 60 },
  _last: {},
  _bannerTimer: 0,

  init(G, actions) {
    this.G = G;
    this.actions = actions;
    this.el = {
      hud: $('hud'), zoneName: $('zoneName'), zoneSub: $('zoneSub'), objective: $('objective'),
      hullFill: $('hullFill'), hullText: $('hullText'), powerFill: $('powerFill'), powerText: $('powerText'),
      statCash: $('statCash'), statCrew: $('statCrew'), statHome: $('statHome'), statDrone: $('statDrone'),
      statTier: $('statTier'), statStation: $('statStation'), statRaft: $('statRaft'),
      resbar: $('resbar'), buffs: $('buffs'), prompt: $('prompt'), toasts: $('toasts'),
      banner: $('banner'), bannerTitle: $('bannerTitle'), bannerText: $('bannerText'),
      hotbar: $('hotbar'), panelLayer: $('panelLayer'), panel: $('panel'), panelTitle: $('panelTitle'),
      panelSub: $('panelSub'), panelBody: $('panelBody'), panelClose: $('panelClose'),
      buildTray: $('buildTray'), trayItems: $('trayItems'), trayHint: $('trayHint'), buildExit: $('buildExit'),
      trayRoof: $('trayRoof'), trayInterior: $('trayInterior'), trayPaints: $('trayPaints'),
      waveBox: $('waveBox'), waveLabel: $('waveLabel'), waveFill: $('waveFill'),
      craftBox: $('craftBox'), craftFill: $('craftFill'), craftLabel: $('craftLabel'), craftIcon: $('craftIcon'),
      anchorChip: $('anchorChip'), anchorCount: $('anchorCount'),
      tornadoBox: $('tornadoBox'), tornadoFill: $('tornadoFill'), tornadoHint: $('tornadoHint'),
      bossBox: $('bossBox'), bossFill: $('bossFill'), weaponLine: $('weaponLine'),
      menu: $('menu'), saveMeta: $('saveMeta'), endScreen: $('endScreen'),
      endTitle: $('endTitle'), endSub: $('endSub'), endStats: $('endStats'),
      minimap: $('minimap'), fps: $('fps'),
    };

    // resource chips are created once
    this.el.resbar.innerHTML = RES_KEYS.map((k) =>
      `<div class="res-chip" data-res="${k}" title="${RES[k].name}"><span class="ico">${RES[k].icon}</span><span class="val">0</span></div>`
    ).join('');
    this._res = {};
    this.el.resbar.querySelectorAll('.res-chip').forEach((chip) => {
      this._res[chip.dataset.res] = { chip, val: chip.querySelector('.val') };
    });

    this.el.hotbar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      actions.panel(b.dataset.act);
    });
    this.el.panelClose.addEventListener('click', () => actions.closePanel());
    this.el.buildExit.addEventListener('click', () => actions.exitBuild());
    this.el.trayRoof.addEventListener('click', () => actions.setBuildTarget('roof'));
    this.el.trayInterior.addEventListener('click', () => actions.setBuildTarget('interior'));
    if (this.el.trayPaints) {
      this.el.trayPaints.addEventListener('click', (e) => {
        const sw = e.target.closest('[data-paint]');
        if (sw) actions.setPaint(sw.dataset.paint);
      });
    }
    this.el.trayItems.addEventListener('click', (e) => {
      const it = e.target.closest('.tray-item');
      if (!it) return;
      if (it.dataset.int) actions.selectInterior(it.dataset.int);
      else if (it.dataset.id) actions.selectBuild(it.dataset.id);
    });

    this.el.panelBody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'craft') actions.craft(btn.dataset.id);
      else if (a === 'cat') { this._craft.cat = btn.dataset.id; this._craft.shown = 60; this.openCraft(); }
      else if (a === 'more') { this._craft.shown += 60; this.renderCraftList(); }
      else if (a === 'use') actions.useItem(btn.dataset.id);
      else if (a === 'equip') actions.equipWeapon(+btn.dataset.idx);
      else if (a === 'dismiss') actions.dismissCrew(+btn.dataset.idx);
      else if (a === 'buy') actions.buy(btn.dataset.id);
      else if (a === 'sell') actions.sell(btn.dataset.id, 25);
      else if (a === 'close') actions.closePanel();
    });
    this.el.panelBody.addEventListener('input', (e) => {
      if (e.target.id === 'craftSearch') {
        this._craft.q = e.target.value;
        this._craft.shown = 60;
        this.renderCraftList();
      }
    });
    this.el.panelBody.addEventListener('change', (e) => {
      if (e.target.id === 'craftTier') { this._craft.tier = +e.target.value; this._craft.shown = 60; this.renderCraftList(); }
      if (e.target.id === 'craftAfford') { this._craft.afford = e.target.checked; this._craft.shown = 60; this.renderCraftList(); }
    });
  },
  // ------------------------------------------------------------- HUD
  updateHUD(G) {
    const car = G.car;
    const ratio = clamp(car.hull / car.hullMax, 0, 1);
    const l = this._last;
    if (l.zone !== G.zone.def.id) {
      l.zone = G.zone.def.id;
      this.el.zoneName.textContent = G.zone.def.name;
      this.el.zoneSub.textContent = G.zone.def.sub;
    }
    const obj = G.objectiveText();
    if (l.obj !== obj) { l.obj = obj; this.el.objective.innerHTML = obj; }

    const hullPct = Math.round(ratio * 1000) / 10;
    if (l.hull !== hullPct) {
      l.hull = hullPct;
      this.el.hullFill.style.width = hullPct + '%';
      this.el.hullFill.classList.toggle('low', ratio < 0.35);
      this.el.hullText.textContent = `${Math.ceil(car.hull)}/${Math.round(car.hullMax)}`;
    }
    const powPct = Math.round(clamp(car.power / G.stats.powerMax, 0, 1) * 1000) / 10;
    if (l.pow !== powPct) {
      l.pow = powPct;
      this.el.powerFill.style.width = powPct + '%';
      this.el.powerText.textContent = `${Math.floor(car.power)}/${Math.round(G.stats.powerMax)}`;
    }
    if (l.cash !== G.cash) { l.cash = G.cash; this.el.statCash.textContent = fmt(G.cash); }
    const crewTxt = `${G.crew.length}/${G.stats.crewCap}`;
    if (l.crew !== crewTxt) { l.crew = crewTxt; this.el.statCrew.textContent = crewTxt; }
    if (l.home !== G.stats.houseScore) { l.home = G.stats.houseScore; this.el.statHome.textContent = G.stats.houseScore; }
    const dTxt = `${G.drones.filter((d) => d.deployed).length}/${G.stats.droneCap}`;
    if (l.drone !== dTxt) { l.drone = dTxt; this.el.statDrone.textContent = dTxt; }
    if (l.tier !== G.zone.def.tier) { l.tier = G.zone.def.tier; this.el.statTier.textContent = G.zone.def.tier; }
    const st = STATION_NAMES[G.stats.station];
    if (l.station !== st) { l.station = st; this.el.statStation.textContent = st; }
    const raftTxt = `${car.raft ? '🛶' : '·'}${car.engine ? '⛴️' : '·'}`;
    if (l.raft !== raftTxt) { l.raft = raftTxt; this.el.statRaft.textContent = raftTxt; }

    for (const k of RES_KEYS) {
      const v = Math.floor(G.res[k] || 0);
      const r = this._res[k];
      if (r.last !== v) {
        r.last = v;
        r.val.textContent = fmt(v);
        r.chip.classList.toggle('maxed', v >= G.stats.cap);
      }
    }

    // timed crafting + anchor + tornado
    const cr = G.crafting;
    if (cr) {
      this.el.craftBox.classList.remove('hidden');
      this.el.craftFill.style.width = (G.craftProgress() * 100).toFixed(1) + '%';
      this.el.craftIcon.textContent = cr.icon || '🛠️';
      this.el.craftLabel.textContent = `${cr.name} ${Math.max(0, cr.total - cr.t).toFixed(1)}s`;
    } else if (!this.el.craftBox.classList.contains('hidden')) {
      this.el.craftBox.classList.add('hidden');
    }
    const anchors = car.anchors || 0;
    const anchorTxt = car.anchorT > 0 ? `ANCHORED ${Math.ceil(car.anchorT)}s` : `${anchors} · Y`;
    if (l.anchor !== anchorTxt) {
      l.anchor = anchorTxt;
      this.el.anchorChip.innerHTML = `⚓ <b>${anchorTxt}</b>`;
      this.el.anchorChip.classList.remove('hidden');
      this.el.anchorChip.classList.toggle('held', car.anchorT > 0);
    }
    if (G.tornado) {
      this.el.tornadoBox.classList.remove('hidden');
      this.el.tornadoFill.style.width = Math.max(0, (G.tornado.hp / G.tornado.maxHp) * 100).toFixed(1) + '%';
      this.el.tornadoHint.textContent = car.anchorT > 0
        ? `⚓ anchored for ${Math.ceil(car.anchorT)}s — keep shooting`
        : anchors > 0 ? 'Press Y to anchor (30s of protection)' : 'NO ANCHORS — craft a Ground Anchor!';
    } else if (!this.el.tornadoBox.classList.contains('hidden')) {
      this.el.tornadoBox.classList.add('hidden');
    }

    // prompt
    const prompt = G.promptText();
    if (l.prompt !== prompt) {
      l.prompt = prompt;
      if (prompt) { this.el.prompt.innerHTML = prompt; this.el.prompt.classList.remove('hidden'); }
      else this.el.prompt.classList.add('hidden');
    }

    // buffs
    const buffList = G.activeBuffs();
    const buffKey = buffList.map((b) => b.label + b.t).join('|');
    if (l.buffKey !== buffKey) {
      l.buffKey = buffKey;
      if (buffList.length) {
        this.el.buffs.innerHTML = buffList.map((b) => `<div class="buff">${b.label} · ${Math.ceil(b.t)}s</div>`).join('');
        this.el.buffs.classList.remove('hidden');
      } else this.el.buffs.classList.add('hidden');
    }

    // wave tracker
    const f = G.finale;
    if (f && f.started) {
      this.el.waveBox.classList.remove('hidden');
      let label;
      if (f.wave === 0) label = `FIRST WAVE IN ${Math.max(0, Math.ceil(f.timer))}s`;
      else if (f.remaining > 0) label = `WAVE ${f.wave} / ${f.waves} · ${f.remaining} HOSTILES`;
      else if (f.wave >= f.waves) label = 'WAVE 5 / 5 · THE GENERAL';
      else label = `WAVE ${f.wave} CLEARED · NEXT IN ${Math.max(0, Math.ceil(f.timer))}s`;
      if (l.waveLabel !== label) { l.waveLabel = label; this.el.waveLabel.textContent = label; }
      this.el.waveFill.style.width = (Math.min(f.wave, f.waves) / f.waves) * 100 + '%';
    } else if (l.waveShown) {
      this.el.waveBox.classList.add('hidden');
    }
    l.waveShown = !!(f && f.started);

    // boss health
    const boss = G.enemies.find((e) => e.def.boss && !e.dead);
    if (boss) {
      this.el.bossBox.classList.remove('hidden');
      this.el.bossFill.style.width = Math.max(0, (boss.hp / boss.maxHp) * 100) + '%';
    } else if (l.bossShown) {
      this.el.bossBox.classList.add('hidden');
    }
    l.bossShown = !!boss;

    // equipped weapon
    const wName = G.currentWeapon().name;
    if (l.weapon !== wName) { l.weapon = wName; this.el.weaponLine.textContent = '🔫 ' + wName; }

    // hotbar shop availability
    const shopBtn = this.el.hotbar.querySelector('[data-act="route"]');
    if (shopBtn) shopBtn.querySelector('span').textContent = G.zone.def.finale ? '🎯' : '🗺️';
  },

  // ------------------------------------------------------------- feedback
  toast(msg, kind = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.innerHTML = msg;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 6) this.el.toasts.removeChild(this.el.toasts.firstChild);
    setTimeout(() => { d.style.transition = 'opacity .4s, transform .4s'; d.style.opacity = '0'; d.style.transform = 'translateX(16px)'; setTimeout(() => d.remove(), 420); }, 3000);
  },

  banner(title, text, ms = 3600) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerText.textContent = text || '';
    this.el.banner.classList.remove('hidden');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.el.banner.classList.add('hidden'), ms);
  },

  // ------------------------------------------------------------- panels
  panelOpen() { return this.panel !== null; },

  openPanel(name) {
    this.panel = name;
    this.el.panelLayer.classList.remove('hidden');
    this.el.panelBody.scrollTop = 0;
    if (name === 'craft') this.openCraft();
    else if (name === 'crew') this.openCrew();
    else if (name === 'items') this.openItems();
    else if (name === 'shop') this.openShop();
    else if (name === 'route') this.openRoute();
    else if (name === 'help') this.openHelp();
    this.el.hotbar.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.act === name);
    });
  },

  closePanel() {
    this.panel = null;
    this.el.panelLayer.classList.add('hidden');
    this.el.hotbar.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
  },

  refresh() {
    if (!this.panel) return;
    const scroll = this.el.panelBody.scrollTop;
    this.openPanel(this.panel);
    this.el.panelBody.scrollTop = scroll;
  },

  // ------------------------------------------------------------- craft
  openCraft() {
    const G = this.G;
    const c = this._craft;
    this.el.panelTitle.textContent = 'CRAFTING';
    this.el.panelSub.textContent = `${STATION_NAMES[G.stats.station]} · ${RECIPE_COUNT} recipes`;
    const stationWarn = G.stats.station < 3
      ? `<div class="station-warn">Higher tiers need better stations on the car: build a <b>Workbench</b> (tier 2–3), <b>Advanced Workshop</b> (tier 4) and <b>Nano Lab</b> (tier 5).</div>` : '';
    const searchVal = esc(c.q);
    this.el.panelBody.innerHTML = `
      <div class="craft-controls">
        <div class="tabs">${CATEGORIES.map((cat) =>
          `<button class="tab ${c.cat === cat.id ? 'active' : ''}" data-action="cat" data-id="${cat.id}">${cat.icon} ${cat.label}</button>`).join('')}
        </div>
        <input class="search" id="craftSearch" placeholder="Search recipes, weapons, rooms…" value="${searchVal}" autocomplete="off" />
        <select class="select" id="craftTier">
          <option value="0"${c.tier === 0 ? ' selected' : ''}>All tiers</option>
          ${[1, 2, 3, 4, 5].map((t) => `<option value="${t}"${c.tier === t ? ' selected' : ''}>Tier ${t}</option>`).join('')}
        </select>
        <label class="check"><input type="checkbox" id="craftAfford"${c.afford ? ' checked' : ''}/> craftable now</label>
      </div>
      ${stationWarn}
      <div class="recipe-count" id="craftCount"></div>
      <div class="recipe-grid" id="craftList"></div>
      <div id="craftMore"></div>`;
    this.renderCraftList();
  },

  craftMatches() {
    const c = this._craft;
    const q = c.q.trim().toLowerCase();
    const G = this.G;
    const list = [];
    for (const r of RECIPES) {
      if (c.cat !== 'all' && r.cat !== c.cat) continue;
      if (c.tier && r.tier !== c.tier) continue;
      if (q && !(r.name.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q) || (r.tag || '').toLowerCase().includes(q))) continue;
      if (c.afford) {
        if (!this.canAfford(G.craftCost(r)) || r.station > G.stats.station) continue;
      }
      list.push(r);
    }
    list.sort((a, b) => a.tier - b.tier || a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
    return list;
  },

  canAfford(cost) {
    const G = this.G;
    return Object.entries(cost).every(([k, v]) => (G.res[k] || 0) >= v);
  },

  renderCraftList() {
    const G = this.G;
    const c = this._craft;
    const list = this.craftMatches();
    const countEl = $('craftCount');
    if (countEl) {
      countEl.innerHTML = `${list.length} recipe${list.length === 1 ? '' : 's'} match · showing ${Math.min(c.shown, list.length)} · cash <b>${fmt(G.cash)}</b>`;
    }
    const shown = list.slice(0, c.shown);
    const listEl = $('craftList');
    if (!listEl) return;
    if (!shown.length) {
      listEl.innerHTML = `<div class="crew-empty" style="grid-column:1/-1">No recipe matches. Try another category or clear the search.</div>`;
    } else {
      listEl.innerHTML = shown.map((r) => {
        const stationOk = r.station <= G.stats.station;
        const realCost = G.craftCost(r);
        const afford = this.canAfford(realCost);
        const can = stationOk && afford;
        const cost = Object.entries(realCost).map(([k, v]) => {
          const have = (G.res[k] || 0) >= v;
          return `<span class="cost-chip ${have ? '' : 'miss'}">${RES[k].icon} ${v}</span>`;
        }).join('');
        const label = !stationOk ? '🔒 LOCKED' : 'CRAFT';
        const tip = !stationOk ? `Requires ${STATION_NAMES[r.station]}` : afford ? 'Craft this item' : 'Not enough materials';
        return `<div class="recipe t${r.tier} ${can ? '' : 'cant'}">
          <div class="r-icon">${r.icon}</div>
          <div class="r-main">
            <div class="r-name">${esc(r.name)}<span class="tier">T${r.tier}</span></div>
            <div class="r-desc">${esc(r.desc)}${(!stationOk ? ` · 🔒 needs ${STATION_NAMES[r.station]}` : '')}</div>
            <div class="r-cost">${cost}</div>
          </div>
          <button class="craft-btn" data-action="craft" data-id="${r.id}" ${can ? '' : 'disabled'} title="${esc(tip)}">${label}</button>
        </div>`;
      }).join('');
    }
    const more = $('craftMore');
    if (more) {
      more.innerHTML = list.length > c.shown
        ? `<button class="load-more" data-action="more">SHOW ${Math.min(60, list.length - c.shown)} MORE · ${list.length - c.shown} LEFT</button>`
        : '';
    }
  },

  // ------------------------------------------------------------- crew
  openCrew() {
    const G = this.G;
    this.el.panelTitle.textContent = 'CREW';
    this.el.panelSub.textContent = `${G.crew.length} / ${G.stats.crewCap} berths · build beds to make room`;
    const cards = G.crew.map((m, i) => {
      const role = ROLES[m.role];
      return `<div class="crew-card">
        <div class="crew-top"><div class="crew-icon">${role.icon}</div>
          <div><div class="crew-name">${esc(m.name)}</div><div class="crew-role">${role.name}</div></div>
        </div>
        <div class="crew-desc">${role.desc}</div>
        <button data-action="dismiss" data-idx="${i}">LEAVE BEHIND</button>
      </div>`;
    }).join('');
    this.el.panelBody.innerHTML = `
      <div class="crew-slots">Survivors you rescue in the ruins can ride with you. Each one takes a berth — build <b>Crew Beds</b> on the car to recruit more. A <b>Sniper</b> shoots on their own, a <b>Scavenger</b> finds more loot, an <b>Engineer</b> keeps the hull alive.</div>
      ${G.crew.length ? `<div class="crew-grid">${cards}</div>` : `<div class="crew-empty">No crew yet. Drive to a ruin, look for the green SURVIVOR marker and press E.</div>`}
    `;
  },

  // ------------------------------------------------------------- satchel
  openItems() {
    const G = this.G;
    this.el.panelTitle.textContent = 'SATCHEL';
    this.el.panelSub.textContent = `${G.weapons.length} weapons · ${Object.keys(G.consumables).length} item stacks · ${G.droneItems.length} drones`;
    const cons = Object.entries(G.consumables).filter(([, n]) => n > 0).map(([id, n]) => {
      const r = RECIPE_BY_ID[id];
      if (!r) return '';
      return `<div class="sat-card">
        <div class="r-icon">${r.icon}</div>
        <div class="sat-main"><div class="sat-name">${esc(r.name)} ×${n}</div><div class="sat-desc">${esc(r.desc)}</div></div>
        <button class="use-btn" data-action="use" data-id="${id}">USE</button>
      </div>`;
    }).join('');
    const weapons = G.weapons.map((w, i) => {
      const eq = G.equipped === i;
      return `<div class="sat-card">
        <div class="r-icon">${w.icon || '🔫'}</div>
        <div class="sat-main"><div class="sat-name">${esc(w.name)}</div><div class="sat-desc">${w.stats.dmg} dmg · ${w.stats.rate}/s${w.stats.pellets > 1 ? ` ×${w.stats.pellets}` : ''}</div></div>
        <button class="use-btn ${eq ? 'equipped' : ''}" data-action="equip" data-idx="${i}">${eq ? 'EQUIPPED' : 'EQUIP'}</button>
      </div>`;
    }).join('');
    const drones = G.droneItems.map((d) => `<div class="sat-card">
        <div class="r-icon">${d.spec.icon}</div>
        <div class="sat-main"><div class="sat-name">${esc(d.name)}</div><div class="sat-desc">${d.spec.role} · ${d.spec.dmg || 0} dmg · auto-deploys</div></div>
      </div>`).join('');
    this.el.panelBody.innerHTML = `
      <div class="sat-section"><h3>Weapons</h3>
        ${weapons || `<div class="crew-empty">Start with a salvaged pipe pistol. Craft better guns in the Crafting panel.</div>`}
      </div>
      <div class="sat-section"><h3>Consumables</h3>
        ${cons || `<div class="crew-empty">No consumables. Craft Repair Kits, Fuel Cans and Stims from the “Items” category.</div>`}
      </div>
      <div class="sat-section"><h3>Drones (${G.drones.filter((d) => d.deployed).length} deployed / ${G.stats.droneCap} slots)</h3>
        ${drones || `<div class="crew-empty">Build Drone Bays on the car to deploy drones for automatic fire support.</div>`}
      </div>
      <div class="sat-section"><h3>Permanent upgrades</h3>
        <div class="sat-grid">
          ${Object.entries(G.carUpg).filter(([, v]) => v).map(([k, v]) =>
            `<div class="sat-card"><div class="r-icon">⚙️</div><div class="sat-main"><div class="sat-name">${k}</div><div class="sat-desc">+${typeof v === 'number' ? Math.round(v * 100) / 100 : v}</div></div></div>`).join('') ||
            `<div class="crew-empty" style="grid-column:1/-1">Craft vehicle upgrades to make the car faster and tougher.</div>`}
        </div>
      </div>`;
  },

  // ------------------------------------------------------------- shop
  openShop() {
    const G = this.G;
    const near = G.nearDock();
    this.el.panelTitle.textContent = 'TRADING POST';
    this.el.panelSub.textContent = near ? 'Sunda Docks · open for business' : 'You are not at a dock';
    if (!near) {
      this.el.panelBody.innerHTML = `<div class="crew-empty">Drive to a <b>DOCK</b> (marked on the minimap) to trade. Docks are in Indonesia, Mumbai, Miami and Washington.</div>`;
      return;
    }
    const discount = G.hasRole('trader') ? 0.88 : 1;
    const items = SHOP_ITEMS.map((it) => {
      const price = Math.round(it.price * discount);
      const owned = it.id === 'raft' ? G.car.raft : it.id === 'engine' ? G.car.engine : false;
      const disabled = G.cash < price || owned;
      return `<div class="shop-card">
        <div class="r-icon">${it.icon}</div>
        <div class="shop-main"><div class="shop-name">${it.name} ${owned ? '· INSTALLED' : ''}</div><div class="shop-desc">${it.desc}</div></div>
        <div style="text-align:right">
          <div class="price">🪙 ${price}</div>
          <button class="buy-btn" data-action="buy" data-id="${it.id}" ${disabled ? 'disabled' : ''}>${owned ? 'OWNED' : 'BUY'}</button>
        </div>
      </div>`;
    }).join('');
    const sells = RES_KEYS.map((k) => {
      const price = Math.round((RES[k].tier) * 0.9 * 25);
      const have = Math.floor(G.res[k] || 0);
      return `<button class="sell-chip" data-action="sell" data-id="${k}" ${have < 25 ? 'disabled style="opacity:.4"' : ''}>
        ${RES[k].icon} ${RES[k].name} ×25 <b>+${price}🪙</b></button>`;
    }).join('');
    this.el.panelBody.innerHTML = `
      <div class="sat-section"><h3>Buy</h3><div class="shop-grid">${items}</div></div>
      <div class="sat-section"><h3>Sell surplus (25 at a time)</h3><div class="sell-grid">${sells}</div></div>`;
  },

  // ------------------------------------------------------------- route
  openRoute() {
    const G = this.G;
    this.el.panelTitle.textContent = 'THE ROUTE';
    this.el.panelSub.textContent = `Leg ${G.zoneIndex + 1} of ${ZONES.length} · Jakarta → Washington D.C.`;
    const rows = ZONES.map((z, i) => {
      const cur = i === G.zoneIndex;
      const done = i < G.zoneIndex;
      const req = G.zoneRequirement(i);
      return `<div class="route-item ${cur ? 'current' : ''} ${done ? 'done' : ''} ${i > G.zoneIndex ? 'locked' : ''}">
        <div class="route-idx">${String(i + 1).padStart(2, '0')}</div>
        <div class="route-dot"></div>
        <div class="route-main">
          <div class="route-name">${z.name}</div>
          <div class="route-sub">${z.sub} · threat ${'☠'.repeat(Math.min(5, z.tier))}</div>
          ${!done && req.text ? `<div class="route-req ${req.ok ? 'ok' : ''}">${req.ok ? '✓' : '✕'} ${req.text}</div>` : ''}
        </div>
        ${z.dock ? '<div class="route-tag">DOCK</div>' : ''}
        ${z.finale ? '<div class="route-tag">FINAL</div>' : ''}
        ${z.isSea ? '<div class="route-tag">SEA</div>' : ''}
      </div>`;
    }).join('');
    this.el.panelBody.innerHTML = `
      <p style="font-size:12px;color:#9fb0c3;line-height:1.6;margin:0 0 12px">
        Drive to the glowing <b>DEPART</b> marker at the far end of every zone and press <b>T</b>.
        Ocean legs need the <b>🛶 Raft Kit</b> and <b>⛴️ Ship Engine</b> from the Sunda Docks.
        You can always keep looting, crafting and building before you leave.
      </p>
      <div class="route-list">${rows}</div>`;
  },

  // ------------------------------------------------------------- help
  openHelp() {
    this.el.panelTitle.textContent = 'HOW TO PLAY';
    this.el.panelSub.textContent = 'survive, build, sail, fight';
    this.el.panelBody.innerHTML = `
      <div class="help-grid">
        <div class="help-block">
          <h3>Drive &amp; fight</h3>
          <ul>
            <li><b>W/S</b> throttle &amp; brake, <b>A/D</b> steer.</li>
            <li>Aim with the mouse, hold <b>left click</b> to fire. Shots use ammo; without ammo you fire weak improvised rounds.</li>
            <li>Enemies spawn in every zone. Turrets and drones fire automatically.</li>
            <li>Ram enemies with spikes and speed if you like — the car takes the damage too.</li>
            <li><b>G</b> steps out of the car. Walk with <b>WASD</b>, shoot with the mouse, press <b>G</b> near the car to climb back in.</li>
          </ul>
        </div>
        <div class="help-block">
          <h3>Loot the ruins</h3>
          <ul>
            <li>Get close to a glowing crate and press <b>E</b>.</li>
            <li>Purple crates are rare and drop far more.</li>
            <li>Green <b>SURVIVOR</b> markers are recruitable crew. Talk with <b>E</b>, pay their price.</li>
            <li>Every zone also has a <b>DEPART</b> gate at the far end.</li>
          </ul>
        </div>
        <div class="help-block">
          <h3>Build your house</h3>
          <ul>
            <li>Press <b>B</b>, pick a module from the tray, click a cell on the car roof.</li>
            <li>Floors and decorations raise your <b>🏠 home score</b>.</li>
            <li>Walls and shield plates add armour, storage adds material cap, beds add crew berths.</li>
            <li>Workbench → Advanced Workshop → Nano Lab unlock higher recipe tiers.</li>
            <li>Right-click a cell to tear the module off and get it back.</li>
            <li>The tray also has six <b>paint swatches</b> — repaint the car any time.</li>
            <li>Press <b>Tab</b> in build mode for the <b>interior</b>: 6 mount points inside the cabin take furniture (cot, stove, fridge, lamp, radio, safe…). Click a mount point to install.</li>
          </ul>
        </div>
        <div class="help-block">
          <h3>Anomaly tornado</h3>
          <ul>
            <li>Every zone gets a <b>night</b>. When the sky turns, an <b>🌪️ Anomaly Tornado</b> forms and hunts the car.</li>
            <li>It <b>drags the car</b> toward it and shreds the hull if it touches you.</li>
            <li>Carry an <b>⚓ Anomaly Anchor</b> (buy at a dock, loot, or craft a <i>Ground Anchor</i>) and press <b>Y</b>: 30 seconds pinned to the ground, damage cut to 28%.</li>
            <li>You can also fight it — turrets and your gun chew through its 900+ HP. Killing it pays salvage bonds.</li>
          </ul>
        </div>
        <div class="help-block">
          <h3>Craft 1,000+ recipes</h3>
          <ul>
            <li><b>C</b> opens the crafting book. Search, filter by category or tier.</li>
            <li>Weapons equip instantly · turrets &amp; rooms go to the build tray · drones deploy automatically · consumables go to the satchel.</li>
            <li>Crafting is <b>timed</b> — a progress bar runs at the top left. A <b>🔥 Campfire</b>, <b>🧰 Crafting Table</b> or <b>🛰️ Internet Dish</b> speeds it up, so building a real workroom matters.</li>
            <li>Turrets drain <b>power</b>. Solar panels and batteries keep them firing.</li>
            <li>Loot, craft, sell surplus at docks for cash.</li>
          </ul>
        </div>
        <div class="help-block">
          <h3>The journey</h3>
          <ul>
            <li>Everything is rendered in 3D — the camera chases the car, and you can walk around it on foot.</li>
            <li>Start in Java. Loot your way across Indonesia.</li>
            <li>At <b>Sunda Docks</b> buy a <b>Raft Kit</b> (🛶 ≈ 950) and a <b>Ship Engine</b> (⛴️ ≈ 1500), or craft improvised ones.</li>
            <li>Cross Malacca, Bengal, the Arabian Sea and the Atlantic.</li>
            <li>Resupply in Mumbai and Miami. Then reach Washington D.C.</li>
          </ul>
        </div>
        <div class="help-block">
          <h3>Final stand</h3>
          <ul>
            <li>In Washington the army throws <b>five waves</b> at your car house.</li>
            <li>Wave 5 is the <b>General's tank</b>. Kill it to win.</li>
            <li>If the hull hits zero, the run is over — retry the leg from your last save point.</li>
            <li>Use consumables, keep the hull above 30% before travelling.</li>
          </ul>
        </div>
      </div>`;
  },

  // ------------------------------------------------------------- build tray
  renderBuildTray(G) {
    this.setBuildTarget(G.buildTarget || 'roof');
    if (this.el.trayPaints) {
      this.el.trayPaints.innerHTML = CAR_PAINTS.map((p) =>
        `<button class="paint-sw ${G.car.paintId === p.id ? 'active' : ''}" data-paint="${p.id}" title="${p.name}" style="background:${p.body}"></button>`
      ).join('');
    }
    if (G.buildTarget === 'interior') {
      this.el.trayItems.innerHTML = INTERIOR_ITEMS.map((it) => {
        const cost = G.interiorCost(it);
        const afford = G.canAfford(cost);
        const costTxt = Object.entries(cost).map(([k, v]) => `${RES[k].icon}${v}`).join(' ');
        return `<button class="tray-item ${G.interiorSelected === it.id ? 'selected' : ''} ${afford ? '' : 'poor'}" data-int="${it.id}">
          <div class="ti-top"><span class="ti-icon">${it.icon}</span><span class="ti-count">${afford ? '✔' : '✕'}</span></div>
          <div class="ti-name">${esc(it.name)}</div>
          <div class="ti-tier">${costTxt}</div>
          <div class="ti-desc">${esc(it.desc)}</div>
        </button>`;
      }).join('');
      const sel = INTERIOR_ITEMS.find((i) => i.id === G.interiorSelected);
      this.el.trayHint.textContent = sel
        ? `${sel.name}: click a mount point inside the cabin · right-click removes · Tab switches to the roof`
        : 'Pick furniture, then click a mount point inside the cabin.';
      return;
    }
    const items = Object.entries(G.buildInv).filter(([, n]) => n > 0);
    if (!items.length) {
      this.el.trayItems.innerHTML = `<div class="tray-empty">No modules in the tray. Craft <b>Building</b> recipes to fill it up.</div>`;
    } else {
      this.el.trayItems.innerHTML = items.map(([id, n]) => {
        const r = RECIPE_BY_ID[id];
        if (!r) return '';
        return `<button class="tray-item ${G.buildSelected === id ? 'selected' : ''}" data-id="${id}">
          <div class="ti-top"><span class="ti-icon">${r.icon}</span><span class="ti-count">×${n}</span></div>
          <div class="ti-name">${esc(r.name)}</div>
          <div class="ti-tier">T${r.tier} · ${r.out.spec.kind.toUpperCase()}</div>
        </button>`;
      }).join('');
    }
    this.el.trayHint.textContent = G.buildSelected
      ? 'Click a cell on the car roof to place · right-click to remove · Tab for the interior'
      : 'Pick a module, then click a cell on the car roof.';
  },

  setBuildTarget(target) {
    const roof = target !== 'interior';
    if (this.el.trayRoof) this.el.trayRoof.classList.toggle('active', roof);
    if (this.el.trayInterior) this.el.trayInterior.classList.toggle('active', !roof);
  },

  setBuildMode(on) {
    this.el.buildTray.classList.toggle('hidden', !on);
    this.el.hotbar.classList.toggle('hidden', on);
  },

  // ------------------------------------------------------------- screens
  showMenu(hasSave, saveMeta) {
    this.el.menu.classList.remove('hidden');
    $('btnContinue').classList.toggle('hidden', !hasSave);
    this.el.saveMeta.textContent = hasSave ? saveMeta : '';
  },
  hideMenu() { this.el.menu.classList.add('hidden'); },

  showEnd(win, title, sub, stats) {
    this.el.endScreen.classList.remove('hidden');
    this.el.endTitle.textContent = title;
    this.el.endTitle.classList.toggle('win', win);
    this.el.endSub.textContent = sub;
    this.el.endStats.innerHTML = stats.map((s) => `<div>${s.label}<b>${s.value}</b></div>`).join('');
  },
  hideEnd() { this.el.endScreen.classList.add('hidden'); },

  showHUD(on) {
    this.el.hud.classList.toggle('hidden', !on);
    this.el.hotbar.classList.toggle('hidden', !on);
    this.el.resbar.classList.toggle('hidden', !on);
    if (!on) {
      this.el.prompt.classList.add('hidden');
      this.el.buffs.classList.add('hidden');
      this.el.waveBox.classList.add('hidden');
      this.el.craftBox.classList.add('hidden');
      this.el.anchorChip.classList.add('hidden');
      this.el.tornadoBox.classList.add('hidden');
    }
  },

  setFps(v) { this.el.fps.textContent = v; },
};
