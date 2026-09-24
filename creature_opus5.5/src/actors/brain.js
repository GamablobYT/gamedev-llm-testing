import * as THREE from 'three';
import { clamp, lerp, rand, smooth, wrapAngle, yawTo, segSegDist2 } from '../core/util.js';
import { ARENA_R } from '../world/world.js';

export const BOSS = {
  hp: 2000, phase2At: 0.55,
  poiseMax: 270, poiseDecay: 14, staggerCooldown: 14,
  track: [1.6, 2.3],            // rad/s while winding up (phase 1, 2)
  walkScale: [1.0, 1.3],
  rest: [[0.7, 1.4], [0.25, 0.7]],
  dmg: { lance: 28, sweep: 22, pierce: 26, toll: 20, vault: 30, vaultWave: 14, spire: 22, stomp: 12, slam: 12 },
};

const PLAYER_R = 0.38;

/** Halcyon's behaviour. Owns attack scripts, their telegraphs, hit shapes and the ring waves. */
export class Brain {
  constructor(boss, game) {
    this.boss = boss;
    this.g = game;
    this.waves = [];
    this.spires = [];
    this.tmp = new THREE.Vector3();
    boss.on((name, data) => this.onEvent(name, data));
  }

  reset(awake) {
    const b = this.boss;
    b.resetState();
    b.root.position.set(0, 0, -8);
    b.root.rotation.set(0, 0, 0);
    this.hp = BOSS.hp;
    this.phase = 1;
    this.poise = 0;
    this.lastPoiseT = 0;
    this.staggerReadyT = 0;
    this.history = [];
    this.cooldowns = {};
    this.pendingTransition = false;
    this.clearWaves();
    this.clearSpires();
    this.atk = null;
    this.time = 0;
    if (awake) { this.setState('idle'); this.think = 1.2; b.play('idle', 0); }
    else { this.setState('dormant'); b.play('rest', 0); }
  }

  setState(s) { this.state = s; this.stateT = 0; }
  get hpFrac() { return this.hp / BOSS.hp; }
  get alive() { return this.state !== 'dead'; }

  // -------------------------------------------------------------- geometry helpers
  rel() {
    const p = this.g.player.root.position;
    const l = this.boss.root.worldToLocal(this.tmp.copy(p));
    const d = Math.hypot(l.x, l.z);
    return { d, ang: Math.atan2(l.x, l.z), local: l.clone() };
  }
  /** rotate so that a local bearing `offset` (rad, 0 = forward) points at the target */
  turnToward(rate, dt, target = this.g.player.root.position, offset = 0) {
    const r = this.boss.root;
    const want = yawTo(target.x - r.position.x, target.z - r.position.z) - offset;
    const diff = wrapAngle(want - r.rotation.y);
    r.rotation.y += clamp(diff, -rate * dt, rate * dt);
    return Math.abs(diff);
  }
  forward(out = new THREE.Vector3()) { const y = this.boss.root.rotation.y; return out.set(Math.sin(y), 0, Math.cos(y)); }
  moveForward(dist) {
    const r = this.boss.root;
    r.position.addScaledVector(this.forward(), dist);
    const l = Math.hypot(r.position.x, r.position.z);
    if (l > ARENA_R - 10) r.position.multiplyScalar((ARENA_R - 10) / l);
  }
  playerCapsule() {
    const p = this.g.player.root.position;
    return [new THREE.Vector3(p.x, 0.25, p.z), new THREE.Vector3(p.x, 1.6, p.z)];
  }
  capsuleHitsPlayer(a, b, r) {
    const [pa, pb] = this.playerCapsule();
    return segSegDist2(a, b, pa, pb) < (r + PLAYER_R) ** 2;
  }
  distToPlayer2D(p) {
    const q = this.g.player.root.position;
    return Math.hypot(p.x - q.x, p.z - q.z);
  }
  hurt(kind, from, knock) {
    return this.g.hurtPlayer(BOSS.dmg[kind], from, knock, kind);
  }

  // -------------------------------------------------------------- damage in
  takeHit(h, base, poise, point) {
    if (this.state === 'dead' || this.state === 'transition') return 0;
    if (this.state === 'dormant') { this.wake(); }
    const dmg = Math.round(base * h.mult);
    this.hp = Math.max(0, this.hp - dmg);
    this.poise += poise * (h.part === 'leg' ? 1 : 1.35);
    this.lastPoiseT = this.time;
    this.boss.hitFlash(h.part === 'lantern' || h.part === 'head' ? 1.4 : 1.0, point);
    this.boss.jolt(h, base > 40 ? 1.3 : 1);
    if (this.hp <= 0) { this.die(); return dmg; }
    if (this.phase === 1 && this.hpFrac <= BOSS.phase2At) this.pendingTransition = true;
    if (this.poise >= BOSS.poiseMax && this.time >= this.staggerReadyT && this.state !== 'stagger') this.stagger();
    else if (this.state === 'idle' || this.state === 'move') {
      // small flinch between attacks keeps it feeling alive, without breaking its rhythm
      if (Math.random() < 0.35 && this.boss.clip !== 'hit') { this.boss.play('hit', 0.08); this.setState('flinch'); }
    }
    return dmg;
  }

  // -------------------------------------------------------------- lifecycle
  wake() {
    if (this.state !== 'dormant') return;
    this.boss.play('wake', 0.6);
    this.setState('waking');
    this.g.onBossWake && this.g.onBossWake();
  }

  stagger() {
    this.endAttack(true);
    this.poise = 0;
    this.staggerReadyT = this.time + BOSS.staggerCooldown;
    this.boss.play('stagger', 0.12);
    this.setState('stagger');
    this.g.audio.play('voice', { f: 120, dur: 0.9, from: 1.2, to: 0.6, gain: 0.8, formant: 1.2 });
  }

  die() {
    this.endAttack(true);
    this.clearWaves();
    this.boss.play('death', 0.15);
    this.setState('dead');
    this.g.onBossDeath && this.g.onBossDeath();
  }

  startTransition() {
    this.pendingTransition = false;
    this.endAttack(true);
    this.clearWaves();
    this.boss.play('roar', 0.35);
    this.setState('transition');
    this.g.onTransitionStart && this.g.onTransitionStart();
  }

  // -------------------------------------------------------------- per-frame
  update(dt) {
    this.time += dt;
    this.stateT += dt;
    const b = this.boss;
    if (this.time - this.lastPoiseT > 3) this.poise = Math.max(0, this.poise - BOSS.poiseDecay * dt);
    this.updateWaves(dt);
    this.updateSpires(dt);

    switch (this.state) {
      case 'dormant': {
        const { d } = this.rel();
        if (d < 25 && this.g.player.alive) this.wake();
        break;
      }
      case 'waking':
        if (b.done) { this.setState('idle'); this.think = 0.6; b.play('idle', 0.4); }
        break;
      case 'flinch':
        if (b.done) { this.setState('idle'); this.think = 0.1; b.play('idle', 0.3); }
        break;
      case 'idle': {
        this.think -= dt;
        // turning on planted stilts means stepping: walk-in-place while the heading changes
        const off = Math.abs(this.rel().ang);
        const ts = BOSS.walkScale[this.phase - 1];
        if (off > 0.55 && b.clip !== 'walk') b.play('walk', 0.3, 0.85 * ts);
        if (off < 0.15 && b.clip === 'walk') b.play('idle', 0.4);
        this.turnToward(b.clip === 'walk' ? 1.0 * ts : 0.35, dt);
        if (this.pendingTransition) { this.startTransition(); break; }
        if (this.think <= 0 && this.g.player.alive) this.decide();
        break;
      }
      case 'move': this.updateMove(dt); break;
      case 'attack': this.updateAttack(dt); break;
      case 'stagger':
        if (b.done) {
          if (this.pendingTransition) this.startTransition();
          else { this.setState('idle'); this.think = 0.15; this.preferToll = true; b.play('idle', 0.3); }
        }
        break;
      case 'transition':
        if (b.done) {
          this.phase = 2;
          this.setState('idle'); this.think = 0.4; b.play('idle', 0.4);
          this.g.onTransitionEnd && this.g.onTransitionEnd();
        }
        break;
      case 'dead': break;
    }
  }

  // -------------------------------------------------------------- decisions
  decide() {
    const { d, ang, local } = this.rel();
    const A = Math.abs(ang) * 180 / Math.PI;
    const p2 = this.phase === 2;
    const C = [];
    const cd = (n) => (this.cooldowns[n] || 0) <= this.time;
    if (A < 42 && d > 8.5 && d < 15.5) C.push(['lance', 3]);
    if (A < 60 && d > 5.5 && d < 13) C.push([local.x > 0 ? 'pierce_L' : 'pierce_R', 3]);
    if (A < 110 && d > 3.8 && d < 12) C.push([ang > 0 ? 'sweep_R2L' : 'sweep_L2R', 2.6]);
    if (cd('toll') && (d < 6.5 || (A > 110 && d < 11) || this.preferToll)) C.push([p2 ? 'toll_double' : 'toll', this.preferToll ? 6 : 3.5]);
    if (p2 && cd('vault') && d > 12) C.push(['vault', 4]);
    if (p2 && cd('vault') && d > 6 && Math.random() < 0.15) C.push(['vault', 1.5]);
    if (p2 && cd('spires') && d > 7 && d < 26 && A < 70) C.push(['spires', 2.8]);
    this.preferToll = false;
    const last = this.history[this.history.length - 1], last2 = this.history[this.history.length - 2];
    const fam = (n) => n && n.replace(/_(L|R|R2L|L2R|double)$/, '');
    let total = 0;
    for (const c of C) {
      if (fam(c[0]) === fam(last)) c[1] *= fam(last) === fam(last2) ? 0 : 0.3;
      total += c[1];
    }
    if (total <= 0) { this.startMove(); return; }
    let r = Math.random() * total;
    for (const c of C) { r -= c[1]; if (r <= 0) { this.startAttack(c[0]); return; } }
    this.startAttack(C[C.length - 1][0]);
  }

  startMove() {
    this.setState('move');
    this.moveT = 0;
    this.boss.play('walk', 0.35, BOSS.walkScale[this.phase - 1]);
  }

  updateMove(dt) {
    const b = this.boss;
    this.moveT += dt;
    const { d, ang } = this.rel();
    const A = Math.abs(ang);
    const ts = BOSS.walkScale[this.phase - 1];
    this.turnToward(A > 0.8 ? 1.0 * ts : 0.7 * ts, dt);
    // advance when the player is ahead and not already in reach
    const advance = A < 1.0 && d > 9 ? 1 : A < 0.6 && d > 6.5 ? 0.6 : 0.15;
    this.moveForward(b.walkSpeed * ts * advance * dt);
    b.action.timeScale = ts * (0.55 + 0.45 * advance);
    if (this.pendingTransition) { this.startTransition(); return; }
    if (this.moveT > 0.6 && Math.floor(this.moveT * 5) !== Math.floor((this.moveT - dt) * 5)) {
      // re-evaluate a few times a second; commit to an attack as soon as one fits
      const before = this.state;
      this.decideFromMove();
      if (this.state !== before) return;
    }
    if (this.moveT > 7) this.decide();
  }
  decideFromMove() {
    const { d, ang } = this.rel();
    const A = Math.abs(ang) * 180 / Math.PI;
    if (A < 60 && d < 15.5) this.decide();
    else if (d < 7 && (this.cooldowns.toll || 0) <= this.time) this.decide();
    else if (this.phase === 2 && d > 12 && (this.cooldowns.vault || 0) <= this.time) this.decide();
  }

  // -------------------------------------------------------------- attacks
  startAttack(name, opts = {}) {
    const b = this.boss;
    const ts = opts.timeScale || (this.phase === 2 ? 1.12 : 1.0);
    this.history.push(name);
    if (this.history.length > 6) this.history.shift();
    const fam = name.replace(/_(L|R|R2L|L2R|double)$/, '');
    const cdt = { toll: 6, vault: 9, spires: 10 }[fam];
    if (cdt) this.cooldowns[fam] = this.time + cdt;
    b.play(name, opts.fade ?? 0.28, ts);
    this.setState('attack');
    this.atk = { name, fam, hit: false, tele: null, t0: this.time, combo: opts.combo || 0, slide: 0 };
    const A = this.atk;
    const tl = this.g.tele;
    if (fam === 'lance') {
      A.tele = tl.get();
      const imp = b.socketLocal('beak', b.ev('impact'), name);
      A.reach = imp.z;
    } else if (fam === 'pierce') {
      A.tele = tl.get();
      A.foot = b.ev('foot');
      A.spotLocal = b.socketLocal('foot_' + A.foot, b.ev('impact'), name);
    } else if (fam === 'sweep') {
      A.tele = tl.get();
      const s0 = b.socketLocal('beak', b.ev('strike'), name), s1 = b.socketLocal('beak', b.ev('strike_end'), name);
      A.a0 = Math.atan2(s0.x, s0.z); A.a1 = Math.atan2(s1.x, s1.z);
      let rMax = 0;
      for (let t = b.ev('strike'); t <= b.ev('strike_end'); t += 0.05) { const s = b.socketLocal('beak', t, name); rMax = Math.max(rMax, Math.hypot(s.x, s.z)); }
      A.rOut = rMax + 0.8;
      A.rIn = 3.4;
    } else if (fam === 'toll') {
      A.tele = tl.get();
      A.pulses = Object.keys(b.clipMeta.events).filter((k) => k.startsWith('pulse')).length;
      this.g.audio.play('charge', { dur: b.ev('pulse0') / ts - 0.1 });
    } else if (fam === 'vault') {
      A.tele = tl.get();
      A.from = b.root.position.clone();
      A.target = this.g.player.root.position.clone();
    } else if (fam === 'spires') {
      this.g.audio.play('voice', { f: 150, dur: 1.0, from: 0.9, to: 1.3, gain: 0.5, formant: 1.3 });
    }
  }

  endAttack(interrupted = false) {
    const A = this.atk;
    if (A && A.tele) this.g.tele.release(A.tele, interrupted ? 0.1 : 0.3);
    this.atk = null;
  }

  finishAttack() {
    const A = this.atk;
    this.endAttack();
    // phase 2 chains follow-ups
    if (this.phase === 2 && this.g.player.alive && !this.pendingTransition && A.combo < 1 && Math.random() < 0.55) {
      const { d, ang } = this.rel();
      const next = {
        pierce_L: 'pierce_R', pierce_R: 'pierce_L', sweep_R2L: 'sweep_L2R', sweep_L2R: 'sweep_R2L',
        lance: d > 7 && d < 16 ? 'lance' : null, vault: (this.cooldowns.toll || 0) <= this.time + 3 ? 'toll_double' : null,
      }[A.name];
      if (next && Math.abs(ang) < 1.6) { this.startAttack(next, { combo: A.combo + 1, timeScale: 1.25, fade: 0.2 }); return; }
    }
    if (this.pendingTransition) { this.startTransition(); return; }
    this.setState('idle');
    const [a, bb] = BOSS.rest[this.phase - 1];
    this.think = rand(a, bb);
    this.boss.play('idle', 0.35);
  }

  updateAttack(dt) {
    const b = this.boss, A = this.atk, t = b.t;
    const ev = b.clipMeta.events;
    const rate = BOSS.track[this.phase - 1] * (A.combo ? 1.25 : 1);
    const tracking = ev.track_end === undefined || t < ev.track_end;
    const pl = this.g.player;
    if (tracking && A.fam !== 'vault') this.turnToward(rate, dt, pl.root.position, A.spotLocal ? Math.atan2(A.spotLocal.x, A.spotLocal.z) : 0);
    const yaw = b.root.rotation.y;
    const W = (loc) => b.root.localToWorld(loc.clone());

    if (A.fam === 'lance') {
      // shuffle to put the player on the strike line
      if (tracking) {
        const { d } = this.rel();
        const want = clamp(d - (A.reach - 0.8), -3, 3);
        const step = clamp(want, -2.2 * dt, 2.2 * dt);
        if (Math.abs(A.slide + step) < 3.5) { A.slide += step; this.moveForward(step); }
      }
      if (A.tele) {
        A.tele.line(W(new THREE.Vector3(0, 0, 2.5)), yaw, A.reach + 1.3 - 2.5, 1.7);
        A.tele.u.uProg.value = clamp(t / ev.strike);
      }
      if (t >= ev.strike && t <= ev.impact + 0.1 && !A.hit) {
        if (this.capsuleHitsPlayer(b.bonePos('head'), b.bonePos('beak_tip'), 0.75)) A.hit = this.hurt('lance', b.bonePos('head'), 9);
      }
    } else if (A.fam === 'pierce') {
      if (tracking) {
        const along = this.rel().d - Math.hypot(A.spotLocal.x, A.spotLocal.z);
        const step = clamp(along, -2.0 * dt, 2.0 * dt);
        if (Math.abs(A.slide + step) < 3) { A.slide += step; this.moveForward(step); }
      }
      if (A.tele) {
        A.spot = W(A.spotLocal).setY(0);
        A.tele.circle(A.spot, 2.4);
        A.tele.u.uProg.value = clamp(t / ev.impact);
      }
    } else if (A.fam === 'sweep') {
      if (A.tele) {
        A.tele.sector(b.root.position, yaw, A.rIn, A.rOut, A.a0, A.a1);
        A.tele.u.uProg.value = clamp(t / ev.strike);
      }
      if (t >= ev.strike && t <= ev.strike_end) {
        const head = b.bonePos('head'), tip = b.bonePos('beak_tip'), n3 = b.bonePos('neck_3');
        if (!A.hit && (this.capsuleHitsPlayer(head, tip, 0.8) || this.capsuleHitsPlayer(n3, head, 0.7))) A.hit = this.hurt('sweep', head, 11);
        // wake of spray under the scything head
        if (tip.y < 2.8) {
          this.g.fx.skim(tip.clone().setY(0), this.forward().multiplyScalar(-3));
          if (Math.random() < 0.3) this.g.water.ripple(tip.x, tip.z, 0.9, 4, 0.5, 6, 1.3);
        }
        this.shatterSpiresNear(tip, 1.6);
        this.shatterSpiresNear(head, 1.6);
      }
    } else if (A.fam === 'toll') {
      if (A.tele) {
        A.tele.circle(b.lanternPos().setY(0), 3.2 + 1.5 * smooth(t / ev.pulse0));
        A.tele.u.uProg.value = A.pulses > 1 && t > ev.pulse0 ? clamp((t - ev.pulse0) / (ev.pulse1 - ev.pulse0)) : clamp(t / ev.pulse0);
      }
      if (Math.random() < 0.4) this.g.fx.ember(b.lanternPos(), 1.2);
    } else if (A.fam === 'vault') {
      if (t < ev.track_end) {
        const pp = pl.root.position;
        A.target.lerp(pp, 1 - Math.exp(-6 * dt));
        const l = Math.hypot(A.target.x, A.target.z);
        if (l > ARENA_R - 10) A.target.multiplyScalar((ARENA_R - 10) / l);
        this.turnToward(3, dt, A.target);
        A.from.copy(b.root.position);
      }
      if (A.tele) {
        A.tele.circle(A.target, 5.5);
        A.tele.u.uProg.value = clamp((t - 0.2) / (ev.land - 0.2));
      }
      if (t > ev.liftoff && t < ev.land) {
        const k = smooth((t - ev.liftoff) / (ev.land - ev.liftoff));
        b.root.position.lerpVectors(A.from, A.target, k);
      }
    }
    if (b.done) this.finishAttack();
  }

  // -------------------------------------------------------------- events from the animation
  onEvent(name, data) {
    const b = this.boss, g = this.g, A = this.atk;
    const clip = data.clip;
    if (name === 'plant') {
      const p = b.bonePos('ik_' + data.leg).setY(0);
      const big = clip === 'walk' || clip === 'idle' || clip === 'wake';
      g.water.ripple(p.x, p.z, big ? 1.4 : 1.0, 5, 0.7, 4.5, 1.0);
      g.fx.footSplash(p, big ? 2.2 : 1.5);
      g.audio.play('step', { gain: clamp(1.4 - this.distToPlayer2D(p) / 40, 0.2, 1) });
      g.shake(clamp(0.16 - this.distToPlayer2D(p) / 200, 0.02, 0.12));
      if (!clip.startsWith('pierce') && !clip.startsWith('spires') && this.state !== 'dead' && this.state !== 'dormant' && this.distToPlayer2D(p) < 1.2) this.hurt('stomp', p, 6);
      this.shatterSpiresNear(p, 1.6);
      return;
    }
    if (!A) {
      // non-attack clip events
      if (clip === 'wake' && name === 'bay') {
        g.audio.play('voice', { f: 88, dur: 2.2, from: 0.7, to: 0.8, gain: 1.0 });
        g.shake(0.25);
        g.onBossBay && g.onBossBay();
      }
      if (clip === 'stagger' && name === 'down') {
        const p = b.bonePos('body').setY(0);
        g.water.ripple(p.x, p.z, 2.4, 6, 1.0, 3.5, 0.8);
        g.fx.splash(b.lanternPos().setY(0), 1.3);
        g.audio.play('stomp', { size: 1.1 });
        g.shake(0.4);
      }
      if (clip === 'roar') this.onRoarEvent(name);
      if (clip === 'death') this.onDeathEvent(name);
      return;
    }
    if (A.fam === 'lance') {
      if (name === 'glint') { g.fx.glint(b.bonePos('beak_tip')); g.audio.play('glint'); }
      if (name === 'strike') { g.audio.play('whoosh', { f: 260, dur: 0.22, gain: 0.8 }); if (A.tele) A.tele.u.uFlash.value = 1; }
      if (name === 'impact') {
        const tip = b.bonePos('beak_tip').setY(0);
        g.fx.splash(tip, 1.2, this.forward());
        g.fx.saltBurst(tip, 0.5);
        g.water.ripple(tip.x, tip.z, 2.2, 6, 0.8, 4, 0.9);
        g.audio.play('stomp', { size: 0.9 });
        g.shake(0.35);
        this.g.tele.release(A.tele, 0.4); A.tele = null;
      }
      if (name === 'yank') {
        const tip = b.bonePos('beak_tip').setY(0);
        g.fx.splash(tip, 0.8); g.audio.play('splash', { size: 0.8 });
        g.audio.play('voice', { f: 130, dur: 0.5, from: 0.9, to: 1.2, gain: 0.45, formant: 1.3 });
      }
    } else if (A.fam === 'pierce') {
      if (name === 'strike') { g.audio.play('whoosh', { f: 200, dur: 0.18, gain: 0.7 }); if (A.tele) A.tele.u.uFlash.value = 1; }
      if (name === 'impact') {
        const p = A.spot || b.bonePos('ik_' + A.foot).setY(0);
        if (!A.hit && this.distToPlayer2D(p) < 2.5) A.hit = this.hurt('pierce', p, 8);
        g.fx.splash(p, 1.5); g.fx.saltBurst(p, 0.6);
        g.water.ripple(p.x, p.z, 2.6, 6.5, 0.8, 4, 0.9);
        g.audio.play('stomp', { size: 1.1 });
        g.shake(0.4);
        this.shatterSpiresNear(p, 2.5);
        this.g.tele.release(A.tele, 0.35);
        A.tele = null;
      }
    } else if (A.fam === 'sweep') {
      if (name === 'strike') {
        g.audio.play('whoosh', { f: 180, dur: 0.6, gain: 0.9 });
        g.audio.play('voice', { f: 170, dur: 0.7, from: 1.0, to: 1.25, gain: 0.5, formant: 1.4 });
        if (A.tele) A.tele.u.uFlash.value = 1;
      }
      if (name === 'strike_end') { this.g.tele.release(A.tele, 0.3); A.tele = null; }
    } else if (A.fam === 'toll') {
      if (name.startsWith('pulse')) {
        const c = b.lanternPos().setY(0);
        this.spawnWave(c, 13, 1.3, 34, BOSS.dmg.toll, 'toll');
        g.audio.play('toll', { f: name === 'pulse1' ? 110 : 98 });
        g.water.ripple(c.x, c.z, 3, 13, 1.2, 3, 0.45);
        g.fx.splash(c, 1.0);
        g.shake(0.3);
        g.flash(0.12, 0xff8a70);
        A.lastPulse = name === 'pulse0' && A.pulses > 1;
        if (A.tele) A.tele.u.uFlash.value = 1;
        if (!A.lastPulse && A.tele) { this.g.tele.release(A.tele, 0.4); A.tele = null; }
      }
    } else if (A.fam === 'vault') {
      if (name === 'liftoff') {
        g.fx.splash(b.root.position.clone(), 1.6);
        g.water.ripple(b.root.position.x, b.root.position.z, 2.2, 6, 1, 4, 0.9);
        g.audio.play('stomp', { size: 0.8 });
        g.audio.play('voice', { f: 110, dur: 0.8, from: 0.8, to: 1.2, gain: 0.6 });
      }
      if (name === 'land') {
        const p = A.target.clone().setY(0);
        if (this.distToPlayer2D(p) < 5.5) A.hit = this.hurt('vault', p, 13);
        this.spawnWave(p, 16, 1.1, 14, BOSS.dmg.vaultWave, 'vaultWave', 5.0);
        g.fx.splash(p, 2.4); g.fx.saltBurst(p, 1.0);
        g.water.ripple(p.x, p.z, 3.4, 8, 1.3, 3, 0.6);
        g.audio.play('stomp', { size: 1.6 });
        g.shake(0.75);
        g.flash(0.08, 0xffffff);
        this.shatterSpiresNear(p, 6);
        this.g.tele.release(A.tele, 0.3); A.tele = null;
      }
    } else if (A.fam === 'spires') {
      if (name === 'stab') {
        const p = b.bonePos('ik_FL').add(b.bonePos('ik_FR')).multiplyScalar(0.5).setY(0);
        g.fx.splash(p, 1.4); g.water.ripple(p.x, p.z, 2.4, 6, 0.9, 4, 0.9);
        g.audio.play('stomp', { size: 1.2 }); g.shake(0.4);
      }
      if (name === 'pump0' || name === 'pump1') {
        const origin = b.bonePos('ik_FL').add(b.bonePos('ik_FR')).multiplyScalar(0.5).setY(0);
        const pp = this.g.player.root.position;
        const dir = new THREE.Vector3(pp.x - origin.x, 0, pp.z - origin.z).normalize();
        if (name === 'pump1') dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), rand(-0.35, 0.35));
        this.spawnSpireLine(origin, dir);
        g.audio.play('stomp', { size: 0.7 });
      }
    }
  }

  onRoarEvent(name) {
    const g = this.g, b = this.boss;
    if (name === 'scream') {
      g.audio.play('voice', { f: 78, dur: 2.4, from: 0.6, to: 0.55, gain: 1.2, formant: 0.9 });
      g.audio.play('voice', { f: 156, dur: 2.2, from: 0.8, to: 0.7, gain: 0.5, formant: 1.2, delay: 0.05 });
      g.shake(0.5, 1.2);
      g.chroma(0.8);
    }
    if (name === 'shatter') {
      b.shatterShell(g.fx, g.water, g.audio);
      g.flash(0.35, 0xffffff);
      g.shake(0.7);
      g.onShatter && g.onShatter();
    }
    if (name === 'slam') {
      const p = b.bonePos('ik_FL').add(b.bonePos('ik_FR')).multiplyScalar(0.5).setY(0);
      this.spawnWave(p, 18, 1.2, 18, BOSS.dmg.slam, 'slam');
      g.fx.splash(p, 2.2); g.water.ripple(p.x, p.z, 3.4, 9, 1.3, 3, 0.5);
      g.audio.play('stomp', { size: 1.6 }); g.shake(0.8);
    }
  }

  onDeathEvent(name) {
    const g = this.g, b = this.boss;
    if (name === 'slip') { const p = b.bonePos('ik_FR').setY(0); g.fx.splash(p, 1.2); g.water.ripple(p.x, p.z, 1.8, 6, 0.8, 4, 0.9); g.audio.play('splash', { size: 1 }); }
    if (name === 'collapse') {
      const p = b.bonePos('body').setY(0);
      g.fx.splash(p, 3.0); g.water.ripple(p.x, p.z, 3.5, 7, 1.6, 2.6, 0.4);
      g.audio.play('stomp', { size: 2 }); g.shake(0.9);
    }
    if (name === 'last') g.audio.play('voice', { f: 70, dur: 3.0, from: 0.9, to: 0.5, gain: 0.8, formant: 0.8 });
    if (name === 'still') g.onBossStill && g.onBossStill();
  }

  // -------------------------------------------------------------- ring waves (toll, landings)
  spawnWave(center, speed, width, maxR, dmg, kind, r0 = 1.0) {
    const tele = this.g.tele.get();
    const w = { c: center.clone(), r: r0, speed, width, maxR, dmg, kind, hit: false, tele, occ: this.occluders() };
    tele.ring(w.c, w.r, w.width, w.occ);
    this.waves.push(w);
  }
  updateWaves(dt) {
    const pl = this.g.player;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.r += w.speed * dt;
      w.tele.ring(w.c, w.r, w.width, w.occ);
      w.tele.u.uAlpha.value = 1 - smooth((w.r - w.maxR * 0.7) / (w.maxR * 0.3));
      if (!w.hit && pl.alive) {
        const p = pl.root.position;
        const d = Math.hypot(p.x - w.c.x, p.z - w.c.z);
        if (Math.abs(d - w.r) < w.width * 0.5 + PLAYER_R && !this.occluded(w, p, d)) {
          w.hit = this.g.hurtPlayer(w.dmg, w.c, 8, w.kind);
        }
      }
      if (w.r >= w.maxR) { this.g.tele.release(w.tele, 0.05); this.waves.splice(i, 1); }
    }
  }
  occluded(w, p, d) {
    for (const o of w.occ) {
      const ox = o.x - w.c.x, oz = o.z - w.c.z, ol = Math.hypot(ox, oz);
      if (ol < 0.1 || ol > d) continue;
      const cos = (ox * (p.x - w.c.x) + oz * (p.z - w.c.z)) / (ol * d);
      if (Math.acos(clamp(cos, -1, 1)) < Math.asin(clamp(o.r / ol, 0, 1)) * 0.95) return true;
    }
    return false;
  }
  clearWaves() { for (const w of this.waves) this.g.tele.release(w.tele, 0.05); this.waves.length = 0; }

  // -------------------------------------------------------------- salt spires (phase 2 terrain)
  occluders() { return this.spires.filter((s) => s.state === 'up').map((s) => ({ x: s.pos.x, z: s.pos.z, r: 1.0 })); }
  spawnSpireLine(origin, dir) {
    const reach = Math.min(26, this.distToPlayer2D(origin) + 4);
    for (let i = 0; i < 13; i++) {
      const dist = 3.2 + i * 1.75;
      if (dist > reach) break;
      const pos = origin.clone().addScaledVector(dir, dist).add(new THREE.Vector3(rand(-0.3, 0.3), 0, rand(-0.3, 0.3)));
      if (Math.hypot(pos.x, pos.z) > ARENA_R - 1) break;
      const tele = this.g.tele.get();
      tele.circle(pos, 1.3);
      this.spires.push({ pos, state: 'pending', t: -i * 0.075 - 0.45, delay: 0.45, tele, mesh: null, life: 9 + i * 0.1 });
    }
  }
  updateSpires(dt) {
    const g = this.g;
    for (let i = this.spires.length - 1; i >= 0; i--) {
      const s = this.spires[i];
      s.t += dt;
      if (s.state === 'pending') {
        s.tele.u.uProg.value = clamp((s.t + s.delay) / s.delay);
        if (s.t >= 0) {
          s.state = 'up';
          g.tele.release(s.tele, 0.15);
          const m = g.world.spireTemplate.clone();
          m.rotation.y = rand(0, Math.PI * 2);
          const sc = rand(0.85, 1.2);
          m.scale.set(sc, sc * rand(0.9, 1.3), sc);
          m.position.copy(s.pos).setY(-3);
          s.mat = g.world.mats.Spire.clone();
          m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material = s.mat; } });
          g.scene.add(m);
          s.mesh = m;
          g.fx.saltBurst(s.pos.clone().setY(0.3), 0.5);
          g.fx.splash(s.pos, 0.6);
          g.water.ripple(s.pos.x, s.pos.z, 1.4, 5, 0.6, 5, 1.1);
          if (i % 3 === 0) g.audio.play('shatter');
          if (this.distToPlayer2D(s.pos) < 1.4) this.hurt('spire', s.pos, 7);
        }
      } else if (s.state === 'up') {
        const k = clamp(s.t / 0.16);
        const c1 = 2.2, back = 1 + (c1 + 1) * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
        s.mesh.position.y = -3 + 3 * back;
        // fade spires that stand between the camera and the pilgrim
        const c = g.camera.position, pp = g.player.root.position;
        const vx = pp.x - c.x, vz = pp.z - c.z, L2 = vx * vx + vz * vz;
        const u = clamp(((s.pos.x - c.x) * vx + (s.pos.z - c.z) * vz) / Math.max(1e-3, L2));
        const dSeg = Math.hypot(c.x + vx * u - s.pos.x, c.z + vz * u - s.pos.z);
        const block = u > 0.02 && u < 0.98 && dSeg < 1.7;
        s.mat.opacity += ((block ? 0.16 : 1) - s.mat.opacity) * Math.min(1, dt * 10);
        s.mat.depthWrite = s.mat.opacity > 0.9;
        if (s.t > s.life) this.crumble(s);
      } else if (s.state === 'crumbling') {
        s.mesh.position.y -= dt * 3;
        s.mesh.scale.multiplyScalar(Math.exp(-2 * dt));
        if (s.t > 1.2) { g.scene.remove(s.mesh); this.spires.splice(i, 1); }
      }
    }
  }
  crumble(s) {
    if (s.state !== 'up') return;
    s.state = 'crumbling';
    s.t = 0;
    this.g.fx.saltBurst(s.pos.clone().setY(1), 0.6);
    this.g.audio.play('shatter');
  }
  shatterSpiresNear(p, r) { for (const s of this.spires) if (s.state === 'up' && Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < r) this.crumble(s); }
  clearSpires() {
    for (const s of this.spires) { if (s.mesh) this.g.scene.remove(s.mesh); if (s.tele) this.g.tele.release(s.tele, 0.05); }
    this.spires.length = 0;
  }
}
