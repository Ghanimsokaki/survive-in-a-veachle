// Home on Wheels — sound engine.
//
// Everything is synthesised at runtime with WebAudio: there are no audio files
// in this repo. The old sfx were single oscillators; this module adds
//   * a proper master chain (gain -> compressor -> speakers) and a reverb bus
//     built from a generated impulse response,
//   * continuous voices that follow the simulation: a three-oscillator engine,
//     tyre/road noise, timber rattle, wind, night crickets and tornado rumble,
//   * layered one-shots (noise + tone + sub) with stereo position,
// and it stays completely silent (and harmless) when there is no AudioContext,
// which is why the whole headless test suite can run it.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const now = (ctx) => ctx.currentTime;

export const Sfx = {
  ctx: null,
  master: null,
  comp: null,
  verb: null,
  verbSend: null,
  noiseBuf: null,
  muted: false,
  volume: 0.6,
  engine: null,
  road: null,
  wind: null,
  rumble: null,
  clatterT: 0,
  cricketT: 0,
  lightningT: 8,

  // ---------------------------------------------------------------- setup
  init() {
    if (this.ctx) return true;
    if (this.dead) return false;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = new AC();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;

      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -16;
      this.comp.knee.value = 22;
      this.comp.ratio.value = 5;
      this.comp.attack.value = 0.004;
      this.comp.release.value = 0.22;
      this.master.connect(this.comp).connect(ctx.destination);

      // reverb: a generated impulse response, fed from a send bus
      this.verb = ctx.createConvolver();
      this.verb.buffer = this._impulse(1.9, 2.6);
      const verbGain = ctx.createGain();
      verbGain.gain.value = 0.55;
      this.verbSend = ctx.createGain();
      this.verbSend.gain.value = 1;
      this.verbSend.connect(this.verb).connect(verbGain).connect(this.master);

      this.noiseBuf = this._noise(2.2);
      return true;
    } catch (e) {
      this.ctx = null;
      this.dead = true;
      return false;
    }
  },

  get ready() { return !!this.ctx; },

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },

  _noise(seconds) {
    const ctx = this.ctx;
    const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  },

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  },

  // ---------------------------------------------------------------- routing helpers
  _out(pan) {
    const ctx = this.ctx;
    if (!pan || !ctx.createStereoPanner) return this.master;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    return p;
  },

  _send(node, amount) {
    if (!this.verbSend || !amount) return;
    const g = this.ctx.createGain();
    g.gain.value = amount;
    node.connect(g).connect(this.verbSend);
  },

  // ---------------------------------------------------------------- primitives
  // A filtered noise burst: hits, impacts, skids, wind.
  noise({ dur = 0.12, type = 'bandpass', freq = 900, q = 1, vol = 0.15, pan = 0,
    slide = 0, attack = 0.004, send = 0, loop = false } = {}) {
    if (!this.ctx || this.muted) return null;
    try {
      const ctx = this.ctx, t0 = now(ctx);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = loop;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq, t0);
      if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f).connect(g).connect(this._out(pan));
      this._send(g, send);
      src.start(t0, Math.random() * 1.2);
      src.stop(t0 + dur + 0.05);
      return { src, gain: g, filter: f };
    } catch (e) { return null; }
  },

  // A pitched blip; `slide` is an absolute target frequency.
  tone(freq = 440, dur = 0.08, type = 'square', vol = 0.12, slide = 0, pan = 0, send = 0) {
    if (!this.ctx || this.muted) return null;
    try {
      const ctx = this.ctx, t0 = now(ctx);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, freq), t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide > 0 && slide < 20000 ? slide : freq + slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this._out(pan));
      this._send(g, send);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
      return { osc: o, gain: g };
    } catch (e) { return null; }
  },

  // A deep sub thump used under explosions and heavy hits.
  sub(freq = 70, dur = 0.4, vol = 0.2, pan = 0) {
    return this.tone(freq, dur, 'sine', vol, freq * 0.45, pan, 0.1);
  },

  // ---------------------------------------------------------------- continuous voices
  engineOn() {
    if (!this.init() || this.engine) return;
    try {
      const ctx = this.ctx;
      const t0 = now(ctx);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      lp.Q.value = 4;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      const oscs = [];
      const specs = [
        ['sawtooth', 42, 0.55],
        ['square', 84, 0.22],
        ['sine', 21, 0.5],
      ];
      for (const [type, freq, level] of specs) {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        og.gain.value = level;
        o.connect(og).connect(lp);
        o.start(t0);
        oscs.push(o);
      }
      lp.connect(g).connect(this.master);
      this.engine = { lp, g, oscs, t: t0 };
    } catch (e) {
      this.engine = null;
    }
  },

  engineOff() {
    try {
      if (this.engine) {
        for (const o of this.engine.oscs) { try { o.stop(); } catch (e) { /* ok */ } }
        this.engine = null;
      }
      for (const key of ['road', 'wind', 'rumble']) {
        const v = this[key];
        if (v) {
          for (const s of v.sources) { try { s.stop(); } catch (e) { /* ok */ } }
          this[key] = null;
        }
      }
    } catch (e) { /* ignore */ }
  },

  _loopNoise({ type = 'bandpass', freq = 600, q = 1, gain = 0.0001 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(now(ctx), Math.random() * 1.4);
    return { sources: [src], filter: f, gain: g };
  },

  _ensureBeds() {
    if (!this.ctx) return;
    try {
      if (!this.road) this.road = this._loopNoise({ type: 'bandpass', freq: 520, q: 0.9, gain: 0.0001 });
      if (!this.wind) this.wind = this._loopNoise({ type: 'lowpass', freq: 420, q: 0.7, gain: 0.0001 });
      if (!this.rumble) this.rumble = this._loopNoise({ type: 'lowpass', freq: 90, q: 1.2, gain: 0.0001 });
    } catch (e) { /* ignore */ }
  },

  // Called from the game loop: drive the continuous voices from the sim state.
  update(dt, s = {}) {
    if (!this.ctx) return;
    try {
      this._ensureBeds();
      const t = now(this.ctx);
      const k = Math.max(0.03, Math.min(0.3, dt || 0.016));
      const speed = Math.abs(s.speed || 0);
      const norm = clamp01(speed / 170);
      const th = clamp01(Math.abs(s.throttle || 0));
      const moving = norm > 0.02;

      if (this.engine) {
        const base = 36 + norm * 74 + th * 9;
        const freqs = [base, base * 2.01, base * 0.5];
        this.engine.oscs.forEach((o, i) => {
          try { o.frequency.setTargetAtTime(Math.max(12, freqs[i]), t, k); } catch (e) { /* ok */ }
        });
        this.engine.lp.frequency.setTargetAtTime(240 + norm * 1100 + th * 260, t, k);
        const lvl = this.muted ? 0.0001 : 0.035 + norm * 0.085 + th * 0.03;
        this.engine.g.gain.setTargetAtTime(lvl, t, k);
      }
      if (this.road) {
        this.road.filter.frequency.setTargetAtTime(300 + norm * 900, t, k);
        this.road.gain.gain.setTargetAtTime(this.muted ? 0.0001 : 0.004 + norm * 0.05, t, k);
      }
      if (this.wind) {
        const windy = (s.night || 0) > 0.45 ? 0.03 : 0.012;
        this.wind.gain.gain.setTargetAtTime(this.muted ? 0.0001 : windy, t, 0.4);
        this.wind.filter.frequency.setTargetAtTime(320 + Math.sin(t * 0.3) * 140, t, 0.5);
      }
      if (this.rumble) {
        const d = s.tornadoDist == null ? 9999 : s.tornadoDist;
        const near = clamp01(1 - d / 900);
        this.rumble.gain.gain.setTargetAtTime(this.muted ? 0.0001 : near * 0.11, t, 0.3);
        this.rumble.filter.frequency.setTargetAtTime(60 + near * 90, t, 0.4);
      }

      // timber rattle: little knocks while rolling over rough road
      this.clatterT -= dt || 0.016;
      if (moving && !this.muted && this.clatterT <= 0) {
        this.clatterT = 0.11 + Math.random() * 0.22 / (0.25 + norm);
        this.noise({ dur: 0.05, type: 'bandpass', freq: 620 + Math.random() * 500, q: 3.5,
          vol: 0.01 + norm * 0.035, pan: Math.sin(t * 3.1) * 0.35, slide: -260 });
      }

      // night crickets
      if ((s.night || 0) > 0.55) {
        this.cricketT -= dt || 0.016;
        if (this.cricketT <= 0) {
          this.cricketT = 0.55 + Math.random() * 1.5;
          const pan = Math.random() * 1.6 - 0.8;
          for (let i = 0; i < 3; i++) {
            setTimeout(() => this.tone(3200 + Math.random() * 700, 0.035, 'sine', 0.012, 0, pan), i * 55);
          }
        }
      }

      // distant lightning now and then
      this.lightningT -= dt || 0.016;
      if (this.lightningT <= 0) {
        this.lightningT = 14 + Math.random() * 26;
        if (!this.muted) this.thunder();
      }

      // hard turns squeal a little
      const skid = norm > 0.35 && Math.abs(s.steer || 0) > 0.55;
      if (skid && !this.muted && Math.random() < 0.25) {
        this.noise({ dur: 0.22, type: 'bandpass', freq: 2100, q: 7, vol: 0.05 * norm, slide: -900 });
      }
    } catch (e) { /* audio must never break the frame */ }
  },

  // ---------------------------------------------------------------- one-shots
  shoot() {
    this.noise({ dur: 0.07, type: 'highpass', freq: 1400, vol: 0.09, slide: -700, pan: 0.1 });
    this.tone(280, 0.09, 'triangle', 0.06, 90);
  },
  turret() {
    this.noise({ dur: 0.05, type: 'bandpass', freq: 1900, q: 2, vol: 0.05, pan: -0.2 });
    this.tone(620, 0.06, 'sawtooth', 0.03, 260);
  },
  hit() {
    this.noise({ dur: 0.14, type: 'bandpass', freq: 2400, q: 7, vol: 0.1, slide: -1400 });
    this.tone(520, 0.12, 'triangle', 0.07, 180);
  },
  boom(pan = 0) {
    this.noise({ dur: 0.55, type: 'lowpass', freq: 1300, q: 0.8, vol: 0.3, slide: -1150, pan, send: 0.35 });
    this.sub(84, 0.5, 0.26, pan);
    this.noise({ dur: 0.08, type: 'highpass', freq: 3200, vol: 0.12, pan });
  },
  explode(pan = 0) { this.boom(pan); },
  loot() {
    this.tone(1180, 0.1, 'sine', 0.07, 0, 0.15, 0.2);
    setTimeout(() => this.tone(1760, 0.16, 'sine', 0.055, 0, 0.15, 0.25), 55);
    this.noise({ dur: 0.05, type: 'highpass', freq: 5200, vol: 0.03 });
  },
  craft() {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.noise({ dur: 0.06, type: 'bandpass', freq: 780 + i * 120, q: 4, vol: 0.09, slide: -300 }), i * 70);
    }
    setTimeout(() => this.tone(330, 0.16, 'triangle', 0.05, 660), 190);
  },
  build() {
    this.noise({ dur: 0.1, type: 'bandpass', freq: 520, q: 3, vol: 0.12, slide: -220 });
    this.tone(124, 0.12, 'sine', 0.09, 88);
  },
  error() {
    this.tone(196, 0.09, 'square', 0.05);
    setTimeout(() => this.tone(147, 0.13, 'square', 0.045), 95);
  },
  click() {
    this.noise({ dur: 0.03, type: 'bandpass', freq: 1600, q: 2, vol: 0.05, slide: -600 });
  },
  travel() {
    [392, 523, 659, 784, 1046].forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.2, 'triangle', 0.06, 0, 0, 0.35), i * 105);
    });
  },
  horn() {
    // a two-tone brass horn, Dead Rails style
    if (!this.ctx || this.muted) return;
    try {
      const ctx = this.ctx, t0 = now(ctx);
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.05);
      g.gain.setValueAtTime(0.16, t0 + 0.55);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.95);
      for (const [f, lvl] of [[233, 0.6], [311, 0.4], [466, 0.18]]) {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * 0.96, t0);
        o.frequency.linearRampToValueAtTime(f, t0 + 0.08);
        og.gain.value = lvl;
        o.connect(og).connect(lp);
        o.start(t0);
        o.stop(t0 + 1);
      }
      lp.connect(g).connect(this.master);
      this._send(g, 0.45);
    } catch (e) { /* ignore */ }
  },
  skid() {
    this.noise({ dur: 0.45, type: 'bandpass', freq: 2300, q: 8, vol: 0.09, slide: -1500, pan: 0.1 });
  },
  gear() {
    this.noise({ dur: 0.06, type: 'bandpass', freq: 420, q: 5, vol: 0.07, slide: -160 });
    this.tone(92, 0.09, 'square', 0.04, 70);
  },
  hurt() {
    this.noise({ dur: 0.3, type: 'lowpass', freq: 900, q: 1.2, vol: 0.22, slide: -700 });
    this.tone(150, 0.18, 'sawtooth', 0.08, 70);
  },
  thunder() {
    this.noise({ dur: 2.4, type: 'lowpass', freq: 320, q: 0.6, vol: 0.1, slide: -220, send: 0.5, attack: 0.25 });
  },
  victory() {
    [523, 659, 784, 1046].forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.3, 'triangle', 0.07, 0, 0, 0.4), i * 160);
    });
  },
  defeat() {
    [392, 330, 262, 196].forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.36, 'sawtooth', 0.05, 0, 0, 0.3), i * 190);
    });
  },

  // ---------------------------------------------------------------- mixer
  setVolume(v) {
    this.volume = clamp01(v);
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    try { localStorage.setItem('how_volume', String(this.volume)); } catch (e) { /* ok */ }
  },
  setMuted(m) {
    this.muted = !!m;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    try { localStorage.setItem('how_muted', this.muted ? '1' : '0'); } catch (e) { /* ok */ }
    return this.muted;
  },
  toggleMute() {
    this.init();
    return this.setMuted(!this.muted);
  },
  loadPrefs() {
    try {
      const v = parseFloat(localStorage.getItem('how_volume'));
      if (Number.isFinite(v)) this.volume = clamp01(v);
      this.muted = localStorage.getItem('how_muted') === '1';
    } catch (e) { /* ok */ }
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  },
};

Sfx.loadPrefs();
