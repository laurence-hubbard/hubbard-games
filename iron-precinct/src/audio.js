// Tiny synthesized sound effects — no audio files needed.
const MIN_GAP = { shoot: 0.05, hit: 0.04, enemyShoot: 0.07, explosion: 0.06 };

export class Sfx {
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.last = {};
  }

  play(name) {
    const c = this.ctx;
    if (!c) return;
    const now = c.currentTime;
    const gap = MIN_GAP[name] ?? 0.02;
    if (this.last[name] !== undefined && now - this.last[name] < gap) return;
    this.last[name] = now;
    switch (name) {
      case 'shoot': this.tone('square', 900, 240, 0.07, 0.09); break;
      case 'enemyShoot': this.tone('sawtooth', 320, 110, 0.14, 0.05); break;
      case 'hit': this.tone('triangle', 1500, 600, 0.04, 0.07); break;
      case 'missile': this.noise(0.35, 0.15, 3500, 500); this.tone('sawtooth', 180, 520, 0.3, 0.04); break;
      case 'explosion': this.noise(0.6, 0.45, 1400, 80); this.tone('sine', 130, 30, 0.5, 0.35); break;
      case 'bigExplosion': this.noise(1.6, 0.7, 900, 40); this.tone('sine', 90, 20, 1.4, 0.6); break;
      case 'hurt': this.tone('sawtooth', 170, 60, 0.2, 0.18); break;
      case 'transform':
        this.tone('square', 200, 900, 0.25, 0.06);
        this.tone('square', 300, 1300, 0.25, 0.04, 0.05);
        break;
      case 'pickup': [660, 880, 1320].forEach((f, i) => this.tone('triangle', f, f, 0.09, 0.12, i * 0.06)); break;
      case 'alarm': for (let i = 0; i < 3; i++) this.tone('sawtooth', 520, 880, 0.35, 0.08, i * 0.45); break;
      case 'jammerDown': this.tone('sine', 900, 120, 0.8, 0.2); break;
    }
  }

  tone(type, f0, f1, dur, vol, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, vol, f0, f1) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}
