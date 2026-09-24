import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Renderer } from './render/renderer.js';
import { World, ARENA_R } from './world/world.js';
import { LAYER_NO_REFLECT } from './world/water.js';
import { Input } from './core/input.js';
import { audio } from './core/audio.js';
import { FX } from './fx/particles.js';
import { Telegraphs } from './fx/telegraphs.js';
import { Trail } from './fx/trail.js';
import { Boss } from './actors/boss.js';
import { Brain, BOSS } from './actors/brain.js';
import { Player, PLAYER } from './actors/player.js';
import { CameraRig } from './game/camera.js';
import { HUD } from './ui/hud.js';
import { Autopilot } from './game/autopilot.js';
import { clamp, closestOnSegment, damp, lerp, segSegDist2, smooth } from './core/util.js';

const SPAWN = new THREE.Vector3(0, 0, 27);
const params = new URLSearchParams(location.search);

class Game {
  constructor() {
    this.canvas = document.getElementById('view');
    this.R = new Renderer(this.canvas);
    this.scene = this.R.scene;
    this.camera = this.R.camera;
    this.camera.layers.enable(LAYER_NO_REFLECT);
    this.world = new World(this.R.renderer, this.scene);
    this.water = this.world.water;
    this.R.onResize = (w, h) => this.water.setSize(w, h);
    this.R.resize();
    this.input = new Input(this.canvas);
    this.audio = audio;
    this.fx = new FX(this.scene, this.water);
    this.tele = new Telegraphs(this.scene);
    this.trail = new Trail(this.scene);
    this.hud = new HUD();
    this.rig = new CameraRig(this.camera);
    this.player = new Player(this.scene, this);
    this.boss = new Boss(this.scene, this);
    this.brain = new Brain(this.boss, this);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.slowmo = 1; this.slowmoT = 0; this.slowmoTarget = 1;
    this.hitstopT = 0;
    this.state = 'loading';
    this.attempts = 0;
    this.grade = this.R.grade.uniforms;
    window.__g = this;
    if (params.has('auto')) this.bot = new Autopilot(this, +(params.get('skill') || 0.85));
  }

  async load() {
    const loader = new GLTFLoader();
    await Promise.all([this.world.load(loader), this.boss.load(loader), this.player.load(loader)]);
    this.brain.reset(false);
    this.player.reset(SPAWN, Math.PI);
    this.world.atmo.set('dusk');
    this.state = 'title';
    this.hud.el.prompt.textContent = 'click to wade in';
    this.titleShot();
    // warm up shaders
    this.R.renderer.compile(this.scene, this.camera);
    if (params.has('play')) this.start();
  }

  // ------------------------------------------------------------------ feedback helpers
  shake(a, sustain) { this.rig.shake(a, sustain); }
  flash(a, color = 0xffffff) { this.hud.flash(a, '#' + new THREE.Color(color).getHexString()); }
  chroma(a) { this.chromaV = Math.max(this.chromaV || 0, a); }
  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }
  slow(scale, dur) { this.slowmoTarget = scale; this.slowmoT = dur; }

  hurtPlayer(dmg, from, knock, kind) {
    const p = this.player;
    if (this.state !== 'play' || p.dead) return false;
    if (this.invulnT > 0) return false;
    if (p.invulnerable) {
      if (p.state === 'dodge') this.onPerfectDodge(from);
      return false;
    }
    const ok = p.damage(dmg, from, knock);
    if (!ok) return false;
    (this.dmgLog = this.dmgLog || []).push(`${this.simTime.toFixed(1)} ${kind} ${dmg} ${p.state}`);
    this.hitstop(dmg >= 28 ? 0.11 : 0.07);
    this.shake(dmg >= 28 ? 0.55 : 0.35);
    this.chroma(0.9);
    this.hud.playerHurt();
    this.audio.play('hurt');
    this.fx.splash(p.root.position.clone(), 0.6);
    this.water.ripple(p.root.position.x, p.root.position.z, 1.2, 5, 0.6, 5, 1.1);
    if (p.dead) this.onPlayerDeath();
    return true;
  }

  onPerfectDodge(from) {
    // skimming through danger: brief shimmer, no mechanical reward beyond survival
    if (this.time - (this.lastPerfect || 0) < 0.6) return;
    this.lastPerfect = this.time;
    this.fx.glow.spawn({ pos: this.player.root.position.clone().add(new THREE.Vector3(0, 1, 0)), life: 0.25, size: 1.2,
      color: new THREE.Color(0.8, 0.9, 1).multiplyScalar(2), alpha: 0.5, floor: false });
    this.audio.play('glint');
  }

  collidePlayer(pos) {
    // arena rim: deeper water pushes back
    const r = Math.hypot(pos.x, pos.z);
    if (r > ARENA_R) pos.multiplyScalar(ARENA_R / r);
    // stilt legs
    const probe = new THREE.Vector3(pos.x, 0.9, pos.z), c = new THREE.Vector3();
    for (const h of this.boss.hurt) {
      if (h.part !== 'leg') continue;
      closestOnSegment(probe, h.a, h.b, c);
      if (c.y > 2.6) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), min = h.r + 0.35;
      if (d < min && d > 1e-4) { pos.x = c.x + (dx / d) * min; pos.z = c.z + (dz / d) * min; }
    }
    // salt spires
    for (const s of this.brain.spires) {
      if (s.state !== 'up') continue;
      const dx = pos.x - s.pos.x, dz = pos.z - s.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.25 && d > 1e-4) { pos.x = s.pos.x + (dx / d) * 1.25; pos.z = s.pos.z + (dz / d) * 1.25; }
    }
  }

  /** nearest reachable point on the creature (for attack aim) */
  aimPoint() {
    const p = this.player.root.position;
    const chest = new THREE.Vector3(p.x, 1.2, p.z), c = new THREE.Vector3();
    let best = null, bd = 1e9;
    for (const h of this.boss.hurt) {
      closestOnSegment(chest, h.a, h.b, c);
      if (c.y - h.r > 3.2) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z) - h.r;
      if (d < bd) { bd = d; best = c.clone(); }
    }
    return best || this.boss.bonePos('body');
  }

  // ------------------------------------------------------------------ combat: glaive vs creature
  resolvePlayerHits() {
    const p = this.player;
    if (p.state !== 'attack' || p.hitThisSwing) return;
    const ev = p.oneMeta.events, t = p.oneT;
    if (t < ev.active[0] || t > ev.active[1]) return;
    const cfg = PLAYER.attacks[p.oneName];
    let best = null;
    for (const h of this.boss.hurt) {
      const r2 = (h.r + 0.14) ** 2;
      if (segSegDist2(p.bladeBase, p.bladeTip, h.a, h.b) < r2 || segSegDist2(p.prevTip, p.bladeTip, h.a, h.b) < r2) {
        if (!best || h.mult > best.mult) best = h;
      }
    }
    if (!best) return;
    p.hitThisSwing = true;
    const weak = best.part === 'head' || best.part === 'lantern';
    const contact = closestOnSegment(p.bladeTip, best.a, best.b, new THREE.Vector3());
    const toward = p.bladeTip.clone().sub(p.prevTip);
    const dir = toward.lengthSq() > 1e-6 ? toward.normalize() : new THREE.Vector3(0, 1, 0);
    const pt = contact.addScaledVector(p.bladeTip.clone().sub(contact).normalize(), best.r * 0.9);
    const dealt = this.brain.takeHit(best, cfg.dmg, cfg.poise, pt);
    if (!dealt) return;
    this.fx.hitSpark(pt, dir, weak);
    this.hitstop(cfg.stop + (weak ? 0.05 : 0));
    this.shake(cfg.shake + (weak ? 0.12 : 0));
    this.audio.play('hit', { weak, gain: p.oneName === 'attack3' ? 1.3 : 1, pitch: best.part === 'lantern' ? 0.8 : 1 });
    if (weak) this.chroma(0.35);
    if (pt.y < 1.2) this.water.ripple(pt.x, pt.z, 0.9, 4, 0.5, 6, 1.2);
    this.stats.hits++;
    if (this.pauseOnHit) { this.pauseOnHit = false; this.freezeNext = 2; }
  }

  // ------------------------------------------------------------------ flow
  titleShot() {
    const t0 = this.time;
    this.rig.cinematic((t) => {
      const k = (this.time - t0) * 0.01;
      return { pos: new THREE.Vector3(-4.5 - k * 2, 1.15, 38.5 - k * 3), look: new THREE.Vector3(-6.2, 7.2, -8), fov: 44, snap: this.time - t0 < 0.1 };
    }, 1e9, 2.2);
  }

  start() {
    this.audio.init();
    this.audio.mood('fight');
    this.hud.show('title', false);
    this.hud.show('hud', true);
    this.hud.show('boss', false);
    this.state = 'play';
    this.startTime = this.time;
    this.stats = { hits: 0, flasksUsed: 0 };
    this.input.wantLock = true;
    this.input.requestLock();
    this.rig.stopCinematic();
    this.rig.cine = null;
    const from = this.rig.pos.clone(), look = this.rig.look.clone();
    this.rig.cinematic(() => ({ pos: from, look, fov: 44 }), 0.01, 2.2);
    this.rig.yaw = Math.PI;
  }

  onBossWake() { this.audio.mood('fight'); }
  onBossBay() {
    this.hud.show('namecard', true);
    setTimeout(() => this.hud.show('namecard', false), 3600);
    setTimeout(() => { if (this.state === 'play') this.hud.show('boss', true); }, 1400);
    this.rig.fovKick = 5;
  }

  onTransitionStart() {
    this.invulnT = 3.0;
    const b = this.boss, p = this.player;
    const side = new THREE.Vector3().subVectors(p.root.position, b.root.position).setY(0).normalize();
    const camPos = b.root.position.clone().addScaledVector(side, 21).add(new THREE.Vector3(side.z * 6, 1.3, -side.x * 6));
    this.rig.cinematic(() => ({ pos: camPos, look: b.bonePos('body').add(new THREE.Vector3(0, 2.5, 0)), fov: 50 }), 3.4, 1.4);
  }
  onShatter() {
    this.world.atmo.blendTo('night', 5.5);
    this.audio.mood('night');
    this.slow(0.45, 0.7);
    this.hud.el.boss.querySelector('#boss-name span').textContent = 'the Lantern Unshelled';
  }
  onTransitionEnd() { this.invulnT = 0; }

  onBossDeath() {
    this.hud.show('boss', false);
    this.hitstop(0.22);
    this.slow(0.3, 1.6);
    this.flash(0.5, 0xffe6e0);
    this.shake(0.6);
    this.audio.play('toll', { f: 82 });
    this.state = 'dying';
    this.input.enabled = false;
    const b = this.boss;
    const t0 = this.time;
    const start = this.rig.pos.clone();
    this.rig.cinematic(() => {
      const k = (this.time - t0);
      const c = b.root.position;
      const a = Math.atan2(start.x - c.x, start.z - c.z) + k * 0.06;
      return { pos: new THREE.Vector3(c.x + Math.sin(a) * 24, 2.2 + k * 0.1, c.z + Math.cos(a) * 24), look: new THREE.Vector3(c.x, 3.5 - Math.min(k, 7) * 0.2, c.z), fov: 44 };
    }, 1e9, 2);
  }
  onBossStill() {
    this.world.atmo.blendTo('dawn', 9);
    this.audio.mood('victory');
    this.dimLantern = true;
    setTimeout(() => this.showVictory(), 4200);
  }
  showVictory() {
    this.state = 'victory';
    this.hud.show('hud', false);
    const secs = Math.round(this.time - this.startTime);
    const used = PLAYER.flasks - this.player.flasks;
    this.hud.el.stats.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}  ·  ${used} draught${used === 1 ? '' : 's'}  ·  ${this.attempts + 1} attempt${this.attempts ? 's' : ''}`;
    this.hud.show('victory', true);
    this.input.enabled = true;
    this.input.consumeAnyKey();
  }

  onPlayerDeath() {
    this.state = 'dead';
    this.slow(0.35, 1.4);
    this.audio.mood('death');
    this.audio.play('voice', { f: 95, dur: 1.8, from: 0.8, to: 0.9, gain: 0.5, delay: 0.6 });
    this.deathT = 0;
    this.input.enabled = false;
    setTimeout(() => { this.hud.show('death', true); this.input.enabled = true; this.input.consumeAnyKey(); }, 2400);
  }

  restart(awake) {
    this.fade = 1;
    this.attempts += awake ? 1 : 0;
    this.hud.show('death', false);
    this.hud.show('victory', false);
    this.brain.reset(awake);
    this.player.reset(awake ? new THREE.Vector3(0, 0, 18) : SPAWN, Math.PI);
    this.fx.clear();
    this.tele.clear();
    this.water.clearRipples();
    this.world.atmo.set('dusk');
    this.audio.mood('fight');
    this.dimLantern = false;
    this.grade.uDesat.value = 0;
    this.hud.el.boss.querySelector('#boss-name span').textContent = 'Warden of the Still Water';
    this.hud.show('hud', true);
    this.hud.show('boss', awake);
    this.state = 'play';
    this.input.enabled = true;
    this.startTime = this.time;
    this.stats = { hits: 0, flasksUsed: 0 };
    this.rig.stopCinematic();
    this.rig.yaw = Math.PI;
    this.rig.pos.set(0, 3, this.player.root.position.z + 8);
  }

  // ------------------------------------------------------------------ main loop
  frame() {
    const dtFrame = Math.min(this.clock.getDelta(), 1 / 20);
    const steps = Math.max(1, +(params.get('speed') || 1));
    for (let i = 0; i < steps; i++) this.tick(dtFrame, i === steps - 1);
    // ?tick keeps simulating when the tab is hidden (automated testing only)
    if (params.has('tick') && document.hidden) {
      // MessageChannel is not throttled in background tabs; pace to ~60 Hz
      if (!this._mc) { this._mc = new MessageChannel(); this._mc.port1.onmessage = () => this._pump(); }
      this._next = performance.now() + 16;
      this._mc.port2.postMessage(0);
    } else requestAnimationFrame(() => this.frame());
  }

  _pump() {
    if (performance.now() >= this._next) this.frame();
    else this._mc.port2.postMessage(0);
  }

  tick(dtReal, render) {
    this.time += dtReal;
    // slow motion and hitstop
    if (this.slowmoT > 0) { this.slowmoT -= dtReal; if (this.slowmoT <= 0) this.slowmoTarget = 1; }
    this.slowmo = damp(this.slowmo, this.slowmoTarget, 8, dtReal);
    let dt = dtReal * this.slowmo;
    if (this.hitstopT > 0) { this.hitstopT -= dtReal; dt = 0; }
    if (this.freezeNext && --this.freezeNext === 0) this.paused = true;
    if (this.paused) dt = 0;
    if (this.pauseAt && this.boss.clip === this.pauseAt.clip && this.boss.t >= this.pauseAt.t) { this.paused = true; this.pauseAt = null; dt = 0; }
    this.simTime = (this.simTime || 0) + dt;
    this.invulnT = Math.max(0, (this.invulnT || 0) - dt);
    this.input.update(dtReal);
    if (this.bot) this.bot.update(dt);

    if (this.state === 'title') {
      if (this.input.consumeAnyKey()) this.start();
    } else if ((this.state === 'dead' && this.hud.shown.death) || (this.state === 'victory' && this.hud.shown.victory)) {
      if (this.input.consumeAnyKey()) this.restart(this.state === 'dead');
    }

    const b = this.boss, p = this.player;
    if (this.state !== 'loading') {
      if (this.input.take('lock', 0.3)) { this.rig.locked = !this.rig.locked; }
      const aim = this.state === 'play' ? this.aimPoint() : null;
      const moveYaw = this.rig.lookYaw;
      const playable = this.state === 'play' || this.state === 'dead';
      if (this.state === 'title') p.update(dt, { move: () => ({ x: 0, y: 0 }), take: () => false, peek: () => false }, moveYaw, null, this.simTime);
      else p.update(dt, this.bot && this.state === 'play' ? this.bot : this.input, moveYaw, aim, this.simTime);
      if (playable || this.state === 'dying' || this.state === 'victory' || this.state === 'title') this.brain.update(dt);
      b.update(dt, this.simTime, this.world.atmo);
      if (this.state === 'play') this.resolvePlayerHits();
      if (p.oneName === 'attack3' && p.oneT >= 0.49 && !p.slamDone) {
        p.slamDone = true;
        const tip = p.bladeTip.clone().setY(0);
        this.fx.splash(tip, 0.7); this.water.ripple(tip.x, tip.z, 1.4, 5, 0.6, 5, 1.1);
        this.audio.play('splash', { size: 0.7 }); this.shake(0.2);
      }
      if (p.oneName !== 'attack3') p.slamDone = false;
      this.trail.emitting = p.state === 'attack' && p.oneT > p.oneMeta.events.active[0] - 0.04 && p.oneT < p.oneMeta.events.active[1] + 0.03;
      this.trail.push(p.bladeBase, p.bladeTip, this.simTime);
      p.heldFlasks !== p.flasks && this.hud.setFlasks(p.flasks, PLAYER.flasks);
      p.heldFlasks = p.flasks;

      // phase look: veins, lantern embers, rim light on the pilgrim at night
      const a = this.world.atmo.cur;
      b.shared.uVeins.value = a.veins;
      if (this.dimLantern) b.shared.uDim.value = damp(b.shared.uDim.value, 0.0, 0.7, dt);
      if (a.veins > 0.5 && Math.random() < dt * 6 && this.state !== 'victory') this.fx.ember(b.lanternPos(), 1);
      p.rim.intensity = a.veins * 2.2;
      if (p.nightU) p.nightU.value = a.veins;
      this.tele.color.copy(a.telegraph);
      // camera
      const focus = b.bonePos('body');
      const head = b.bonePos('head');
      const allowLook = this.state === 'play';
      this.rig.update(dtReal, this.input, p, focus, { head }, allowLook);
      this.fx.motesAround(this.camera.position, dt, a.veins > 0.5);
    }
    this.fx.update(dt);
    this.tele.update(dt, this.simTime);
    const focus = this.player.root.position.clone().lerp(this.boss.root.position, 0.4);
    this.world.update(dt, this.simTime, focus);
    this.world.water.uniforms.uGlowPos.value.copy(this.boss.lanternPos ? this.boss.lanternPos() : focus);
    this.world.water.uniforms.uGlowI.value = this.boss.lanternI || 0;

    // HUD + grade
    if (this.state === 'play' || this.state === 'dead') {
      this.hud.setBar(this.hud.el.hp, p.hp / PLAYER.hp);
      this.hud.setBar(this.hud.el.bossBar, this.brain.hpFrac);
    }
    this.hud.update(dtReal);
    const cine = !!this.rig.cine && (this.state === 'play' || this.state === 'dying');
    if (cine !== this._cineHud) { this._cineHud = cine; this.hud.el.hud.style.opacity = cine ? '0.12' : ''; }
    const lockTxt = this.state === 'play' ? (this.rig.locked ? 'view locked · tab to free' : 'view free · tab to lock') : '';
    if (lockTxt !== this._lockTxt) { this._lockTxt = lockTxt; this.hud.el.lock.textContent = lockTxt; }
    this.chromaV = Math.max(0, (this.chromaV || 0) - dtReal * 2.5);
    this.grade.uChroma.value = this.chromaV;
    if (this.state === 'dead') this.grade.uDesat.value = damp(this.grade.uDesat.value, 0.75, 1.5, dtReal);
    this.fade = Math.max(0, (this.fade || 0) - dtReal * 1.5);
    this.grade.uFade.value = smooth(this.fade);
    this.R.bloom.strength = this.world.atmo.cur.bloom;
    this.R.bloom.radius = 0.55;

    if (!render) return;
    // render: mirror first (also refreshes the shadow map), then the frame
    this.R.renderer.shadowMap.needsUpdate = true;
    this.water.renderReflection(this.R.renderer, this.scene, this.camera);
    this.R.render(this.time);
    if (params.has('debug')) this.debugText();
  }

  debugText() {
    const b = this.brain;
    this.hud.el.debug.classList.remove('hidden');
    this.hud.el.debug.textContent = `state ${this.state}  boss ${b.state} ${this.boss.clip} t=${this.boss.t.toFixed(2)}  hp ${b.hp} poise ${b.poise.toFixed(0)}  ph ${b.phase}\n` +
      `player ${this.player.state} hp ${this.player.hp}  fps ${(1 / Math.max(1e-3, this.clock.getDelta() || 0.016)).toFixed(0)}  draws ${this.R.renderer.info.render.calls}`;
  }
}

const game = new Game();
// browsers may start the audio context suspended; wake it on any gesture
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { if (audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume(); });
// debug: stage an attack with the player at a boss-relative offset and freeze at clip time t
window.__stage = async (attack, t, lx = 1.5, lz = 11, opts = {}) => {
  const g = game;
  g.paused = false;
  if (!opts.keep) g.restart(true);
  if (opts.phase2) { g.brain.phase = 2; g.world.atmo.set('night'); g.boss.shatterShell(g.fx, g.water, g.audio); }
  const b = g.boss.root;
  g.player.root.position.copy(b.localToWorld(new THREE.Vector3(lx, 0, lz)));
  g.player.yaw = Math.atan2(b.position.x - g.player.root.position.x, b.position.z - g.player.root.position.z);
  await new Promise((r) => setTimeout(r, opts.settle ?? 1200));
  g.brain.startAttack(attack);
  g.pauseAt = { clip: attack, t };
  const t0 = performance.now();
  while (!g.paused && performance.now() - t0 < 12000) await new Promise((r) => setTimeout(r, 30));
  return { clip: g.boss.clip, t: g.boss.t.toFixed(2), php: g.player.hp };
};
window.__resume = async (clip, t) => {
  const g = game;
  if (clip) g.pauseAt = { clip, t };
  g.paused = false;
  const t0 = performance.now();
  while (clip && !g.paused && performance.now() - t0 < 12000) await new Promise((r) => setTimeout(r, 30));
  return { clip: g.boss.clip, t: g.boss.t.toFixed(2), php: g.player.hp };
};
game.load().then(() => game.frame()).catch((e) => {
  console.error(e);
  document.getElementById('t-prompt').textContent = 'failed to load: ' + e.message;
});
