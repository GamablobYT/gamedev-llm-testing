import * as THREE from 'three';
import { rand } from '../core/util.js';

const vert = /* glsl */`
attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iCol; attribute vec3 iSize;
varying vec2 vUv; varying vec4 vCol; varying float vShape;
void main() {
  vUv = uv; vCol = iCol; vShape = iSize.z;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec2 corner = position.xy;
  float size = iSize.x;
  vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
  float sp = length(vv.xy);
  if (iSize.y > 0.0 && sp > 0.01) {
    vec2 ax = vv.xy / sp;
    vec2 pp = vec2(-ax.y, ax.x);
    float len = size + iSize.y * sp;
    mv.xy += ax * corner.y * len + pp * corner.x * size;
  } else {
    mv.xy += corner * size;
  }
  gl_Position = projectionMatrix * mv;
}`;
const frag = /* glsl */`
varying vec2 vUv; varying vec4 vCol; varying float vShape;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float a;
  if (vShape > 0.5) { // diamond shard
    a = 1.0 - smoothstep(0.7, 1.0, abs(p.x) + abs(p.y));
  } else {
    a = 1.0 - smoothstep(0.1, 1.0, length(p));
    a *= a;
  }
  if (a * vCol.a < 0.003) discard;
  gl_FragColor = vec4(vCol.rgb, a * vCol.a);
}`;

/** Pooled instanced billboard particles with optional velocity stretching. */
export class Particles {
  constructor(max, additive) {
    this.max = max;
    this.list = [];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iVel', this.aVel); g.setAttribute('iCol', this.aCol); g.setAttribute('iSize', this.aSize);
    g.instanceCount = 0;
    this.geo = g;
    const m = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  /** o: pos, vel, life, size, grow, color(Color), alpha, gravity, drag, stretch, shape(0 soft,1 shard), floor */
  spawn(o) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      p: o.pos.clone(), v: o.vel ? o.vel.clone() : new THREE.Vector3(), age: 0, life: o.life || 1,
      size: o.size || 0.1, grow: o.grow || 0, c: o.color || new THREE.Color(1, 1, 1), alpha: o.alpha ?? 1,
      g: o.gravity ?? 0, drag: o.drag ?? 0, stretch: o.stretch || 0, shape: o.shape || 0, floor: o.floor ?? true,
      fadeIn: o.fadeIn || 0,
    });
  }

  clear() { this.list.length = 0; }

  update(dt) {
    const L = this.list;
    let n = 0;
    for (let i = L.length - 1; i >= 0; i--) {
      const q = L[i];
      q.age += dt;
      if (q.age >= q.life) { L.splice(i, 1); continue; }
      q.v.y -= q.g * dt;
      if (q.drag) q.v.multiplyScalar(Math.exp(-q.drag * dt));
      q.p.addScaledVector(q.v, dt);
      if (q.floor && q.p.y < 0) {
        if (this.onFloor) this.onFloor(q);
        q.life = Math.min(q.life, q.age + 0.05);
        q.p.y = 0;
        q.v.set(0, 0, 0);
      }
    }
    for (const q of L) {
      const k = q.age / q.life;
      const a = q.alpha * (1 - k) * (q.fadeIn ? Math.min(1, q.age / q.fadeIn) : 1);
      this.aPos.setXYZ(n, q.p.x, q.p.y, q.p.z);
      this.aVel.setXYZ(n, q.v.x, q.v.y, q.v.z);
      this.aCol.setXYZW(n, q.c.r, q.c.g, q.c.b, a);
      this.aSize.setXYZ(n, q.size * (1 + q.grow * k), q.stretch, q.shape);
      n++;
    }
    this.geo.instanceCount = n;
    for (const a of [this.aPos, this.aVel, this.aCol, this.aSize]) {
      a.needsUpdate = true;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
    }
  }
}

/** High-level effect recipes, all restrained and tied to the palette. */
export class FX {
  constructor(scene, water) {
    this.water = water;
    this.soft = new Particles(2400, false);
    this.glow = new Particles(1600, true);
    scene.add(this.soft.mesh, this.glow.mesh);
    this.SALT = new THREE.Color(0.95, 0.93, 1.0);
    this.SPRAY = new THREE.Color(0.9, 0.9, 1.0);
    this.CORAL = new THREE.Color(1.0, 0.36, 0.26).multiplyScalar(3.0);
    this.CYAN = new THREE.Color(0.75, 0.95, 1.0).multiplyScalar(3.0);
    this.MARI = new THREE.Color(1.0, 0.62, 0.18).multiplyScalar(2.5);
    this.soft.onFloor = (q) => {
      if (q.big && Math.random() < 0.3) this.water.ripple(q.p.x, q.p.z, 0.25, 3, 0.3, 9, 2.2);
    };
    this.motes = [];
  }

  update(dt) { this.soft.update(dt); this.glow.update(dt); }
  clear() { this.soft.clear(); this.glow.clear(); }

  /** water thrown up by an impact */
  splash(pos, power = 1, dir = null) {
    const n = Math.floor(14 + 26 * power);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(1.5, 5.5) * power;
      const v = new THREE.Vector3(Math.cos(a) * s * 0.55, rand(3, 8) * Math.sqrt(power), Math.sin(a) * s * 0.55);
      if (dir) v.addScaledVector(dir, rand(1, 4) * power);
      this.soft.spawn({ pos: pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), 0.05, rand(-0.3, 0.3))), vel: v,
        life: rand(0.6, 1.2), size: rand(0.03, 0.08) * (0.6 + power * 0.5), color: this.SPRAY, alpha: 0.85, gravity: 16, stretch: 0.025 });
      this.soft.list[this.soft.list.length - 1].big = true;
    }
    // a soft veil of mist
    for (let i = 0; i < 4 + power * 4; i++) {
      this.soft.spawn({ pos: pos.clone().add(new THREE.Vector3(rand(-0.6, 0.6) * power, rand(0.2, 0.8), rand(-0.6, 0.6) * power)),
        vel: new THREE.Vector3(rand(-1, 1), rand(0.5, 1.5), rand(-1, 1)), life: rand(0.8, 1.6), size: rand(0.5, 0.9) * power,
        grow: 1.2, color: this.SPRAY, alpha: 0.12, drag: 1.5, floor: false });
    }
  }

  /** crystal shards and sparks where the glaive bites */
  hitSpark(pos, dir, weak = false) {
    const col = weak ? this.CORAL : this.CYAN;
    for (let i = 0; i < (weak ? 22 : 12); i++) {
      const v = dir.clone().multiplyScalar(rand(3, 9)).add(new THREE.Vector3(rand(-4, 4), rand(-1, 5), rand(-4, 4)));
      this.glow.spawn({ pos, vel: v, life: rand(0.15, 0.35), size: rand(0.02, 0.05), color: col, stretch: 0.035, drag: 4, gravity: 6 });
    }
    for (let i = 0; i < (weak ? 10 : 6); i++) {
      const v = dir.clone().multiplyScalar(rand(1, 4)).add(new THREE.Vector3(rand(-3, 3), rand(1, 5), rand(-3, 3)));
      this.soft.spawn({ pos, vel: v, life: rand(0.5, 0.9), size: rand(0.05, 0.1), color: this.SALT, gravity: 14, shape: 1 });
    }
    this.glow.spawn({ pos, life: 0.1, size: weak ? 1.6 : 0.9, color: weak ? this.CORAL : this.CYAN, alpha: 0.6, floor: false });
  }

  /** the player's skim across the water */
  skim(pos, vel) {
    for (let i = 0; i < 3; i++) {
      const v = vel.clone().multiplyScalar(-0.2).add(new THREE.Vector3(rand(-1.5, 1.5), rand(1.5, 3.5), rand(-1.5, 1.5)));
      this.soft.spawn({ pos: pos.clone().add(new THREE.Vector3(rand(-0.2, 0.2), 0.05, rand(-0.2, 0.2))), vel: v, life: rand(0.35, 0.6),
        size: rand(0.03, 0.06), color: this.SPRAY, alpha: 0.9, gravity: 14, stretch: 0.02 });
    }
  }

  footSplash(pos, s = 1) {
    for (let i = 0; i < 4 * s; i++) {
      this.soft.spawn({ pos: pos.clone().add(new THREE.Vector3(0, 0.03, 0)),
        vel: new THREE.Vector3(rand(-0.8, 0.8), rand(0.8, 2.2), rand(-0.8, 0.8)).multiplyScalar(s), life: 0.4,
        size: 0.025 * s + 0.01, color: this.SPRAY, alpha: 0.7, gravity: 12 });
    }
  }

  /** glint on the beak tip before a lance */
  glint(pos) {
    this.glow.spawn({ pos, life: 0.35, size: 1.4, color: new THREE.Color(1, 0.85, 0.8).multiplyScalar(4), alpha: 1, floor: false });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      this.glow.spawn({ pos, vel: new THREE.Vector3(Math.cos(a) * 6, Math.sin(a) * 6, 0), life: 0.22, size: 0.03,
        color: new THREE.Color(1, 0.8, 0.7).multiplyScalar(4), stretch: 0.06, drag: 8, floor: false });
    }
  }

  /** embers of the lantern drifting up */
  ember(pos, strength = 1) {
    this.glow.spawn({ pos: pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(-0.4, 0.2), rand(-0.4, 0.4))),
      vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.4, 1.4), rand(-0.3, 0.3)), life: rand(1, 2.2), size: rand(0.02, 0.05) * strength,
      color: this.CORAL, alpha: 0.9, drag: 0.5, floor: false, fadeIn: 0.2 });
  }

  healBurst(pos) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(0.2, 0.7);
      this.glow.spawn({ pos: pos.clone().add(new THREE.Vector3(Math.cos(a) * r, rand(0, 0.3), Math.sin(a) * r)),
        vel: new THREE.Vector3(0, rand(0.8, 2.5), 0), life: rand(0.7, 1.4), size: rand(0.02, 0.045), color: this.MARI, drag: 1, floor: false, fadeIn: 0.1 });
    }
  }

  /** big crystalline burst (shell shatter, spire eruption) */
  saltBurst(pos, power = 1) {
    for (let i = 0; i < 30 * power; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.3, 1.5), rand(-1, 1)).normalize().multiplyScalar(rand(3, 11) * power);
      this.soft.spawn({ pos: pos.clone(), vel: v, life: rand(0.7, 1.6), size: rand(0.06, 0.16), color: this.SALT, gravity: 14, shape: 1 });
    }
    for (let i = 0; i < 16 * power; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 14) * power);
      this.glow.spawn({ pos: pos.clone(), vel: v, life: rand(0.2, 0.5), size: 0.035, color: this.CYAN, stretch: 0.04, drag: 3 });
    }
  }

  /** atmosphere: salt motes hanging in the air around the camera (depth cue, very faint) */
  motesAround(center, dt, night) {
    const rate = 12 * dt;
    for (let i = 0; i < rate; i++) {
      if (Math.random() > rate - i) break;
      const p = center.clone().add(new THREE.Vector3(rand(-18, 18), rand(0.3, 7), rand(-18, 18)));
      const target = night ? this.glow : this.soft;
      target.spawn({ pos: p, vel: new THREE.Vector3(rand(0.1, 0.5), rand(-0.05, 0.12), rand(-0.2, 0.2)), life: rand(3, 6),
        size: rand(0.012, 0.03), color: night ? new THREE.Color(0.5, 0.6, 1.4) : new THREE.Color(1, 0.96, 0.95), alpha: night ? 0.6 : 0.55,
        floor: false, fadeIn: 1.2 });
    }
  }
}
