import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, wrapAngle, yawTo } from '../core/util.js';

export const PLAYER = {
  speed: 6.4, accel: 38, turn: 16,
  hp: 100, flasks: 3, healAmount: 42,
  dodgeSpeed: 13.5, dodgeDecay: 5.5, iframes: [0.02, 0.38],
  attacks: {
    attack1: { dmg: 24, lunge: 3.2, poise: 20, stop: 0.07, shake: 0.18 },
    attack2: { dmg: 26, lunge: 3.6, poise: 22, stop: 0.07, shake: 0.2 },
    attack3: { dmg: 52, lunge: 5.0, poise: 55, stop: 0.13, shake: 0.42 },
  },
};

export class Player {
  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'Pilgrim';
    scene.add(this.root);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.tmp = new THREE.Vector3();
    this.bladeBase = new THREE.Vector3();
    this.bladeTip = new THREE.Vector3();
    this.prevTip = new THREE.Vector3();
    this.rim = new THREE.PointLight(0xffb070, 0, 6, 2);
    scene.add(this.rim);
  }

  async load(loader) {
    const [gltf, meta] = await Promise.all([loader.loadAsync('assets/pilgrim.glb'), fetch('assets/pilgrim_meta.json').then((r) => r.json())]);
    this.meta = meta;
    this.model = gltf.scene;
    this.root.add(this.model);
    const main = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.5 });
    this.bladeUniform = { value: 0 };
    const blade = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 0.85, envMapIntensity: 1.4 });
    blade.onBeforeCompile = (sh) => {
      sh.uniforms.uEdge = this.bladeUniform;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vMask;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMask = uv.x;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uEdge; varying float vMask;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float edgeMask = vMask;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vec3(0.7, 0.92, 1.0) * edgeMask * (0.25 + uEdge * 3.0);`);
    };
    main.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = this.nightU = { value: 0 };
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            // marigold cloth keeps its identity in the dark
            vec3 c = diffuseColor.rgb;
            float mari = smoothstep(0.25, 0.5, c.r - c.b);
            totalEmissiveRadiance += c * mari * (0.06 + uNight * 0.25);
          }`);
    };
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        o.material = o.material.name === 'PL_Blade' ? blade : main;
      }
    });
    this.bones = {};
    this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      const m = meta.clips[clip.name];
      a.setLoop(m.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = true;
      this.actions[clip.name] = a;
    }
    // locomotion blend: idle + run always playing, weights driven by speed
    this.actions.idle.play();
    this.actions.run.play();
    this.actions.run.setEffectiveWeight(0);
    // blade sockets measured in bone space from the rest pose
    this.model.updateMatrixWorld(true);
    const w = this.bones.weapon;
    const conv = (p) => new THREE.Vector3(p[0], p[2], -p[1]);
    // rest: GRIP_R + offsets (Blender coords) -> glTF
    const grip = [-0.3, -0.09, 0.9];
    this.baseLocal = w.worldToLocal(this.root.localToWorld(conv([grip[0], grip[1] - 1.32, grip[2] + 0.02])));
    this.tipLocal = w.worldToLocal(this.root.localToWorld(conv([grip[0], grip[1] - 1.9, grip[2] + 0.3])));
    // scarf springs
    this.springs = [];
    for (let i = 0; i < 4; i++) {
      const b = this.bones[`scarf_${i}`];
      const child = this.bones[`scarf_${i + 1}`];
      const tipLocal = child ? child.position.clone() : new THREE.Vector3(0, 0.25, 0);
      this.springs.push({ b, tipLocal, tip: b.localToWorld(tipLocal.clone()), vel: new THREE.Vector3(), len: tipLocal.length(), k: 90 - i * 12, damp: 5 });
    }
    this.reset(new THREE.Vector3(0, 0, 27), Math.PI);
  }

  reset(pos, yaw) {
    this.root.position.copy(pos);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.vel.set(0, 0, 0);
    this.hp = PLAYER.hp;
    this.flasks = PLAYER.flasks;
    this.state = 'move';
    this.stateT = 0;
    this.combo = 0;
    this.iframes = 0;
    this.hitThisSwing = false;
    this.healPending = 0;
    this.dead = false;
    this.oneShot = null;
    this.mixer.stopAllAction();
    this.actions.idle.play(); this.actions.run.play();
    this.actions.idle.setEffectiveWeight(1); this.actions.run.setEffectiveWeight(0);
    for (const s of this.springs || []) { s.vel.set(0, 0, 0); }
  }

  /** play a one-shot clip over locomotion */
  playOnce(name, fade = 0.08, timeScale = 1) {
    const a = this.actions[name];
    if (this.oneShot && this.oneShot !== a) this.oneShot.fadeOut(fade);
    a.reset();
    a.timeScale = timeScale;
    a.setEffectiveWeight(1);
    a.fadeIn(fade);
    a.play();
    this.oneShot = a;
    this.oneName = name;
    this.oneMeta = this.meta.clips[name];
  }
  endOnce(fade = 0.18) {
    if (this.oneShot) this.oneShot.fadeOut(fade);
    this.oneShot = null;
    this.oneName = null;
  }
  get oneT() { return this.oneShot ? this.oneShot.time : 0; }

  get alive() { return !this.dead; }
  get invulnerable() { return this.iframes > 0 || this.state === 'dodge' && this.inIframes; }

  canAct() { return this.state === 'move'; }

  update(dt, input, camYaw, lockTarget, time) {
    const ctx = this.ctx;
    this.stateT += dt;
    this.iframes = Math.max(0, this.iframes - dt);
    const mv = input.move();
    // camera-relative desired direction
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    // camYaw: camera look direction is (sin, 0, cos); its right vector is (-cos, 0, sin)
    const dx = -mv.x * cos + mv.y * sin;
    const dz = mv.x * sin + mv.y * cos;
    const want = new THREE.Vector3(dx, 0, dz);
    const wantLen = Math.min(1, want.length());

    if (this.dead) {
      this.vel.multiplyScalar(Math.exp(-4 * dt));
    } else if (this.state === 'move') {
      const target = want.clone().multiplyScalar(PLAYER.speed);
      const k = 1 - Math.exp(-PLAYER.accel / PLAYER.speed * dt);
      this.vel.x += (target.x - this.vel.x) * k;
      this.vel.z += (target.z - this.vel.z) * k;
      if (wantLen > 0.1) this.yaw = dampAngle(this.yaw, yawTo(want.x, want.z), PLAYER.turn, dt);
      if (input.take('attack')) this.startAttack('attack1', lockTarget);
      else if (input.take('dodge', 0.2)) this.startDodge(want, lockTarget);
      else if (input.take('heal', 0.2) && this.flasks > 0 && this.hp < PLAYER.hp) this.startHeal();
    } else if (this.state === 'attack') {
      const cfg = PLAYER.attacks[this.oneName];
      const ev = this.oneMeta.events;
      const t = this.oneT;
      // lunge through the windup/active frames
      const [a0, a1] = ev.active;
      const lungeK = t < a1 ? Math.sin(Math.PI * clamp(t / a1)) : 0;
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const lungeScale = this.lungeScale ?? 1;
      this.vel.copy(fwd.multiplyScalar(cfg.lunge * lungeK * lungeScale));
      // light steering before the active frames
      if (t < a0 && wantLen > 0.1) this.yaw = dampAngle(this.yaw, yawTo(want.x, want.z), 6, dt);
      if (lockTarget && t < a0) {
        const aim = this.aimYaw(lockTarget);
        if (aim !== null) this.yaw = dampAngle(this.yaw, aim, 14, dt);
      }
      this.bladeUniform.value = t > a0 - 0.05 && t < a1 + 0.05 ? 1 : Math.max(0, this.bladeUniform.value - dt * 5);
      if (input.peek('attack', 0.4) && ev.chain && t >= ev.chain && this.oneName !== 'attack3') {
        input.take('attack', 0.4);
        this.startAttack(this.oneName === 'attack1' ? 'attack2' : 'attack3', lockTarget);
      } else if (ev.cancel && t >= ev.cancel && input.peek('dodge', 0.3)) {
        input.take('dodge', 0.3);
        this.startDodge(want, lockTarget);
      } else if (t >= this.oneMeta.duration - 0.02) {
        this.toMove();
      }
    } else if (this.state === 'dodge') {
      const t = this.oneT, ev = this.oneMeta.events;
      this.inIframes = t >= PLAYER.iframes[0] && t <= PLAYER.iframes[1];
      const sp = PLAYER.dodgeSpeed * Math.exp(-PLAYER.dodgeDecay * t) * (t < 0.42 ? 1 : 0.3);
      this.vel.copy(this.dodgeDir).multiplyScalar(sp);
      if (Math.random() < 0.9) ctx.fx.skim(this.root.position, this.vel);
      if (Math.floor(time * 30) % 3 === 0) ctx.water.ripple(this.root.position.x, this.root.position.z, 0.35, 3, 0.35, 8, 2.0);
      if (t >= ev.cancel) {
        if (input.peek('attack', 0.3)) { input.take('attack'); this.startAttack('attack1', lockTarget); }
        else if (t >= this.oneMeta.duration - 0.02) this.toMove();
      }
    } else if (this.state === 'heal') {
      const t = this.oneT;
      this.vel.multiplyScalar(Math.exp(-10 * dt));
      if (this.healPending && t >= this.oneMeta.events.heal) {
        this.healPending = 0;
        this.hp = Math.min(PLAYER.hp, this.hp + PLAYER.healAmount);
        ctx.fx.healBurst(this.root.position.clone().add(new THREE.Vector3(0.2, 0.05, 0.3)));
        ctx.water.ripple(this.root.position.x, this.root.position.z, 0.8, 2.2, 0.5, 5, 0.9);
        ctx.audio.play('heal');
        ctx.onHeal && ctx.onHeal();
      }
      if (t >= this.oneMeta.duration - 0.02) this.toMove();
    } else if (this.state === 'hit') {
      this.vel.multiplyScalar(Math.exp(-6 * dt));
      if (this.stateT > this.stunTime) this.toMove();
    }

    // integrate, collide
    this.root.position.addScaledVector(this.vel, dt);
    ctx.collidePlayer(this.root.position);
    this.root.rotation.y = this.yaw;

    // locomotion blend
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const runW = this.state === 'move' && !this.dead ? clamp(sp / PLAYER.speed) : 0;
    this.runW = damp(this.runW || 0, runW, 12, dt);
    // one-shots (attacks, skim, hit, death) replace locomotion instead of averaging with it
    let osw = 0;
    for (const [n, a] of Object.entries(this.actions)) if (n !== 'idle' && n !== 'run' && a.isScheduled()) osw += a.getEffectiveWeight();
    osw = Math.min(1, osw);
    this.actions.run.setEffectiveWeight(this.runW * (1 - osw));
    this.actions.idle.setEffectiveWeight((1 - this.runW) * (1 - osw));
    this.actions.run.timeScale = 0.6 + 0.5 * clamp(sp / PLAYER.speed);
    // footsteps: splash + ripple twice per run cycle
    if (this.runW > 0.5) {
      const ph = (this.actions.run.time / 0.72) % 1;
      const step = ph < 0.5 ? 0 : 1;
      if (step !== this.lastStep) {
        this.lastStep = step;
        const side = step ? -0.12 : 0.12;
        const p = this.root.localToWorld(new THREE.Vector3(side, 0, 0.1));
        ctx.water.ripple(p.x, p.z, 0.25, 2.2, 0.3, 9, 1.8);
        ctx.fx.footSplash(p.setY(0), 0.8);
        ctx.audio.play('foot');
      }
    }

    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    this.updateSprings(dt);
    // blade sockets
    this.prevTip.copy(this.bladeTip);
    this.bones.weapon.localToWorld(this.bladeBase.copy(this.baseLocal));
    this.bones.weapon.localToWorld(this.bladeTip.copy(this.tipLocal));
    // soft marigold rim so the pilgrim reads at night
    this.rim.position.copy(this.root.position).add(new THREE.Vector3(0, 2.2, 0));
  }

  updateSprings(dt) {
    const q = new THREE.Quaternion(), pq = new THREE.Quaternion(), bw = new THREE.Vector3(), tmp = new THREE.Vector3();
    const wind = new THREE.Vector3(0.6, 0, 0.3);
    for (const s of this.springs) {
      const target = s.b.localToWorld(tmp.copy(s.tipLocal));
      s.b.getWorldPosition(bw);
      s.vel.addScaledVector(target.clone().sub(s.tip), s.k * dt);
      s.vel.addScaledVector(wind, dt * 2);
      s.vel.y -= 3 * dt;
      s.vel.multiplyScalar(Math.exp(-s.damp * dt));
      s.tip.addScaledVector(s.vel, Math.min(dt, 1 / 30));
      const dirSim = s.tip.clone().sub(bw).normalize();
      s.tip.copy(bw).addScaledVector(dirSim, s.len);
      const dirAnim = target.sub(bw).normalize();
      q.setFromUnitVectors(dirAnim, dirSim);
      s.b.parent.getWorldQuaternion(pq);
      const wq = s.b.getWorldQuaternion(new THREE.Quaternion());
      s.b.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
      s.b.updateMatrixWorld(true);
    }
  }

  /** yaw toward the nearest hurtbox point of the target within reach */
  aimYaw(target) {
    if (!target) return null;
    const p = this.root.position;
    const d = Math.hypot(target.x - p.x, target.z - p.z);
    if (d > 7) return null;
    return yawTo(target.x - p.x, target.z - p.z);
  }

  toMove() {
    this.state = 'move';
    this.stateT = 0;
    this.endOnce(0.2);
    this.bladeUniform.value = 0;
  }

  startAttack(name, lockTarget) {
    this.state = 'attack';
    this.stateT = 0;
    this.hitThisSwing = false;
    this.swingId = (this.swingId || 0) + 1;
    this.playOnce(name, name === 'attack1' ? 0.06 : 0.05);
    const aim = this.aimYaw(lockTarget);
    if (aim !== null) this.yaw = aim;
    // do not lunge through the target
    if (lockTarget) {
      const d = Math.hypot(lockTarget.x - this.root.position.x, lockTarget.z - this.root.position.z);
      this.lungeScale = clamp((d - 1.2) / 2.5, 0.1, 1);
    } else this.lungeScale = 1;
    this.ctx.audio.play('whoosh', { f: name === 'attack3' ? 300 : 520, dur: name === 'attack3' ? 0.3 : 0.2, gain: 0.35, delay: this.meta.clips[name].events.active[0] - 0.04 });
  }

  startDodge(want, lockTarget) {
    this.state = 'dodge';
    this.stateT = 0;
    let dir = want.clone().setY(0);
    if (dir.lengthSq() < 0.01) {
      // no input: skim away from the creature
      if (lockTarget) dir.set(this.root.position.x - lockTarget.x, 0, this.root.position.z - lockTarget.z);
      else dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    }
    dir.normalize();
    this.dodgeDir = dir;
    this.yaw = yawTo(dir.x, dir.z);
    this.playOnce('dodge', 0.04);
    this.ctx.audio.play('skim');
    this.ctx.fx.splash(this.root.position.clone(), 0.25, dir.clone().multiplyScalar(-1));
    this.ctx.water.ripple(this.root.position.x, this.root.position.z, 0.9, 4, 0.5, 6, 1.4);
  }

  startHeal() {
    this.state = 'heal';
    this.stateT = 0;
    this.flasks--;
    this.healPending = 1;
    this.playOnce('heal', 0.12);
  }

  /** returns true if damage was applied */
  damage(amount, from, knock = 6) {
    if (this.dead || this.invulnerable) return false;
    this.hp -= amount;
    this.iframes = 0.55;
    const dir = this.root.position.clone().sub(from).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    this.vel.copy(dir).multiplyScalar(knock);
    this.yaw = yawTo(-dir.x, -dir.z);
    if (this.hp <= 0) { this.die(); return true; }
    this.state = 'hit';
    this.stateT = 0;
    this.stunTime = amount >= 28 ? 0.62 : 0.42;
    this.healPending = 0;
    this.playOnce('hit', 0.03);
    return true;
  }

  die() {
    this.hp = 0;
    this.dead = true;
    this.state = 'dead';
    this.playOnce('death', 0.06);
  }
}
