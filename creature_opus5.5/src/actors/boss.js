import * as THREE from 'three';
import { clamp, lerp, rand } from '../core/util.js';

const LEGS = ['FL', 'FR', 'RL', 'RR'];

function carapaceMaterial(shared, opts = {}) {
  // lacquered chitin: dark base, thin-film sheen that shifts violet/teal at grazing angles
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: opts.roughness ?? 0.3, metalness: 0.0, envMapIntensity: opts.env ?? 0.5,
    iridescence: opts.irid ?? 0.55, iridescenceIOR: 1.35, iridescenceThicknessRange: [260, 520], clearcoat: 0.35, clearcoatRoughness: 0.18 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal; varying float vMask;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position; vMask = uv.x;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uGlowColor, uRim, uFlashColor, uFlashPos; uniform float uVeins, uPoints, uRimI, uFlash, uTime, uDim;
        varying vec3 vLocal; varying float vMask; float gMask;
        vec3 h33(vec3 p) { p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
          return fract(sin(p) * 43758.5453); }
        float cracks(vec3 p) {
          vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
          for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
            vec3 g = vec3(x, y, z); vec3 o = h33(i + g); vec3 r = g + o - f; float d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
          return 1.0 - smoothstep(0.0, 0.12, sqrt(d2) - sqrt(d1));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        gMask = vMask;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - ndv, 3.0);
          totalEmissiveRadiance += uRim * uRimI * rim * 0.35;
          float pointGlow = step(0.55, gMask) * gMask;
          float veinMask = clamp(gMask * 2.0, 0.0, 1.0) * (1.0 - step(0.53, gMask));
          float veins = 0.0;
          if (uVeins > 0.001 && veinMask > 0.01) {
            float c = cracks(vLocal * 1.6) * 0.8 + cracks(vLocal * 3.7) * 0.5;
            float pulse = 0.65 + 0.35 * sin(uTime * 3.0 - vLocal.z * 1.5);
            veins = veinMask * c * uVeins * pulse;
          }
          totalEmissiveRadiance += uGlowColor * (pointGlow * uPoints + veins * 2.2) * uDim;
          float fd = length(-vViewPosition - uFlashPos);
          float local = exp(-fd * fd / 5.0);
          totalEmissiveRadiance += uFlashColor * uFlash * (0.06 + local * (0.9 + 1.5 * rim));
        }`);
  };
  return m;
}

function lanternMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.25, 0.06, 0.05), roughness: 0.35, vertexColors: false, envMapIntensity: 0.6 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uLanternColor, uFlashPos; uniform float uLanternI, uTime, uFlash; uniform vec3 uFlashColor;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float flick = 0.9 + 0.1 * sin(uTime * 13.0) * sin(uTime * 7.3 + 1.0);
          float core = 0.35 + 0.95 * pow(ndv, 1.6);
          totalEmissiveRadiance += uLanternColor * uLanternI * core * flick;
          float fd = length(-vViewPosition - uFlashPos);
          totalEmissiveRadiance += uFlashColor * uFlash * 2.0 * exp(-fd * fd / 5.0);
        }`);
  };
  return m;
}

function crystalMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.8, 0.78, 0.9), roughness: 0.12, metalness: 0.05,
    flatShading: true, envMapIntensity: 1.5, transparent: false });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uCrystalGlow, uFlash; uniform vec3 uCrystalColor, uFlashColor, uFlashPos;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += uCrystalColor * uCrystalGlow * (0.3 + pow(1.0 - ndv, 2.0));
          float fd = length(-vViewPosition - uFlashPos);
          totalEmissiveRadiance += uFlashColor * uFlash * 0.8 * exp(-fd * fd / 5.0);
        }`);
  };
  return m;
}

export class Boss {
  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'HalcyonRoot';
    scene.add(this.root);
    this.shared = {
      uGlowColor: { value: new THREE.Color(1.0, 0.36, 0.26) }, uVeins: { value: 0 }, uPoints: { value: 1.5 },
      uRim: { value: new THREE.Color(1, 0.7, 0.6) }, uRimI: { value: 0.7 }, uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color(1.0, 0.92, 0.95) }, uTime: { value: 0 }, uDim: { value: 1 },
      uFlashPos: { value: new THREE.Vector3() },
      uLanternColor: { value: new THREE.Color(1.0, 0.38, 0.27) }, uLanternI: { value: 2 },
      uCrystalGlow: { value: 0.15 }, uCrystalColor: { value: new THREE.Color(0.7, 0.66, 1.0) },
    };
    this.light = new THREE.PointLight(0xff6a4a, 0, 45, 1.6);
    scene.add(this.light);
    this.hurt = [];
    this.flash = 0;
    this.listeners = [];
    this.tmpV = new THREE.Vector3();
  }

  async load(loader) {
    const [gltf, meta] = await Promise.all([loader.loadAsync('assets/halcyon.glb'), fetch('assets/halcyon_meta.json').then((r) => r.json())]);
    this.meta = meta;
    this.model = gltf.scene;
    this.root.add(this.model);
    const matC = carapaceMaterial(this.shared);
    const matB = carapaceMaterial(this.shared, { roughness: 0.34, env: 0.55 });
    const matL = lanternMaterial(this.shared);
    const matX = crystalMaterial(this.shared);
    this.shell = [];
    this.model.traverse((o) => {
      if (o.isBone) return;
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        const n = o.material.name;
        o.material = n === 'HC_Beak' ? matB : n === 'HC_Lantern' ? matL : n === 'HC_Crystal' ? matX : matC;
        if (o.name.startsWith('Shell_') || (o.parent && o.parent.name.startsWith('Shell_'))) {
          const top = o.name.startsWith('Shell_') ? o : o.parent;
          if (!this.shell.includes(top)) this.shell.push(top);
        }
      }
    });
    // shell geometry was authored in world space; recentre each crystal on its own pivot so it can tumble
    for (const s of this.shell) {
      if (!s.geometry) continue;
      s.geometry.computeBoundingBox();
      const c = s.geometry.boundingBox.getCenter(new THREE.Vector3());
      s.geometry.translate(-c.x, -c.y, -c.z);
      s.position.add(c.multiply(s.scale).applyQuaternion(s.quaternion));
    }
    this.shellRest = this.shell.map((s) => ({ obj: s, parent: s.parent, pos: s.position.clone(), quat: s.quaternion.clone(), scale: s.scale.clone() }));
    this.bones = {};
    this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      const m = meta.clips[clip.name];
      a.setLoop(m && m.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = true;
      this.actions[clip.name] = a;
    }
    this.walkSpeed = meta.walk_speed;

    // measure rest-pose local offsets in three's bone spaces
    this.model.updateMatrixWorld(true);
    const lanternCenterRest = new THREE.Vector3(...meta.clips.idle.sockets.lantern[0]);
    this.lanternLocal = this.bones.lantern.worldToLocal(this.root.localToWorld(lanternCenterRest.clone()));
    // spring bones for the crest plumes
    this.springs = [];
    for (let i = 0; i < 5; i++) {
      const b = this.bones[`quill_${i}`];
      if (!b) continue;
      const tipLocal = new THREE.Vector3(0, i === 0 ? 1.7 : i < 3 ? 1.45 : 1.1, 0);
      const tip = b.localToWorld(tipLocal.clone());
      this.springs.push({ b, tipLocal, tip, vel: new THREE.Vector3(), len: tipLocal.length(), k: 70 - i * 6, damp: 6 });
    }
    this.setupFootLock();
    this.play('rest', 0);
  }

  on(fn) { this.listeners.push(fn); }
  emit(name, data) { for (const f of this.listeners) f(name, data); }

  play(name, fade = 0.25, timeScale = 1) {
    const a = this.actions[name];
    if (!a) { console.warn('missing clip', name); return; }
    const prev = this.action;
    a.reset();
    a.timeScale = timeScale;
    a.setEffectiveWeight(1);
    a.play();
    if (prev && prev !== a && fade > 0) a.crossFadeFrom(prev, fade, false);
    else if (prev && prev !== a) prev.stop();
    this.action = a;
    this.clip = name;
    this.clipMeta = this.meta.clips[name];
    this.lastT = 0;
    this.firedEvents = new Set();
  }
  get t() { return this.action ? this.action.time : 0; }
  get duration() { return this.clipMeta ? this.clipMeta.duration : 1; }
  get done() { return this.action && !this.clipMeta.loop && this.action.time >= this.clipMeta.duration - 1e-3; }
  ev(name) { return this.clipMeta.events[name]; }

  /** socket position (world) from the baked metadata for the current clip at clip-time t */
  socketAt(name, t, clip = this.clip, out = new THREE.Vector3()) {
    const m = this.meta.clips[clip];
    const arr = m.sockets[name];
    const f = clamp(t * this.meta.fps, 0, arr.length - 1);
    const i = Math.floor(f), k = f - i;
    const a = arr[i], b = arr[Math.min(arr.length - 1, i + 1)];
    out.set(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k));
    return this.root.localToWorld(out);
  }
  socketLocal(name, t, clip = this.clip, out = new THREE.Vector3()) {
    const arr = this.meta.clips[clip].sockets[name];
    const a = arr[clamp(Math.round(t * this.meta.fps), 0, arr.length - 1)];
    return out.set(a[0], a[1], a[2]);
  }

  resetState() {
    for (const r of this.shellRest) {
      r.parent.add(r.obj);
      r.obj.position.copy(r.pos); r.obj.quaternion.copy(r.quat); r.obj.scale.copy(r.scale);
      r.obj.visible = true;
    }
    this.shardsLive = [];
    this.shared.uVeins.value = 0; this.shared.uDim.value = 1;
    this.flash = 0;
    this.mixer.stopAllAction();
    this.action = null;
    for (const f of this.feetIK || []) { f.locked = false; f.w = 0; f.fresh = true; }
  }

  update(dt, time, atmo) {
    this.shared.uTime.value = time;
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    this.footLock(dt);
    this.applyJolts(dt);
    this.root.updateMatrixWorld(true);
    // clip events (including foot plants), fired once per crossing
    if (this.clipMeta) {
      const t = this.action.time;
      const t0 = this.lastT;
      const loopWrap = this.clipMeta.loop && t < t0;
      const crossed = (et) => (loopWrap ? (et > t0 || et <= t) : (et > t0 && et <= t)) || (t0 === 0 && et === 0);
      for (const [name, et] of Object.entries(this.clipMeta.events)) {
        if (typeof et !== 'number') continue;
        if (!this.clipMeta.loop && this.firedEvents.has(name)) continue;
        if (crossed(et)) { this.firedEvents.add(name); this.emit(name, { clip: this.clip }); }
      }
      for (const [pt, leg] of this.clipMeta.plants) if (crossed(pt)) this.emit('plant', { leg, clip: this.clip });
      this.lastT = t;
    }
    // springs
    const q = new THREE.Quaternion(), pq = new THREE.Quaternion(), bw = new THREE.Vector3();
    for (const s of this.springs) {
      const target = s.b.localToWorld(this.tmpV.copy(s.tipLocal));
      s.b.getWorldPosition(bw);
      s.vel.addScaledVector(this.tmpV.sub(s.tip), s.k * dt);
      s.vel.y -= 4 * dt;
      s.vel.multiplyScalar(Math.exp(-s.damp * dt));
      s.tip.addScaledVector(s.vel, Math.min(dt, 1 / 30));
      const dirSim = s.tip.clone().sub(bw).normalize();
      s.tip.copy(bw).addScaledVector(dirSim, s.len);
      const dirAnim = target.clone().sub(bw).normalize();
      q.setFromUnitVectors(dirAnim, dirSim);
      s.b.parent.getWorldQuaternion(pq);
      const wq = s.b.getWorldQuaternion(new THREE.Quaternion());
      s.b.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
      s.b.updateMatrixWorld(true);
    }
    // phase-driven look
    const a = atmo.cur;
    this.shared.uRim.value.copy(a.rim); this.shared.uRimI.value = a.rimI;
    this.shared.uCrystalGlow.value = a.crystalGlow;
    const lScale = this.bones.lantern.scale.x;
    const swell = Math.pow(lScale, 2.3);
    this.lanternI = a.lanternI * swell * this.shared.uDim.value;
    this.shared.uLanternI.value = this.lanternI;
    this.flash = Math.max(0, this.flash - dt * 7);
    this.shared.uFlash.value = this.flash;
    if (this.flashWorld && this.ctx.camera) this.shared.uFlashPos.value.copy(this.flashWorld).applyMatrix4(this.ctx.camera.matrixWorldInverse);
    const lp = this.lanternPos();
    this.light.position.copy(lp);
    this.light.intensity = a.lanternLight * swell * this.shared.uDim.value;
    this.light.distance = 32 + 20 * (a.lanternLight > 10 ? 1 : 0);
    this.updateHurtboxes();
    this.updateShards(dt);
  }

  lanternPos(out = new THREE.Vector3()) { return this.bones.lantern.localToWorld(out.copy(this.lanternLocal)); }
  bonePos(name, out = new THREE.Vector3()) {
    // foot "targets" resolve to the real (planted) tibia tip
    if (this.feetIK && name.startsWith('ik_')) return this.footTip(this.feetIK[LEGS.indexOf(name.slice(3))], out);
    return this.bones[name].getWorldPosition(out);
  }

  updateHurtboxes() {
    const H = this.hurt;
    H.length = 0;
    const P = (n) => this.bonePos(n, new THREE.Vector3());
    for (const k of LEGS) {
      H.push({ part: 'leg', leg: k, a: P(`tibia_${k}`), b: P(`ik_${k}`), r: 0.42, mult: 0.75 });
      H.push({ part: 'leg', leg: k, a: P(`femur_${k}`), b: P(`tibia_${k}`), r: 0.5, mult: 0.75 });
    }
    const head = P('head'), tip = P('beak_tip');
    H.push({ part: 'head', a: head, b: tip, r: 0.55, mult: 2.4 });
    H.push({ part: 'neck', a: P('neck_3'), b: head, r: 0.5, mult: 1.4 });
    H.push({ part: 'neck', a: P('neck_1'), b: P('neck_3'), r: 0.6, mult: 1.2 });
    const l = this.lanternPos();
    H.push({ part: 'lantern', a: l, b: l, r: 0.95, mult: 2.0 });
    const body = P('body');
    H.push({ part: 'body', a: body, b: body, r: 1.9, mult: 1.0 });
  }

  /** world positions of the four foot tips */
  feet() { return LEGS.map((k) => ({ k, p: this.bonePos(`ik_${k}`), knee: this.bonePos(`tibia_${k}`) })); }

  /**
   * Foot planting. When an animated foot reaches the salt it is locked in world space, and a two-bone
   * analytic IK (femur + tibia, knee kept in the animated bend plane) holds it there while the root walks,
   * turns or shuffles. Released when the animation lifts the foot or the leg would overstretch.
   */
  setupFootLock() {
    this.model.updateMatrixWorld(true);
    this.feetIK = LEGS.map((k) => {
      const femur = this.bones[`femur_${k}`], tibia = this.bones[`tibia_${k}`], target = this.bones[`ik_${k}`];
      const tipLocal = tibia.worldToLocal(target.getWorldPosition(new THREE.Vector3()));
      return { k, femur, tibia, tipLocal, lock: new THREE.Vector3(), locked: false, w: 0, cur: new THREE.Vector3(), fresh: true };
    });
  }
  footTip(f, out = new THREE.Vector3()) { return f.tibia.localToWorld(out.copy(f.tipLocal)); }
  footLock(dt) {
    if (!this.feetIK) return;
    const off = this.clip === 'death' || this.clip === 'stagger' || this.clip === 'vault' || this.noFootLock;
    const H = new THREE.Vector3(), K = new THREE.Vector3(), F = new THREE.Vector3(), T = new THREE.Vector3();
    const q = new THREE.Quaternion(), pq = new THREE.Quaternion(), wq = new THREE.Quaternion();
    const rotateWorld = (bone, from, to) => {
      q.setFromUnitVectors(from.normalize(), to.normalize());
      bone.parent.getWorldQuaternion(pq);
      bone.getWorldQuaternion(wq);
      bone.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
      bone.updateMatrixWorld(true);
    };
    for (const f of this.feetIK) {
      this.footTip(f, F);
      const grounded = F.y < 0.1 && !off;
      if (grounded && !f.locked) { f.locked = true; f.lock.copy(F); }
      if (!grounded) f.locked = false;
      f.femur.getWorldPosition(H);
      if (f.locked && f.lock.distanceTo(H) > 14.2) f.locked = false;  // overstretched: let it step
      f.w += ((f.locked ? 1 : 0) - f.w) * Math.min(1, dt * (f.locked ? 30 : 9));
      if (f.fresh) { f.w = f.locked ? 1 : 0; f.fresh = false; }
      if (f.w < 0.01) continue;
      T.copy(F).lerp(f.lock, f.w);
      if (T.distanceToSquared(F) < 1e-4) continue;
      f.tibia.getWorldPosition(K);
      const L1 = K.distanceTo(H), L2 = F.distanceTo(K);
      const toT = T.clone().sub(H);
      const d = Math.min(Math.max(toT.length(), 0.5), L1 + L2 - 0.01);
      const dir = toT.normalize();
      const pole = K.clone().sub(H);
      pole.addScaledVector(dir, -pole.dot(dir)).normalize();
      const a = (L1 * L1 + d * d - L2 * L2) / (2 * d);
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const Kn = H.clone().addScaledVector(dir, a).addScaledVector(pole, h);
      rotateWorld(f.femur, K.clone().sub(H), Kn.clone().sub(H));
      this.footTip(f, F);
      rotateWorld(f.tibia, F.clone().sub(Kn), T.clone().sub(Kn));
    }
  }

  /** procedural recoil on the struck limb, layered over the animation */
  jolt(h, s = 1) {
    this.jolts = this.jolts || {};
    const key = h.part === 'leg' ? `femur_${h.leg}` : h.part === 'lantern' ? 'lantern_stalk' : h.part === 'body' ? 'body' : 'neck_4';
    this.jolts[key] = { v: s, sign: Math.random() < 0.5 ? -1 : 1 };
  }
  applyJolts(dt) {
    if (!this.jolts) return;
    for (const [k, j] of Object.entries(this.jolts)) {
      j.v = Math.max(0, j.v - dt * 5);
      const b = this.bones[k];
      if (!b || j.v <= 0) continue;
      const e = j.v * j.v;
      b.rotateX(e * 0.07 * j.sign);
      b.rotateZ(e * 0.05);
    }
  }

  hitFlash(v = 1, at = null) {
    this.flash = Math.max(this.flash, v);
    if (at) this.flashWorld = at.clone();
  }

  // ------------------------------------------------------------------ shell shatter
  shatterShell(fx, water, audio) {
    this.shardsLive = [];
    const center = this.bonePos('body');
    for (const s of this.shell) {
      const wp = s.getWorldPosition(new THREE.Vector3());
      this.scene.attach(s);
      const out = wp.clone().sub(center).setY(0).normalize();
      const v = out.multiplyScalar(rand(6, 12)).add(new THREE.Vector3(0, rand(5, 11), 0));
      const w = new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6));
      this.shardsLive.push({ o: s, v, w, landed: false, age: 0 });
    }
    fx.saltBurst(center, 1.4);
    audio.play('shatter');
  }
  updateShards(dt) {
    if (!this.shardsLive) return;
    for (const s of this.shardsLive) {
      s.age += dt;
      if (!s.landed) {
        s.v.y -= 18 * dt;
        s.o.position.addScaledVector(s.v, dt);
        s.o.rotation.x += s.w.x * dt; s.o.rotation.y += s.w.y * dt; s.o.rotation.z += s.w.z * dt;
        if (s.o.position.y < 0.2 && s.v.y < 0) {
          s.landed = true;
          this.ctx.fx.splash(s.o.position.clone().setY(0), 0.5);
          this.ctx.water.ripple(s.o.position.x, s.o.position.z, 1.1, 5, 0.6, 5, 1.1);
          this.ctx.audio.play('splash', { size: 0.5, gain: 0.6 });
        }
      } else {
        s.o.position.y -= dt * 0.35; // sinking into the brine
        s.o.rotation.x += s.w.x * dt * 0.05;
        if (s.age > 9) s.o.visible = false;
      }
    }
  }
}
