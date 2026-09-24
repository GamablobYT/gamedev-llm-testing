import * as THREE from 'three';
import { LAYER_NO_REFLECT } from '../world/water.js';

// Danger drawn on the water: thin coral outline, a fill that grows with the windup, a flash on strike.
// Modes: 0 line (A.x length, A.y width), 1 circle (A.x radius), 2 sector (A = rIn, rOut, a0, a1),
//        3 ring wave (A.x radius, A.y width, occluders cast safe shadows)
const vert = `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const frag = /* glsl */`
uniform int uMode; uniform vec4 uA; uniform float uProg, uAlpha, uFlash, uTime; uniform vec3 uColor;
uniform vec4 uOcc[8]; uniform int uOccN;
varying vec2 vP;
float aaStep(float e, float d) { float w = fwidth(d) * 1.2; return 1.0 - smoothstep(e - w, e + w, d); }
void main() {
  float sd = 1.0, fillCoord = 0.0;
  if (uMode == 0) {
    vec2 q = vec2(abs(vP.x) - uA.y * 0.5, max(-vP.y, vP.y - uA.x));
    sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    fillCoord = vP.y / uA.x;
  } else if (uMode == 1) {
    sd = length(vP) - uA.x;
    fillCoord = length(vP) / uA.x;
  } else if (uMode == 2) {
    float r = length(vP);
    float a = atan(vP.x, vP.y);
    float a0 = uA.z, a1 = uA.w;
    float mid = 0.5 * (a0 + a1), half_ = 0.5 * abs(a1 - a0);
    float da = abs(mod(a - mid + 3.14159265, 6.2831853) - 3.14159265);
    float sdA = (da - half_) * r;
    float sdR = max(uA.x - r, r - uA.y);
    sd = max(sdA, sdR);
    float signedA = mod(a - a0 + 3.14159265, 6.2831853) - 3.14159265;
    fillCoord = abs(signedA) / max(1e-3, abs(a1 - a0));
  } else {
    float r = length(vP);
    sd = abs(r - uA.x) - uA.y * 0.5;
    // spires cast safe shadows through the wave
    float shade = 1.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uOccN) break;
      vec2 c = uOcc[i].xy; float cr = uOcc[i].z; float cl = length(c);
      if (cl < 0.1 || r < cl) continue;
      float ang = acos(clamp(dot(normalize(vP), c / cl), -1.0, 1.0));
      float lim = asin(clamp(cr / cl, 0.0, 1.0));
      shade *= smoothstep(lim * 0.8, lim * 1.05, ang);
    }
    float band = exp(-max(sd, 0.0) * 3.0) * step(r, uA.x + uA.y);
    float trail = smoothstep(uA.x - 5.0, uA.x, r) * step(r, uA.x) * 0.35;
    float a = (band + trail) * shade * uAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * (1.6 + band * 2.0), a);
    return;
  }
  float inside = aaStep(0.0, sd);
  float edgeW = 0.09;
  float edge = inside * (1.0 - smoothstep(0.0, edgeW + fwidth(sd), -sd));
  float fill = inside * aaStep(uProg, fillCoord);
  float lead = inside * exp(-pow((fillCoord - uProg) * 18.0, 2.0)) * step(0.01, uProg) * step(uProg, 0.99);
  float pulse = 0.85 + 0.15 * sin(uTime * 18.0);
  float a = (edge * 0.9 * pulse + fill * 0.22 + inside * 0.05 + lead * 0.5) * uAlpha + inside * uFlash * 0.7;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * (1.3 + uFlash * 2.5), clamp(a, 0.0, 1.0));
}`;

export class Telegraph {
  constructor(parent) {
    this.u = {
      uMode: { value: 0 }, uA: { value: new THREE.Vector4() }, uProg: { value: 0 }, uAlpha: { value: 0 }, uFlash: { value: 0 },
      uTime: { value: 0 }, uColor: { value: new THREE.Color(1, 0.3, 0.22) }, uOcc: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uOccN: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.u, transparent: true,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.layers.set(LAYER_NO_REFLECT);
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.active = false;
  }
  _setBounds(x0, x1, z0, z1) {
    // PlaneGeometry spans -0.5..0.5; we need local coords in metres, so scale and offset geometry via position
    const g = this.mesh.geometry;
    const p = g.attributes.position;
    const xs = [x0, x1, x1, x0], zs = [z1, z1, z0, z0];
    // PlaneGeometry(1,1) after rotateX: vertices order (-.5,.5),(.5,.5),(-.5,-.5),(.5,-.5) in x/z(-y)
    for (let i = 0; i < 4; i++) {
      const ox = p.getX(i) < 0 ? x0 : x1;
      const oz = p.getZ(i) < 0 ? z0 : z1;
      p.setXYZ(i, ox, 0, oz);
    }
    p.needsUpdate = true;
    g.computeBoundingSphere();
    void xs; void zs;
  }
  /** Set shape. pos: world (x, z); yaw: rotation.y */
  line(pos, yaw, length, width) {
    this.u.uMode.value = 0; this.u.uA.value.set(length, width, 0, 0);
    this._setBounds(-width / 2 - 0.3, width / 2 + 0.3, -0.3, length + 0.3);
    return this._place(pos, yaw);
  }
  circle(pos, r) {
    this.u.uMode.value = 1; this.u.uA.value.set(r, 0, 0, 0);
    this._setBounds(-r - 0.3, r + 0.3, -r - 0.3, r + 0.3);
    return this._place(pos, 0);
  }
  sector(pos, yaw, rIn, rOut, a0, a1) {
    this.u.uMode.value = 2; this.u.uA.value.set(rIn, rOut, a0, a1);
    this._setBounds(-rOut - 0.3, rOut + 0.3, -rOut - 0.3, rOut + 0.3);
    return this._place(pos, yaw);
  }
  ring(pos, radius, width, occluders = []) {
    this.u.uMode.value = 3; this.u.uA.value.set(radius, width, 0, 0);
    const R = radius + width + 0.5;
    this._setBounds(-R, R, -R, R);
    this.u.uOccN.value = Math.min(8, occluders.length);
    occluders.slice(0, 8).forEach((o, i) => this.u.uOcc.value[i].set(o.x - pos.x, o.z - pos.z, o.r, 0));
    return this._place(pos, 0);
  }
  _place(pos, yaw) {
    this.mesh.position.set(pos.x, 0.035, pos.z);
    this.mesh.rotation.set(0, yaw, 0);
    this.mesh.visible = true;
    this.active = true;
    this.u.uProg.value = 0; this.u.uFlash.value = 0; this.u.uAlpha.value = 1;
    return this;
  }
  hide() { this.mesh.visible = false; this.active = false; }
}

export class Telegraphs {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.live = [];
    this.color = new THREE.Color(1, 0.3, 0.22);
  }
  get() {
    let t = this.pool.pop();
    if (!t) t = new Telegraph(this.scene);
    t.u.uColor.value.copy(this.color);
    t.fading = false;
    this.live.push(t);
    return t;
  }
  /** fade out then return to pool */
  release(t, fade = 0.25) {
    if (!t || t.fading) return;
    t.fading = true; t.fadeT = fade; t.fadeDur = fade;
  }
  clear() { for (const t of this.live) { t.hide(); this.pool.push(t); } this.live.length = 0; }
  update(dt, time) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i];
      t.u.uTime.value = time;
      t.u.uFlash.value = Math.max(0, t.u.uFlash.value - dt * 4);
      if (t.fading) {
        t.fadeT -= dt;
        t.u.uAlpha.value = Math.max(0, t.fadeT / t.fadeDur);
        if (t.fadeT <= 0) { t.hide(); this.live.splice(i, 1); this.pool.push(t); }
      }
    }
  }
}
