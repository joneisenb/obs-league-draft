// Draft soundtrack engine (Web Audio).
// - One loop per phase; switching happens on the next bar line, so it stays in time.
// - Loops are started at the same position in the shared timeline, so layered stems
//   of equal length stay in phase when you swap between them.
// - SFX are one-shots. Missing SFX files fall back to simple test blips.

export class DraftAudio {
  constructor(cfg) {
    this.cfg = cfg;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.music = this.ctx.createGain(); this.music.gain.value = cfg.musicVolume; this.music.connect(this.ctx.destination);
    this.fx = this.ctx.createGain();    this.fx.gain.value = cfg.sfxVolume;      this.fx.connect(this.ctx.destination);
    this.buffers = {};
    this.current = null;     // { phase, src, gain }
    this.t0 = null;          // timeline origin (ctx time of first bar)
    this.barLen = (60 / cfg.bpm) * cfg.beatsPerBar;
  }

  async load() {
    const all = { ...prefix(this.cfg.loops, 'loop:'), ...prefix(this.cfg.sfx, 'sfx:') };
    await Promise.all(Object.entries(all).map(async ([k, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        this.buffers[k] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch { console.info(`[audio] ${url} not found – ${k.startsWith('sfx') ? 'using test blip' : 'silent'}`); }
    }));
  }

  get locked() { return this.ctx.state === 'suspended'; }
  unlock() { return this.ctx.resume(); }

  setVolumes({ music, sfx, muted } = {}) {
    const t = this.ctx.currentTime;
    if (music != null) this.music.gain.setTargetAtTime(muted ? 0 : music, t, 0.1);
    else if (muted != null) this.music.gain.setTargetAtTime(muted ? 0 : this.cfg.musicVolume, t, 0.1);
    if (sfx != null) this.fx.gain.setTargetAtTime(sfx, t, 0.05);
  }

  // Switch music to a phase ('ban1' | 'pick1' | 'ban2' | 'pick2' | 'done' | null to stop).
  setPhase(phase) {
    if (this.current?.phase === phase) return;
    const buf = phase && this.buffers['loop:' + phase];
    const now = this.ctx.currentTime;
    const fade = this.cfg.fadeSeconds;

    let at;
    if (!this.current || this.t0 == null) { at = now + 0.05; this.t0 = at; }
    else at = this.t0 + Math.ceil((now - this.t0) / this.barLen + 0.001) * this.barLen;  // next bar line

    if (this.current) {
      const { gain, src } = this.current;
      gain.gain.setValueAtTime(1, at);
      gain.gain.linearRampToValueAtTime(0, at + fade);
      src.stop(at + fade + 0.05);
    }
    if (!buf) { this.current = phase ? { phase, src: { stop() {} }, gain: this.ctx.createGain() } : null; if (!phase) this.t0 = null; return; }

    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const gain = this.ctx.createGain(); gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(1, at + fade);
    src.connect(gain).connect(this.music);
    const offset = ((at - this.t0) % buf.duration + buf.duration) % buf.duration;
    src.start(at, offset);
    this.current = { phase, src, gain };
  }

  stop() { this.setPhase(null); }

  sfx(name) {
    const buf = this.buffers['sfx:' + name];
    if (buf) {
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.fx); src.start();
      return;
    }
    // Test blip so you can hear events before your sounds exist.
    const freq = { hover: 660, ban: 220, pick: 440, complete: 880 }[name] || 500;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    o.frequency.value = freq; o.type = name === 'ban' ? 'sawtooth' : 'triangle';
    g.gain.setValueAtTime(name === 'hover' ? 0.05 : 0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (name === 'complete' ? 0.8 : 0.25));
    o.connect(g).connect(this.fx); o.start(t); o.stop(t + 0.9);
  }
}

const prefix = (obj, p) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [p + k, v]));
