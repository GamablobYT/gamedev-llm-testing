import * as THREE from 'three';
import { lerp, smooth } from '../core/util.js';

const C = (r, g, b) => new THREE.Color(r, g, b);
const dirFrom = (azDeg, elDeg) => {
  const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
};

// Lighting presets. Phase 1 dusk: light world, dark creature. Phase 2 night: the creature becomes the light.
export const PRESETS = {
  dusk: {
    sunDir: dirFrom(-22, 6.5), sunColor: C(1.0, 0.62, 0.44), sunI: 3.0,
    moonDir: dirFrom(160, 30), moonColor: C(0.55, 0.62, 1.0), moonI: 0.0,
    hemiSky: C(0.62, 0.6, 0.86), hemiGround: C(0.95, 0.78, 0.74), hemiI: 0.6,
    zenith: C(0.12, 0.16, 0.36), mid: C(0.46, 0.45, 0.66), horizon: C(1.0, 0.74, 0.62), glow: C(1.0, 0.52, 0.34),
    belt: C(0.86, 0.62, 0.72), shadowBand: C(0.36, 0.38, 0.6), stars: 0.0, cloud: C(1.0, 0.68, 0.58),
    fog: C(0.96, 0.78, 0.74), fogDensity: 0.0042, exposure: 1.0,
    salt: C(0.74, 0.71, 0.8), saltWet: C(0.4, 0.38, 0.5), wetness: 0.9, hexGlow: 0.0, hexGlowColor: C(0.5, 0.6, 1.0),
    lanternI: 2.2, lanternLight: 6, veins: 0.0, rim: C(1.0, 0.72, 0.6), rimI: 0.7, crystalGlow: 0.15,
    telegraph: C(1.0, 0.3, 0.22), bloom: 0.35,
  },
  night: {
    sunDir: dirFrom(-22, -12), sunColor: C(0.9, 0.35, 0.3), sunI: 0.0,
    moonDir: dirFrom(150, 34), moonColor: C(0.55, 0.64, 1.0), moonI: 0.45,
    hemiSky: C(0.12, 0.14, 0.32), hemiGround: C(0.1, 0.07, 0.14), hemiI: 0.55,
    zenith: C(0.006, 0.008, 0.03), mid: C(0.022, 0.028, 0.085), horizon: C(0.07, 0.06, 0.14), glow: C(0.22, 0.08, 0.2),
    belt: C(0.05, 0.05, 0.12), shadowBand: C(0.02, 0.025, 0.07), stars: 1.0, cloud: C(0.2, 0.1, 0.16),
    fog: C(0.07, 0.05, 0.1), fogDensity: 0.0048, exposure: 1.15,
    salt: C(0.45, 0.46, 0.62), saltWet: C(0.22, 0.22, 0.34), wetness: 1.0, hexGlow: 0.55, hexGlowColor: C(0.42, 0.52, 1.0),
    lanternI: 4.2, lanternLight: 38, veins: 1.0, rim: C(1.0, 0.36, 0.3), rimI: 1.1, crystalGlow: 0.6,
    telegraph: C(1.0, 0.33, 0.25), bloom: 0.6,
  },
  dawn: {
    sunDir: dirFrom(150, 5), sunColor: C(1.0, 0.74, 0.46), sunI: 2.8,
    moonDir: dirFrom(150, 34), moonColor: C(0.55, 0.64, 1.0), moonI: 0.0,
    hemiSky: C(0.62, 0.66, 0.9), hemiGround: C(1.0, 0.82, 0.66), hemiI: 0.55,
    zenith: C(0.13, 0.2, 0.44), mid: C(0.55, 0.56, 0.76), horizon: C(1.0, 0.76, 0.5), glow: C(1.0, 0.66, 0.32),
    belt: C(0.9, 0.72, 0.78), shadowBand: C(0.46, 0.5, 0.72), stars: 0.0, cloud: C(1.0, 0.82, 0.66),
    fog: C(1.0, 0.82, 0.68), fogDensity: 0.0038, exposure: 1.0,
    salt: C(0.78, 0.75, 0.8), saltWet: C(0.42, 0.42, 0.56), wetness: 0.95, hexGlow: 0.0, hexGlowColor: C(0.5, 0.6, 1.0),
    lanternI: 0.25, lanternLight: 0, veins: 0.0, rim: C(1.0, 0.85, 0.65), rimI: 0.6, crystalGlow: 0.1,
    telegraph: C(1.0, 0.3, 0.22), bloom: 0.35,
  },
};

function clonePreset(p) {
  const o = {};
  for (const [k, v] of Object.entries(p)) o[k] = v && v.clone ? v.clone() : v;
  return o;
}

/** Holds the live atmosphere state and blends toward a target preset over time. */
export class Atmosphere {
  constructor() {
    this.cur = clonePreset(PRESETS.dusk);
    this.from = clonePreset(PRESETS.dusk);
    this.to = PRESETS.dusk;
    this.t = 1; this.dur = 1;
    this.changed = true;
  }
  set(name) { this.cur = clonePreset(PRESETS[name]); this.to = PRESETS[name]; this.t = 1; this.changed = true; this.name = name; }
  blendTo(name, dur) {
    this.from = clonePreset(this.cur);
    this.to = PRESETS[name];
    this.t = 0; this.dur = dur; this.name = name;
  }
  get blending() { return this.t < 1; }
  update(dt) {
    if (this.t >= 1) { this.changed = false; return; }
    this.t = Math.min(1, this.t + dt / this.dur);
    const k = smooth(this.t);
    for (const key of Object.keys(this.cur)) {
      const a = this.from[key], b = this.to[key];
      if (typeof a === 'number') this.cur[key] = lerp(a, b, k);
      else if (a.isColor) this.cur[key].copy(a).lerp(b, k);
      else if (a.isVector3) {
        // sun/moon directions: slerp-ish through normalised lerp
        this.cur[key].copy(a).lerp(b, k).normalize();
      }
    }
    this.changed = true;
  }
}
