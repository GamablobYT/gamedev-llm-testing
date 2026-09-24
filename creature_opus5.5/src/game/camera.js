import * as THREE from 'three';
import { clamp, damp, dampAngle, dampVec3, lerp, noise1, smooth, wrapAngle, yawTo } from '../core/util.js';
import { ARENA_R } from '../world/world.js';

/**
 * Third-person camera.
 *  - locked: sits behind the pilgrim on the boss->player line, frames both; pulls back and tilts up
 *    when the player is under the creature.
 *  - free: mouse orbit.
 *  - cinematic: scripted position/target curves (intro, phase change, death, victory).
 */
export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.locked = true;
    this.yaw = Math.PI;
    this.pitch = 0.18;
    this.yawOffset = 0;
    this.pos = new THREE.Vector3(0, 4, 34);
    this.look = new THREE.Vector3(0, 4, 0);
    this.trauma = 0;
    this.shakeT = 0;
    this.fovKick = 0;
    this.baseFov = 56;
    this.cine = null;
    this.t = 0;
  }

  shake(amount, sustain = 0) {
    this.trauma = Math.min(1, this.trauma + amount);
    if (sustain) this.sustain = Math.max(this.sustain || 0, sustain);
  }

  /** scripted shot: fn(t) -> {pos, look, fov}; lasts dur seconds, then blends back */
  cinematic(fn, dur, blendOut = 1.2) { this.cine = { fn, t: 0, dur, blendOut }; }
  stopCinematic() { this.cine = null; }

  /** direction the camera is looking (for movement input) */
  get lookYaw() {
    const d = this.look.clone().sub(this.pos);
    return Math.atan2(d.x, d.z);
  }

  update(dt, input, player, bossFocus, bossBody, allowLook = true) {
    this.t += dt;
    const p = player.root.position;
    const look = allowLook ? input.look() : { x: 0, y: 0 };
    const desiredPos = new THREE.Vector3(), desiredLook = new THREE.Vector3();
    const toBoss = new THREE.Vector3(bossFocus.x - p.x, 0, bossFocus.z - p.z);
    const dBoss = toBoss.length();

    if (this.locked && bossFocus) {
      const want = yawTo(toBoss.x, toBoss.z);
      this.yawOffset = clamp(this.yawOffset - look.x * 0.0022, -0.7, 0.7);
      this.yawOffset = damp(this.yawOffset, 0, 0.8, dt);
      this.yaw = dampAngle(this.yaw, want + this.yawOffset, dBoss < 6 ? 3.0 : 5.0, dt);
      const close = 1 - smooth((dBoss - 5) / 16);         // 1 when under the creature
      const dist = lerp(8.0, 11.5, close);
      const height = lerp(2.5, 1.3, close);
      const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const right = new THREE.Vector3(-f.z, 0, f.x);
      desiredPos.copy(p).addScaledVector(f, -dist).addScaledVector(right, -0.9).add(new THREE.Vector3(0, height, 0));
      // frame vertically: keep the pilgrim's feet in view and fit as much of the creature (head, body) as possible
      const mid = new THREE.Vector3().copy(p).lerp(bossFocus, 0.4);
      const yawLook = Math.atan2(mid.x - desiredPos.x, mid.z - desiredPos.z);
      const ang = (q, y) => Math.atan2(y - desiredPos.y, Math.max(1, Math.hypot(q.x - desiredPos.x, q.z - desiredPos.z)));
      const aFeet = ang(p, 0.1);
      const top = bossBody && bossBody.head ? bossBody.head : bossFocus;
      const aTop = Math.max(ang(top, top.y + 1.0), ang(bossFocus, bossFocus.y + 2.0));
      const half = THREE.MathUtils.degToRad(this.cam.fov) * 0.5 * 0.86;
      let pitch = (aTop + aFeet) * 0.5;
      pitch = Math.min(pitch, aFeet + half * 0.92);
      this.lockPitch = this.lockPitch === undefined ? pitch : damp(this.lockPitch, pitch, 4, dt);
      desiredLook.copy(desiredPos).add(new THREE.Vector3(Math.sin(yawLook) * Math.cos(this.lockPitch), Math.sin(this.lockPitch), Math.cos(yawLook) * Math.cos(this.lockPitch)).multiplyScalar(12));
      this.pitch = 0.2;
    } else {
      this.yaw -= look.x * 0.0026;
      this.pitch = clamp(this.pitch + look.y * 0.0022, -0.25, 0.9);
      const dist = 7.5;
      const f = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), 0, Math.cos(this.yaw) * Math.cos(this.pitch));
      desiredPos.copy(p).addScaledVector(f, -dist).add(new THREE.Vector3(0, 2.2 + Math.sin(this.pitch) * dist, 0));
      const right = new THREE.Vector3(-f.z, 0, f.x).normalize();
      desiredPos.addScaledVector(right, -0.7);
      desiredLook.copy(p).add(new THREE.Vector3(0, 1.6, 0)).addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 4);
    }
    // keep the camera out of the water and inside the world
    desiredPos.y = Math.max(0.6, desiredPos.y);
    const r = Math.hypot(desiredPos.x, desiredPos.z);
    if (r > ARENA_R + 12) desiredPos.multiplyScalar((ARENA_R + 12) / r);

    let fov = this.baseFov + this.fovKick;
    if (this.cine) {
      const c = this.cine;
      c.t += dt;
      const shot = c.fn(Math.min(c.t, c.dur));
      const k = c.t > c.dur ? 1 - smooth((c.t - c.dur) / c.blendOut) : 1;
      if (c.t > c.dur + c.blendOut) this.cine = null;
      desiredPos.lerp(shot.pos, k);
      desiredLook.lerp(shot.look, k);
      if (shot.fov) fov = lerp(fov, shot.fov, k);
      dampVec3(this.pos, desiredPos, shot.snap ? 60 : 4.5, dt);
      dampVec3(this.look, desiredLook, shot.snap ? 60 : 5, dt);
    } else {
      dampVec3(this.pos, desiredPos, 7, dt);
      dampVec3(this.look, desiredLook, 9, dt);
    }
    this.fovKick = damp(this.fovKick, 0, 5, dt);
    this.cam.fov = damp(this.cam.fov, fov, 6, dt);
    this.cam.updateProjectionMatrix();

    // trauma shake (rotational + a little positional)
    if (this.sustain > 0) { this.sustain -= dt; this.trauma = Math.max(this.trauma, 0.35); }
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    const n = this.t * 22;
    this.cam.position.copy(this.pos);
    this.cam.position.x += noise1(n) * s * 0.35;
    this.cam.position.y += noise1(n + 50) * s * 0.3;
    this.cam.lookAt(this.look);
    this.cam.rotateZ(noise1(n + 100) * s * 0.06);
    this.cam.rotateX(noise1(n + 150) * s * 0.035);
  }
}
