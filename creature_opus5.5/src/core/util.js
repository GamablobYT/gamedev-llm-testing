import * as THREE from 'three';

export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeIn = (t) => Math.pow(clamp(t), 3);
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const TAU = Math.PI * 2;

/** framerate independent exponential damping */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
/** rotation.y so that local +Z faces (dx, dz) */
export const yawTo = (dx, dz) => Math.atan2(dx, dz);

export function dampVec3(v, target, lambda, dt) {
  const k = 1 - Math.exp(-lambda * dt);
  v.x += (target.x - v.x) * k;
  v.y += (target.y - v.y) * k;
  v.z += (target.z - v.z) * k;
  return v;
}

/** closest point on segment ab to p */
export function closestOnSegment(p, a, b, out = new THREE.Vector3()) {
  const ab = _t1.subVectors(b, a);
  const t = clamp(_t2.subVectors(p, a).dot(ab) / Math.max(1e-6, ab.lengthSq()));
  return out.copy(a).addScaledVector(ab, t);
}
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();

/** squared distance between segments p1q1 and p2q2 (Ericson) */
export function segSegDist2(p1, q1, p2, q2) {
  const d1 = _s1.subVectors(q1, p1), d2 = _s2.subVectors(q2, p2), r = _s3.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-8 && e <= 1e-8) return r.dot(r);
  if (a <= 1e-8) { s = 0; t = clamp(f / e); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-8) { t = 0; s = clamp(-c / a); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den !== 0 ? clamp((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a); } else if (t > 1) { t = 1; s = clamp((b - c) / a); }
    }
  }
  const c1 = _s4.copy(p1).addScaledVector(d1, s), c2 = _s5.copy(p2).addScaledVector(d2, t);
  return c1.distanceToSquared(c2);
}
const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s3 = new THREE.Vector3(), _s4 = new THREE.Vector3(), _s5 = new THREE.Vector3();

/** small value noise for camera shake etc. */
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const h = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}

export class Timer {
  constructor() { this.t = 0; }
}
