// Procedural sound placeholders (WebAudio). Nothing is sampled; every sound is synthesised so the
// vertical slice has a coherent audio identity: glassy salt, water, bells and breath.
export class Audio {
  constructor() { this.ctx = null; this.muted = false; }

  init() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    // long, soft reverb: the flat is vast
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(4.5, 2.6);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.45;
    this.verbSend.connect(this.verb).connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.sfx.connect(this.verbSend);
    this.noiseBuf = this._noise(2);
    this._startAmbience();
  }

  _impulse(sec, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  _noise(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  get now() { return this.ctx.currentTime; }

  _env(gainNode, t, a, peak, d, sustain = 0) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
  }
  _noiseSrc(t, dur, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true; s.playbackRate.value = rate;
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
    return s;
  }
  _osc(type, f, t, dur) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  _out(node, gain = 1, pan = 0, dry = true) {
    const g = this.ctx.createGain(); g.gain.value = gain;
    let n = node.connect(g);
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; n = n.connect(p); }
    n.connect(dry ? this.sfx : this.verbSend);
    return g;
  }

  play(name, opts = {}) {
    if (!this.ctx || this.muted) return;
    const fn = this['s_' + name];
    if (fn) fn.call(this, opts, this.now + (opts.delay || 0));
  }

  // ------------------------------------------------------------- sfx
  s_whoosh(o, t) {
    const dur = o.dur || 0.2, f0 = o.f || 500;
    const n = this._noiseSrc(t, dur);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f0 * 3.2, t + dur * 0.7);
    const g = this.ctx.createGain(); this._env(g, t, dur * 0.35, (o.gain || 0.5), dur * 0.65);
    this._out(n.connect(bp).connect(g), 1, o.pan || 0);
  }
  s_hit(o, t) {
    // glaive into carapace: crack + thump; weak points add a glassy ring
    const n = this._noiseSrc(t, 0.12);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2400; hp.Q.value = 0.8;
    const g = this.ctx.createGain(); this._env(g, t, 0.002, 0.9 * (o.gain || 1), 0.1);
    this._out(n.connect(hp).connect(g));
    const th = this._osc('sine', 150, t, 0.25);
    th.frequency.exponentialRampToValueAtTime(55, t + 0.2);
    const g2 = this.ctx.createGain(); this._env(g2, t, 0.003, 0.8 * (o.gain || 1), 0.22);
    this._out(th.connect(g2));
    if (o.weak) {
      for (const [f, a] of [[1760, 0.3], [2637, 0.18], [3951, 0.1]]) {
        const s = this._osc('sine', f * (o.pitch || 1), t, 1.2);
        const gs = this.ctx.createGain(); this._env(gs, t, 0.002, a, 1.1);
        this._out(s.connect(gs), 1, 0, true);
        this._out(s, a * 0.4, 0, false);
      }
    }
  }
  s_hurt(o, t) {
    const n = this._noiseSrc(t, 0.3, 0.6);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = this.ctx.createGain(); this._env(g, t, 0.004, 1.0, 0.28);
    this._out(n.connect(lp).connect(g));
    const a = this._osc('sawtooth', 110, t, 0.5), b = this._osc('sawtooth', 116.5, t, 0.5);
    const lp2 = this.ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 600;
    const g2 = this.ctx.createGain(); this._env(g2, t, 0.005, 0.25, 0.45);
    a.connect(lp2); b.connect(lp2);
    this._out(lp2.connect(g2));
  }
  s_splash(o, t) {
    const size = o.size || 1, dur = 0.25 + 0.5 * size;
    const n = this._noiseSrc(t, dur);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = this.ctx.createGain(); this._env(g, t, 0.01, 0.35 * Math.min(1.5, size) * (o.gain || 1), dur);
    this._out(n.connect(lp).connect(g), 1, o.pan || 0);
    for (let i = 0; i < 3 + size * 4; i++) {
      const tt = t + 0.04 + Math.random() * dur * 0.8;
      const s = this._osc('sine', 900 + Math.random() * 1600, tt, 0.06);
      s.frequency.exponentialRampToValueAtTime(2400 + Math.random() * 1500, tt + 0.05);
      const gs = this.ctx.createGain(); this._env(gs, tt, 0.002, 0.04 * (o.gain || 1), 0.05);
      this._out(s.connect(gs));
    }
  }
  s_stomp(o, t) {
    const size = o.size || 1;
    const s = this._osc('sine', 70, t, 1.0);
    s.frequency.exponentialRampToValueAtTime(28, t + 0.8);
    const g = this.ctx.createGain(); this._env(g, t, 0.005, 0.9 * size, 0.9);
    this._out(s.connect(g));
    const n = this._noiseSrc(t, 0.8, 0.5);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    const g2 = this.ctx.createGain(); this._env(g2, t, 0.01, 0.6 * size, 0.7);
    this._out(n.connect(lp).connect(g2));
    this.s_splash({ size: 0.8 * size, gain: 0.8 }, t + 0.01);
  }
  s_step(o, t) {
    // distant stilt step: soft low knock + little splash
    const s = this._osc('sine', 95, t, 0.3);
    s.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g = this.ctx.createGain(); this._env(g, t, 0.004, 0.35 * (o.gain || 1), 0.25);
    this._out(s.connect(g), 1, o.pan || 0);
    this.s_splash({ size: 0.35, gain: 0.5 * (o.gain || 1), pan: o.pan }, t);
  }
  s_foot(o, t) {
    const n = this._noiseSrc(t, 0.08);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 800; bp.Q.value = 1.5;
    const g = this.ctx.createGain(); this._env(g, t, 0.003, 0.06, 0.07);
    this._out(n.connect(bp).connect(g));
  }
  s_toll(o, t) {
    // the lantern bell: inharmonic partials, long ring
    const f0 = o.f || 98;
    for (const [m, a, d] of [[0.5, 0.5, 5], [1, 0.6, 4.5], [2.76, 0.3, 3], [5.4, 0.16, 2], [8.93, 0.08, 1.2]]) {
      const s = this._osc('sine', f0 * m, t, d);
      const g = this.ctx.createGain(); this._env(g, t, 0.004, a, d);
      this._out(s.connect(g), 0.9, 0, true);
      this._out(s, a * 0.35, 0, false);
    }
    this.s_stomp({ size: 0.6 }, t);
  }
  s_charge(o, t) {
    const dur = o.dur || 1.2;
    const s = this._osc('sine', 180, t, dur), s2 = this._osc('triangle', 181.5, t, dur);
    s.frequency.exponentialRampToValueAtTime(540, t + dur); s2.frequency.exponentialRampToValueAtTime(546, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    s.connect(g); s2.connect(g);
    this._out(g, 1, 0, true);
  }
  s_glint(o, t) {
    for (const [f, a] of [[2960, 0.14], [4440, 0.07]]) {
      const s = this._osc('sine', f, t, 0.9);
      const g = this.ctx.createGain(); this._env(g, t, 0.002, a, 0.8);
      this._out(s.connect(g), 1, 0, true);
    }
  }
  s_voice(o, t) {
    // creature call: sawtooth pair through formant filters with vibrato
    const dur = o.dur || 1.6, f = o.f || 92;
    const out = this.ctx.createGain(); this._env(out, t, 0.12, 0.5 * (o.gain || 1), dur, 0.0001);
    const lfo = this._osc('sine', 5.5, t, dur); const lg = this.ctx.createGain(); lg.gain.value = f * 0.04; lfo.connect(lg);
    for (const det of [0, 7, -5]) {
      const s = this._osc('sawtooth', f, t, dur);
      s.detune.value = det;
      s.frequency.setValueAtTime(f * (o.from || 0.8), t);
      s.frequency.exponentialRampToValueAtTime(f, t + dur * 0.25);
      s.frequency.exponentialRampToValueAtTime(f * (o.to || 0.7), t + dur);
      lg.connect(s.frequency);
      for (const [ff, q, a] of [[520, 6, 1], [1150, 8, 0.6], [2600, 10, 0.3]]) {
        const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff * (o.formant || 1); bp.Q.value = q;
        const g = this.ctx.createGain(); g.gain.value = a * 0.5;
        s.connect(bp).connect(g).connect(out);
      }
    }
    const n = this._noiseSrc(t, dur, 0.7);
    const bpn = this.ctx.createBiquadFilter(); bpn.type = 'bandpass'; bpn.frequency.value = 1400; bpn.Q.value = 0.7;
    const gn = this.ctx.createGain(); gn.gain.value = 0.25; n.connect(bpn).connect(gn).connect(out);
    this._out(out, 1, 0, true);
    this._out(out, 0.5, 0, false);
  }
  s_shatter(o, t) {
    const n = this._noiseSrc(t, 0.6);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const g = this.ctx.createGain(); this._env(g, t, 0.003, 0.6, 0.5);
    this._out(n.connect(hp).connect(g));
    for (let i = 0; i < 26; i++) {
      const tt = t + Math.random() * 0.5, f = 1800 + Math.random() * 4200;
      const s = this._osc('sine', f, tt, 0.5);
      const gs = this.ctx.createGain(); this._env(gs, tt, 0.001, 0.07, 0.3 + Math.random() * 0.3);
      this._out(s.connect(gs), 1, Math.random() * 1.6 - 0.8, true);
    }
    this.s_stomp({ size: 0.7 }, t);
  }
  s_heal(o, t) {
    [587.3, 740, 880, 1174.7].forEach((f, i) => {
      const s = this._osc('sine', f, t + i * 0.09, 1.4);
      const g = this.ctx.createGain(); this._env(g, t + i * 0.09, 0.01, 0.12, 1.3);
      this._out(s.connect(g), 1, 0, true);
    });
  }
  s_skim(o, t) {
    const n = this._noiseSrc(t, 0.35);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.Q.value = 0.9;
    hp.frequency.setValueAtTime(2800, t); hp.frequency.exponentialRampToValueAtTime(900, t + 0.32);
    const g = this.ctx.createGain(); this._env(g, t, 0.01, 0.32, 0.32);
    this._out(n.connect(hp).connect(g));
  }
  s_ui(o, t) {
    const s = this._osc('sine', o.f || 660, t, 0.4);
    const g = this.ctx.createGain(); this._env(g, t, 0.005, 0.1, 0.35);
    this._out(s.connect(g), 1, 0, true);
  }
  s_heartbeat(o, t) {
    for (const dt of [0, 0.22]) {
      const s = this._osc('sine', 55, t + dt, 0.25);
      s.frequency.exponentialRampToValueAtTime(32, t + dt + 0.2);
      const g = this.ctx.createGain(); this._env(g, t + dt, 0.005, 0.25 * (dt ? 0.7 : 1), 0.2);
      this._out(s.connect(g));
    }
  }

  // ------------------------------------------------------------- ambience / music
  _startAmbience() {
    const ctx = this.ctx;
    // wind over the flat
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true; n.playbackRate.value = 0.35;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.09;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 180; lfo.connect(lfoG).connect(lp.frequency); lfo.start();
    n.connect(lp).connect(this.windGain).connect(this.master); n.start();
    // drone pad
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0.0;
    this.padFilter = ctx.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 700;
    this.padOsc = [];
    for (const [f, type] of [[73.42, 'sine'], [110, 'triangle'], [146.8, 'sine'], [174.6, 'triangle'], [220.5, 'sine']]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = Math.random() * 8 - 4;
      const g = ctx.createGain(); g.gain.value = type === 'sine' ? 0.18 : 0.08;
      o.connect(g).connect(this.padFilter); o.start();
      this.padOsc.push(o);
    }
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.master); this.padGain.connect(this.verbSend);
    this.mood('title');
  }

  /** crossfade the drone to a mood: title | fight | night | victory | death */
  mood(m) {
    if (!this.ctx) return;
    const t = this.now;
    const set = (param, v, tc = 1.5) => param.setTargetAtTime(v, t, tc);
    const tune = {
      title: [[73.42, 110, 146.8, 174.6, 220.5], 0.1, 600],
      fight: [[73.42, 110, 146.8, 164.8, 220.5], 0.16, 900],
      night: [[69.3, 103.8, 138.6, 164.8, 207.7], 0.2, 1300],
      victory: [[73.42, 110, 146.8, 185, 220.5], 0.2, 1600],
      death: [[65.4, 98, 130.8, 155.6, 196], 0.08, 400],
    }[m];
    if (!tune) return;
    tune[0].forEach((f, i) => set(this.padOsc[i].frequency, f, 2.5));
    set(this.padGain.gain, tune[1], 2.0);
    set(this.padFilter.frequency, tune[2], 2.0);
    this.moodName = m;
  }
}

export const audio = new Audio();
