// SKYUSS audio: everything is synthesised with the WebAudio API — no asset
// files at all. Every call is a no-op when audio is unavailable or muted, so
// this module is safe to import anywhere (including headless tests).

export class SkyAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.55;
    this.engineNodes = null;
    this.noiseBuffer = null;
    this._lastUi = 0;
  }

  /** Must be called from a user gesture (browsers block audio otherwise). */
  init() {
    if (this.ctx) { this.resume(); return this; }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return this;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoise(2);
      this.engineNodes = this.makeEngine();
    } catch (e) {
      this.ctx = null;
    }
    return this;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
    if (!on && this.engineNodes) this.engineNodes.gain.gain.value = 0;
    return this.enabled;
  }

  toggle() { return this.setEnabled(!this.enabled); }

  get ready() { return !!this.ctx && this.enabled; }

  // ------------------------------------------------------------------ helpers
  makeNoise(seconds) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  tone(freq, dur, type = 'sine', gain = 0.2, slideTo = null, delay = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(dur, gain = 0.2, filterType = 'bandpass', freq = 900, q = 1, slideTo = null) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, t0);
    if (slideTo) filter.frequency.exponentialRampToValueAtTime(Math.max(60, slideTo), t0 + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** Continuous engine drone: pitch and timbre follow throttle and boost. */
  makeEngine() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 42;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = Math.round(42 / 2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(lp);
    sub.connect(lp);
    lp.connect(gain);
    gain.connect(this.master);
    osc.start();
    sub.start();
    return { osc, sub, lp, gain };
  }

  /** speed01: 0..1 of top speed. boost: 0..1. warp: boolean. */
  engine(speed01, boost = 0, warp = false) {
    if (!this.ctx || !this.engineNodes) return;
    const e = this.engineNodes;
    const t = this.ctx.currentTime;
    const target = this.enabled ? 0.05 + speed01 * 0.09 + boost * 0.05 : 0;
    e.gain.gain.setTargetAtTime(target, t, 0.15);
    e.osc.frequency.setTargetAtTime(38 + speed01 * 46 + (warp ? 60 : 0), t, 0.2);
    e.lp.frequency.setTargetAtTime(280 + speed01 * 900 + (warp ? 900 : 0), t, 0.2);
  }

  silenceEngine() {
    if (this.engineNodes) this.engineNodes.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  // ------------------------------------------------------------------ effects
  phaser() {
    if (!this.ready) return;
    this.tone(880 + Math.random() * 120, 0.16, 'square', 0.05, 180);
    this.noise(0.09, 0.05, 'highpass', 2200, 1);
  }
  torpedo() {
    if (!this.ready) return;
    this.tone(180, 0.5, 'sawtooth', 0.1, 60);
    this.noise(0.5, 0.12, 'lowpass', 900, 1, 200);
  }
  explosion(size = 1) {
    if (!this.ready) return;
    const g = Math.min(0.4, 0.14 * size);
    this.noise(0.55 + size * 0.2, g, 'lowpass', 1400, 0.8, 90);
    this.tone(90, 0.5, 'sine', g * 0.5, 40);
  }
  hit() {
    if (!this.ready) return;
    this.noise(0.22, 0.16, 'bandpass', 700, 2, 200);
    this.tone(320, 0.18, 'triangle', 0.08, 120);
  }
  warp() {
    if (!this.ready) return;
    this.tone(120, 0.9, 'sawtooth', 0.12, 1400);
    this.noise(0.9, 0.1, 'bandpass', 400, 1.2, 3200);
  }
  pickup() {
    if (!this.ready) return;
    this.tone(660, 0.1, 'sine', 0.06, 990);
  }
  build() {
    if (!this.ready) return;
    this.tone(220, 0.12, 'square', 0.05, 330);
    this.tone(440, 0.1, 'sine', 0.04, 660, 0.06);
  }
  upgrade() {
    if (!this.ready) return;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.07, f, i * 0.08));
  }
  alarm() {
    if (!this.ready) return;
    this.tone(520, 0.22, 'square', 0.07, 380);
    this.tone(520, 0.22, 'square', 0.07, 380, 0.3);
  }
  ui() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this._lastUi < 0.04) return;
    this._lastUi = now;
    this.tone(720, 0.05, 'sine', 0.03, 860);
  }
}
