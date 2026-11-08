// SKYUSS audio — everything synthesised with WebAudio, no asset files.
//
// The first version wired oscillators straight into the master gain: square and
// sawtooth waves at full bandwidth, no envelope shaping beyond a hard exponential
// fade, no headroom, and twenty overlapping shots clipped the output into a fizz.
// This version keeps the same public API but gives it a real signal chain:
//
//     voice → lowpass → panner ─┬→ sfx bus ─┐
//                               └→ send ────┴→ reverb ─┐
//                                                      ├→ master → compressor → out
//     engine ────────────────────────────────────────────┘
//
// Practically that means: a compressor catches stacked explosions instead of
// clipping, a generated impulse response puts the ship in a space, every voice is
// filtered and stereo-placed, envelopes have a soft attack (no click at the
// start), and a voice cap keeps a 200-hostile siege from spawning 600 nodes.
// Every call is still a no-op when audio is unavailable or muted, so the module
// imports safely in headless tests.

export class SkyAudio {
  constructor() {
    this.ctx = null;
    this.master = null;       // final gain (volume / mute)
    this.comp = null;         // limiter-ish compressor
    this.sfx = null;          // dry bus for one-shots
    this.send = null;         // reverb send
    this.wet = null;          // reverb return
    this.reverb = null;
    this.engineNodes = null;
    this.noiseBuffer = null;
    this.enabled = true;
    this._volume = 0.55;
    this._lastUi = 0;
    this._panFlip = 1;
    this._voices = [];        // end timestamps, for the voice cap
    this._maxVoices = 28;
  }

  get volume() { return this._volume; }
  get ready() { return !!this.ctx && this.enabled; }

  /** Must be called from a user gesture (browsers block audio otherwise). */
  init() {
    if (this.ctx) { this.resume(); return this; }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return this;
    try {
      const ctx = new AC();
      this.ctx = ctx;

      // ---- master chain: headroom first, then the compressor
      this.master = ctx.createGain();
      this.master.gain.value = this.enabled ? this._volume : 0;

      if (typeof ctx.createDynamicsCompressor === 'function') {
        this.comp = ctx.createDynamicsCompressor();
        this.comp.threshold.value = -16;
        this.comp.knee.value = 22;
        this.comp.ratio.value = 7;
        this.comp.attack.value = 0.004;
        this.comp.release.value = 0.22;
        this.master.connect(this.comp);
        this.comp.connect(ctx.destination);
      } else {
        this.master.connect(ctx.destination);
      }

      // ---- reverb: a generated impulse, so nothing is loaded from disk
      if (typeof ctx.createConvolver === 'function') {
        this.reverb = ctx.createConvolver();
        this.reverb.buffer = this.makeImpulse(1.9, 2.6);
        this.wet = ctx.createGain();
        this.wet.gain.value = 0.26;
        this.send = ctx.createGain();
        this.send.gain.value = 0.4;
        this.send.connect(this.reverb);
        this.reverb.connect(this.wet);
        this.wet.connect(this.master);
      }

      this.sfx = ctx.createGain();
      this.sfx.gain.value = 1;
      this.sfx.connect(this.master);

      this.noiseBuffer = this.makeNoise(2);
      this.engineNodes = this.makeEngine();
    } catch (e) {
      this.ctx = null;
      this.sfx = null;
    }
    return this;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? this._volume : 0, this.ctx.currentTime, 0.03);
    }
    if (!on && this.engineNodes) this.engineNodes.gain.gain.value = 0;
    return this.enabled;
  }

  toggle() { return this.setEnabled(!this.enabled); }

  /** 0…1. Kept separate from mute so the slider survives a mute toggle. */
  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.enabled ? this._volume : 0, this.ctx.currentTime, 0.05);
    }
    return this._volume;
  }

  // ------------------------------------------------------------------ helpers
  makeNoise(seconds) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Exponentially decaying noise = a passable plate reverb, for free. */
  makeImpulse(seconds = 1.8, decay = 2.4) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c += 1) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i += 1) {
        const t = i / len;
        // slight pre-delay shape, then exponential tail
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * Math.min(1, t * 18);
      }
    }
    return buf;
  }

  _room() {
    const now = this.ctx.currentTime;
    if (this._voices.length > 40) this._voices = this._voices.filter((t) => t > now);
    if (this._voices.length >= this._maxVoices) return false;
    return true;
  }

  _track(end) { this._voices.push(end); }

  /** Stereo place a source; alternating by default so shots fan out. */
  _panner(pan) {
    if (typeof this.ctx.createStereoPanner !== 'function') return null;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    return p;
  }

  /**
   * One oscillator voice.
   * @param {object} o freq, dur, type, gain, slideTo, delay, pan, cut, q, detune, send, attack
   */
  tone(freq, dur, type = 'sine', gain = 0.2, slideTo = null, delay = 0, o = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    if (!this._room()) return;
    this._track(t0 + dur + 0.05);

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (o.detune) osc.detune.value = o.detune;
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);

    let node = osc;
    if (o.cut) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(o.cut, t0);
      if (o.cutTo) lp.frequency.exponentialRampToValueAtTime(Math.max(80, o.cutTo), t0 + dur);
      lp.Q.value = o.q == null ? 1 : o.q;
      node.connect(lp);
      node = lp;
    }

    const g = ctx.createGain();
    const atk = Math.max(0.003, Math.min(dur * 0.4, o.attack == null ? 0.006 : o.attack));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + atk);            // linear attack: no click
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g);

    const pan = o.pan == null ? 0 : o.pan;
    const p = pan ? this._panner(pan) : null;
    if (p) { g.connect(p); p.connect(this.sfx); if (this.send) p.connect(this.send); }
    else { g.connect(this.sfx); if (this.send) g.connect(this.send); }

    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** One filtered noise voice — impacts, thrust, risers, clicks. */
  noise(dur, gain = 0.2, filterType = 'bandpass', freq = 900, q = 1, slideTo = null, o = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (o.delay || 0);
    if (!this._room()) return;
    this._track(t0 + dur + 0.05);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = o.rate == null ? 1 : o.rate;
    if (typeof src.loop === 'boolean') src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, t0);
    if (slideTo) filter.frequency.exponentialRampToValueAtTime(Math.max(60, slideTo), t0 + dur);
    filter.Q.value = q;

    const g = ctx.createGain();
    const atk = Math.max(0.002, Math.min(dur * 0.5, o.attack == null ? 0.004 : o.attack));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter);
    filter.connect(g);

    const p = o.pan ? this._panner(o.pan) : null;
    if (p) { g.connect(p); p.connect(this.sfx); if (this.send) p.connect(this.send); }
    else { g.connect(this.sfx); if (this.send) g.connect(this.send); }

    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  /** Continuous engine bed: filtered saw + sub + an airy noise layer. */
  makeEngine() {
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.value = 0;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 42;

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 21;

    const whine = ctx.createOscillator();
    whine.type = 'sine';
    whine.frequency.value = 210;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.05;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    lp.Q.value = 1.4;

    // air/thrust layer
    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuffer;
    if (typeof air.loop === 'boolean') air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 620;
    airFilter.Q.value = 0.7;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.35;

    osc.connect(lp);
    sub.connect(lp);
    whine.connect(whineGain);
    whineGain.connect(bus);
    lp.connect(bus);
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(bus);
    bus.connect(this.sfx);

    osc.start();
    sub.start();
    whine.start();
    air.start();
    return { osc, sub, whine, whineGain, lp, airFilter, bus, gain: bus };
  }

  /** speed01: 0..1 of top speed. boost: 0..1. warp: boolean. */
  engine(speed01 = 0, boost = 0, warp = false) {
    if (!this.ctx || !this.engineNodes) return;
    const e = this.engineNodes;
    const t = this.ctx.currentTime;
    const s = Math.max(0, Math.min(1, speed01));
    const target = this.enabled ? 0.035 + s * 0.075 + boost * 0.035 : 0;
    e.bus.gain.setTargetAtTime(target, t, 0.15);
    e.osc.frequency.setTargetAtTime(38 + s * 44, t, 0.2);
    e.sub.frequency.setTargetAtTime(19 + s * 22, t, 0.2);
    e.whine.frequency.setTargetAtTime(180 + s * 260 + (warp ? 520 : 0), t, 0.2);
    e.whineGain.gain.setTargetAtTime(warp ? 0.09 : 0.035 + s * 0.02, t, 0.2);
    e.lp.frequency.setTargetAtTime(300 + s * 700 + (warp ? 1100 : 0), t, 0.2);
    e.airFilter.frequency.setTargetAtTime(480 + s * 900 + (warp ? 900 : 0), t, 0.25);
  }

  silenceEngine() {
    if (this.engineNodes && this.ctx) {
      this.engineNodes.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    }
  }

  // ------------------------------------------------------------------ effects
  phaser() {
    if (!this.ready) return;
    this._panFlip *= -1;
    const pan = 0.32 * this._panFlip;
    const f = 1500 + Math.random() * 260;
    this.tone(f, 0.13, 'sine', 0.075, f * 0.28, 0, { cut: 3600, q: 2, pan, attack: 0.004, send: 0.25 });
    this.tone(f * 0.5, 0.1, 'triangle', 0.04, f * 0.2, 0.004, { pan: -pan, cut: 2200 });
    this.noise(0.05, 0.02, 'highpass', 3200, 1, null, { pan });
  }

  torpedo() {
    if (!this.ready) return;
    this.tone(150, 0.42, 'sine', 0.16, 44, 0, { cut: 900, cutTo: 260, attack: 0.01, send: 0.3 });
    this.noise(0.4, 0.1, 'lowpass', 1300, 1.4, 180, { attack: 0.02, send: 0.35 });
    this.noise(0.12, 0.05, 'bandpass', 2200, 3, 1200, { delay: 0.02 });
  }

  explosion(size = 1) {
    if (!this.ready) return;
    const k = Math.max(0.5, Math.min(2, size));
    const g = Math.min(0.34, 0.12 * k);
    // body: filtered noise burst with a long tail into the reverb
    this.noise(0.5 + 0.25 * k, g, 'lowpass', 1500 * k, 0.9, 120, { attack: 0.006, send: 0.75, rate: 0.85 + Math.random() * 0.3 });
    // sub drop
    this.tone(78 * k, 0.55 + 0.2 * k, 'sine', g * 0.85, 26, 0, { attack: 0.008, send: 0.4 });
    // debris crack
    this.noise(0.16, g * 0.5, 'bandpass', 2600, 1.6, 900, { delay: 0.05, pan: 0.2 });
    this.noise(0.13, g * 0.35, 'bandpass', 1900, 1.6, 700, { delay: 0.11, pan: -0.25 });
  }

  hit() {
    if (!this.ready) return;
    this.noise(0.16, 0.09, 'bandpass', 2400, 6, 1500, { attack: 0.002, send: 0.2 });
    this.tone(210, 0.16, 'triangle', 0.06, 90, 0, { cut: 1400, attack: 0.004, send: 0.15 });
  }

  warp() {
    if (!this.ready) return;
    this.noise(0.95, 0.11, 'bandpass', 320, 4, 4200, { attack: 0.15, send: 0.6, rate: 1 });
    this.tone(90, 0.9, 'sine', 0.09, 640, 0, { attack: 0.12, send: 0.5 });
    this.tone(180, 0.85, 'triangle', 0.05, 1280, 0.06, { attack: 0.12, send: 0.5 });
    this.tone(1320, 0.4, 'sine', 0.03, 2400, 0.5, { attack: 0.05, send: 0.7 });
  }

  pickup() {
    if (!this.ready) return;
    this.tone(880, 0.22, 'sine', 0.055, 900, 0, { attack: 0.006, send: 0.4 });
    this.tone(1320, 0.24, 'sine', 0.035, 1330, 0.02, { attack: 0.008, send: 0.4 });
    this.noise(0.04, 0.02, 'highpass', 4200, 0.8);
  }

  build() {
    if (!this.ready) return;
    this.tone(330, 0.16, 'triangle', 0.06, 330, 0, { cut: 1800, attack: 0.004, send: 0.3 });
    this.tone(495, 0.2, 'triangle', 0.05, 495, 0.09, { cut: 2200, attack: 0.006, send: 0.3 });
  }

  upgrade() {
    if (!this.ready) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone(f, 0.3, 'triangle', 0.055, f, i * 0.085, { cut: 3400, attack: 0.008, send: 0.45 });
      this.tone(f * 2, 0.22, 'sine', 0.02, f * 2, i * 0.085 + 0.01, { send: 0.5 });
    });
  }

  alarm() {
    if (!this.ready) return;
    for (let i = 0; i < 2; i += 1) {
      this.tone(560, 0.2, 'square', 0.045, 470, i * 0.26, { cut: 1500, q: 1.2, attack: 0.02, send: 0.25 });
      this.tone(280, 0.22, 'sine', 0.03, 240, i * 0.26, { attack: 0.02, send: 0.3 });
    }
  }

  ui() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this._lastUi < 0.035) return;
    this._lastUi = now;
    this.tone(880, 0.05, 'sine', 0.028, 980, 0, { attack: 0.002 });
    this.noise(0.03, 0.015, 'highpass', 3600, 0.7, null, { attack: 0.001 });
  }

  /** A short, deliberately quiet sting for big moments (buying a hull, credits). */
  chime() {
    if (!this.ready) return;
    [659.25, 880, 1318.5].forEach((f, i) => {
      this.tone(f, 0.5, 'sine', 0.05, f, i * 0.1, { attack: 0.01, send: 0.7 });
    });
  }

  /** How many voices were scheduled — the smoke test uses this to spot leaks. */
  get voiceCount() {
    if (!this.ctx) return 0;
    const now = this.ctx.currentTime;
    this._voices = this._voices.filter((t) => t > now);
    return this._voices.length;
  }
}
