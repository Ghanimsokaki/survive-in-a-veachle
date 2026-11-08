/**
 * touch.js — phone controls for HOME ON WHEELS.
 *
 * The game reads a keyboard and a mouse: `window` keydown/keyup for driving and
 * the panel shortcuts, and `mousemove`/`mousedown` on the canvas for aiming,
 * shooting, looting and build placement. Rather than teach every system about
 * fingers, this layer **translates touch into the events the game already
 * understands** — the same approach as a console pad mapper. Nothing in game.js
 * changes, so the desktop build behaves exactly as before.
 *
 * Layout, in the shape phones expect:
 *
 *   ┌───────────────────────────────┐
 *   │                               │
 *   │        tap /drag to aim       │   right 55%: aim + shoot
 *   │                     ┌───┐     │
 *   │   ┌────┐            │ E │     │
 *   │   │  ○ │  stick     └───┘     │
 *   │   └────┘   ┌─┐┌─┐┌─┐┌─┐      │   action row: craft / build / walk / anchor
 *   └───────────────────────────────┘
 *
 * Mount it with `mountTouch({ window, canvas })`; it is a no-op unless the device
 * has a coarse pointer (or the URL carries `?touch=1`, which is how the test
 * drives it headlessly).
 */

const HOLD_KEYS = {
  up: 'w', down: 's', left: 'a', right: 'd',
};

/** The buttons in the action cluster, in the order they are drawn. */
export const TOUCH_ACTIONS = [
  { do: 'interact', key: 'e', label: 'E', title: 'Loot / talk / shop' },
  { do: 'craft', key: 'c', label: '🛠', title: 'Crafting' },
  { do: 'build', key: 'b', label: '🏠', title: 'Build mode' },
  { do: 'foot', key: 'g', label: '🚶', title: 'Get out / back in' },
  { do: 'anchor', key: 'y', label: '⚓', title: 'Anomaly anchor' },
  { do: 'items', key: 'i', label: '🎒', title: 'Satchel' },
  { do: 'crew', key: 'n', label: '👥', title: 'Crew' },
  { do: 'route', key: 'm', label: '🗺', title: 'Route' },
  { do: 'help', key: 'h', label: '❔', title: 'Help' },
  { do: 'depart', key: 't', label: '➡', title: 'Depart this leg' },
];

export function touchSupported(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return false;
  try {
    if (/[?&]touch=1/.test(win.location.search)) return true;
    if (/[?&]touch=0/.test(win.location.search)) return false;
    if (win.matchMedia && win.matchMedia('(pointer: coarse)').matches) return true;
  } catch { /* fall through */ }
  return 'ontouchstart' in win;
}

export class GameTouch {
  constructor({ win = window, canvas = null, doc = null } = {}) {
    this.win = win;
    this.doc = doc || win.document;
    this.canvas = canvas || this.doc.getElementById('game');
    this.root = null;
    this.enabled = false;
    this.held = new Set();          // keys currently synthesised as down
    this.stick = { x: 0, y: 0 };
    this.aim = { x: 0.5, y: 0.4 };  // normalised canvas position
    this.firing = false;
    this._bindings = [];
  }

  // ------------------------------------------------------------------ events
  _listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._bindings.push([target, type, fn]);
  }

  _keyDown(k) {
    if (this.held.has(k)) return;
    this.held.add(k);
    this.win.dispatchEvent(new this.win.KeyboardEvent('keydown', { key: k, bubbles: true }));
  }

  _keyUp(k) {
    if (!this.held.has(k)) return;
    this.held.delete(k);
    this.win.dispatchEvent(new this.win.KeyboardEvent('keyup', { key: k, bubbles: true }));
  }

  _releaseKeys() {
    for (const k of [...this.held]) this._keyUp(k);
  }

  _tapKey(k) {
    this._keyDown(k);
    this._keyUp(k);
  }

  /** Canvas-relative pixel position for the current aim point. */
  _aimPoint() {
    const r = this.canvas ? this.canvas.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
    return {
      x: r.left + this.aim.x * (r.width || 1),
      y: r.top + this.aim.y * (r.height || 1),
    };
  }

  _mouse(type) {
    if (!this.canvas) return;
    const p = this._aimPoint();
    const Ctor = this.win.MouseEvent || this.win.Event;
    this.canvas.dispatchEvent(new Ctor(type, {
      clientX: p.x, clientY: p.y, button: 0, buttons: type === 'mouseup' ? 0 : 1, bubbles: true,
    }));
  }

  /** A tap on the world: aim there, then click so the game acts on it. */
  shootAt(nx, ny) {
    this.aim.x = Math.max(0, Math.min(1, nx));
    this.aim.y = Math.max(0, Math.min(1, ny));
    this._mouse('mousemove');
    this._mouse('mousedown');
    this._mouse('mouseup');
  }

  fire(on) {
    if (on && !this.firing) { this.firing = true; this._mouse('mousemove'); this._mouse('mousedown'); }
    else if (!on && this.firing) { this.firing = false; this._mouse('mouseup'); }
  }

  // ------------------------------------------------------------------- mount
  mount(container = this.doc.body) {
    if (this.enabled || !this.doc) return this;
    const el = this.doc.createElement('div');
    el.className = 'm-touch';

    const actions = TOUCH_ACTIONS.map((a) => (
      `<button class="m-btn" data-do="${a.do}" title="${a.title}">${a.label}</button>`
    )).join('');

    el.innerHTML = `
      <div class="m-aim" data-pad="aim"></div>
      <div class="m-stick" data-pad="stick"><div class="m-knob"></div></div>
      <div class="m-actions">${actions}</div>
      <button class="m-btn m-fire" data-do="fire">FIRE</button>`;

    container.appendChild(el);
    container.classList.add('mtouch-on');
    this.root = el;
    this.enabled = true;

    /* ---- the aim pad: tap to act, drag to swing the camera/aim ---- */
    const pad = el.querySelector('[data-pad="aim"]');
    let drag = null;
    this._listen(pad, 'pointerdown', (e) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, at: Date.now() };
      pad.setPointerCapture && pad.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    this._listen(pad, 'pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const r = this.canvas.getBoundingClientRect();
      this.aim.x = Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1)));
      this.aim.y = Math.max(0, Math.min(1, (e.clientY - r.top) / (r.height || 1)));
      drag.moved += Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      drag.x = e.clientX; drag.y = e.clientY;
      this._mouse('mousemove');
      e.preventDefault();
    });
    const endAim = (e) => {
      if (!drag) return;
      const quickTap = drag.moved < 14 && Date.now() - drag.at < 400;
      drag = null;
      // a tap is a shot / a loot / a build placement; a drag was just aiming
      if (quickTap && e && e.clientX != null) {
        const r = this.canvas.getBoundingClientRect();
        this.shootAt((e.clientX - r.left) / (r.width || 1), (e.clientY - r.top) / (r.height || 1));
      }
    };
    this._listen(pad, 'pointerup', endAim);
    this._listen(pad, 'pointercancel', () => { drag = null; });

    /* ---- the stick: four synthetic keys, exactly what WASD does ---- */
    const stickEl = el.querySelector('[data-pad="stick"]');
    const knob = el.querySelector('.m-knob');
    const applyStick = (e) => {
      const r = stickEl.getBoundingClientRect();
      const max = (r.width || 120) / 2;
      let x = (e.clientX - (r.left + max)) / max;
      let y = (e.clientY - (r.top + max)) / max;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      this.stick.x = x; this.stick.y = y;
      knob.style.transform = `translate(${x * max * 0.6}px, ${y * max * 0.6}px)`;
      const dz = 0.28;
      if (y < -dz) this._keyDown(HOLD_KEYS.up); else this._keyUp(HOLD_KEYS.up);
      if (y > dz) this._keyDown(HOLD_KEYS.down); else this._keyUp(HOLD_KEYS.down);
      if (x < -dz) this._keyDown(HOLD_KEYS.left); else this._keyUp(HOLD_KEYS.left);
      if (x > dz) this._keyDown(HOLD_KEYS.right); else this._keyUp(HOLD_KEYS.right);
    };
    const releaseStick = () => {
      this.stick.x = 0; this.stick.y = 0;
      knob.style.transform = 'translate(0, 0)';
      this._releaseKeys();
    };
    this._listen(stickEl, 'pointerdown', (e) => {
      stickEl.setPointerCapture && stickEl.setPointerCapture(e.pointerId);
      applyStick(e);
      e.preventDefault();
    });
    this._listen(stickEl, 'pointermove', (e) => {
      if (e.buttons || e.pressure) applyStick(e);
    });
    this._listen(stickEl, 'pointerup', releaseStick);
    this._listen(stickEl, 'pointercancel', releaseStick);

    /* ---- the action cluster + fire ---- */
    for (const btn of el.querySelectorAll('[data-do]')) {
      const what = btn.dataset.do;
      this._listen(btn, 'pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('held');
        if (what === 'fire') this.fire(true);
        else {
          const action = TOUCH_ACTIONS.find((a) => a.do === what);
          if (action) this._tapKey(action.key);
        }
      });
      this._listen(btn, 'pointerup', (e) => {
        e.preventDefault();
        btn.classList.remove('held');
        if (what === 'fire') this.fire(false);
      });
      this._listen(btn, 'pointercancel', () => {
        btn.classList.remove('held');
        if (what === 'fire') this.fire(false);
      });
    }

    // leaving the tab mid-hold must not leave the car driving
    this._listen(this.win, 'blur', () => this.releaseAll());
    return this;
  }

  releaseAll() {
    this._releaseKeys();
    this.fire(false);
  }

  unmount(container = this.doc && this.doc.body) {
    this.releaseAll();
    for (const [target, type, fn] of this._bindings) target.removeEventListener(type, fn);
    this._bindings = [];
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    if (container && container.classList) container.classList.remove('mtouch-on');
    this.root = null;
    this.enabled = false;
  }
}

/** Mount on a phone, do nothing on a desktop. Returns the controller or null. */
export function autoMountTouch(opts = {}) {
  const win = opts.win || (typeof window !== 'undefined' ? window : null);
  if (!win || !touchSupported(win)) return null;
  const t = new GameTouch({ ...opts, win });
  t.mount();
  return t;
}
