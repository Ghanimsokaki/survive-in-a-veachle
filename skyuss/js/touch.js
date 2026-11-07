// Touch controls for phones and tablets: a left thumb-stick for throttle + yaw,
// a right drag-pad for the camera, and big thumb buttons for the actions.
// Pure DOM — the renderer only reads `state()` each frame.

export class TouchControls {
  constructor(opts = {}) {
    this.onAction = opts.onAction || (() => {});
    this.onOrbit = opts.onOrbit || (() => {});
    this.enabled = false;
    this.root = null;
    this.stick = { x: 0, y: 0 };     // -1..1, y negative = throttle up
    this.fireHeld = false;
    this.boostHeld = false;
    this.climb = 0;                  // +1 up, -1 dive
    this._drag = null;
    this._handlers = [];
  }

  /** Coarse pointer (phone/tablet) or an explicit ?touch=1 in the URL. */
  static isSupported(win = typeof window !== 'undefined' ? window : null) {
    if (!win) return false;
    try {
      if (/[?&]touch=1/.test(win.location.search)) return true;
      if (win.matchMedia && win.matchMedia('(pointer: coarse)').matches) return true;
    } catch (e) { /* fall through */ }
    return 'ontouchstart' in win;
  }

  mount(container = document.body) {
    if (this.enabled) return this;
    const doc = container.ownerDocument || document;
    const el = doc.createElement('div');
    el.className = 'touch-ui';
    el.innerHTML = `
      <div class="t-stick" data-pad="stick"><div class="t-knob"></div></div>
      <div class="t-look" data-pad="look">camera</div>
      <div class="t-buttons">
        <button class="t-btn t-fire" data-do="fire">FIRE</button>
        <button class="t-btn" data-do="torpedo">TORP</button>
        <button class="t-btn" data-do="warp">WARP</button>
        <button class="t-btn" data-do="interact">TRACTOR</button>
        <button class="t-btn" data-do="up">▲</button>
        <button class="t-btn" data-do="down">▼</button>
        <button class="t-btn" data-do="build">FORT</button>
        <button class="t-btn" data-do="tiers">REFIT</button>
      </div>`;
    container.appendChild(el);
    container.classList.add('touch-on');
    this.root = el;
    this.enabled = true;

    const stickEl = el.querySelector('[data-pad="stick"]');
    const knob = el.querySelector('.t-knob');
    const lookEl = el.querySelector('[data-pad="look"]');

    const stickMove = (e) => {
      const r = stickEl.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const max = r.width / 2;
      let x = (e.clientX - cx) / max;
      let y = (e.clientY - cy) / max;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      this.stick.x = x;
      this.stick.y = y;
      knob.style.transform = `translate(${x * max * 0.62}px, ${y * max * 0.62}px)`;
    };
    const stickEnd = () => {
      this.stick.x = 0; this.stick.y = 0;
      knob.style.transform = 'translate(0, 0)';
    };

    const bind = (target, type, fn, id) => {
      target.addEventListener(type, fn, id ? { pointerId: id } : undefined);
      this._handlers.push([target, type, fn]);
    };

    bind(stickEl, 'pointerdown', (e) => {
      stickEl.setPointerCapture && stickEl.setPointerCapture(e.pointerId);
      stickMove(e);
      e.preventDefault();
    });
    bind(stickEl, 'pointermove', (e) => {
      if (e.buttons || e.pressure) stickMove(e);
    });
    bind(stickEl, 'pointerup', stickEnd);
    bind(stickEl, 'pointercancel', stickEnd);

    bind(lookEl, 'pointerdown', (e) => {
      lookEl.setPointerCapture && lookEl.setPointerCapture(e.pointerId);
      this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      e.preventDefault();
    });
    bind(lookEl, 'pointermove', (e) => {
      if (!this._drag || this._drag.id !== e.pointerId) return;
      this.onOrbit(e.clientX - this._drag.x, e.clientY - this._drag.y);
      this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    const endDrag = () => { this._drag = null; };
    bind(lookEl, 'pointerup', endDrag);
    bind(lookEl, 'pointercancel', endDrag);

    for (const btn of el.querySelectorAll('[data-do]')) {
      const doWhat = btn.dataset.do;
      const isHold = doWhat === 'fire' || doWhat === 'up' || doWhat === 'down';
      bind(btn, 'pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('held');
        if (doWhat === 'fire') this.fireHeld = true;
        else if (doWhat === 'up') this.climb = 1;
        else if (doWhat === 'down') this.climb = -1;
        else this.onAction(doWhat);
      });
      bind(btn, 'pointerup', (e) => {
        e.preventDefault();
        btn.classList.remove('held');
        if (doWhat === 'fire') this.fireHeld = false;
        else if (doWhat === 'up' && this.climb === 1) this.climb = 0;
        else if (doWhat === 'down' && this.climb === -1) this.climb = 0;
      });
      if (isHold) {
        bind(btn, 'pointercancel', () => {
          btn.classList.remove('held');
          if (doWhat === 'fire') this.fireHeld = false;
          else this.climb = 0;
        });
      }
    }
    return this;
  }

  unmount(container = document.body) {
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    if (container && container.classList) container.classList.remove('touch-on');
    this.root = null;
    this.enabled = false;
  }

  /** The input fragment the simulation consumes, shaped like the keyboard one. */
  state() {
    if (!this.enabled) return null;
    const deadzone = 0.18;
    const y = this.stick.y;
    const x = this.stick.x;
    return {
      forward: y < -deadzone,
      back: y > deadzone,
      yaw: Math.abs(x) > deadzone ? -x : 0,
      pitch: 0,
      up: this.climb > 0,
      down: this.climb < 0,
      boost: this.boostHeld,
      fire: this.fireHeld,
      torpedo: false,
    };
  }
}
