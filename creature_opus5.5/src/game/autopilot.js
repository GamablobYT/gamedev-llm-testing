import * as THREE from 'three';

/**
 * Test bot (?auto). Plays through the same Input-shaped interface a human uses, so it exercises
 * the real combat code: approaches legs, strikes, skims away from imminent strikes and waves, drinks when low.
 * Used to smoke-test the whole loop (phase change, death, victory) and to sanity-check balance.
 */
export class Autopilot {
  constructor(game, skill = 0.8) {
    this.g = game;
    this.skill = skill;
    this.pending = new Set();
    this.moveV = { x: 0, y: 0 };
    this.log = [];
    this.nextThink = 0;
  }
  // Input interface --------------------------------------------------------
  move() { return this.moveV; }
  take(a) { if (this.pending.has(a)) { this.pending.delete(a); return true; } return false; }
  peek(a) { return this.pending.has(a); }
  look() { return { x: 0, y: 0 }; }

  worldToInput(dir) {
    const yaw = this.g.rig.lookYaw;
    const s = Math.sin(yaw), c = Math.cos(yaw);
    // inverse of: dx = -x c + y s ; dz = x s + y c
    return { x: -dir.x * c + dir.z * s, y: dir.x * s + dir.z * c };
  }

  danger() {
    const g = this.g, b = g.brain, A = b.atk, p = g.player.root.position;
    // ring waves about to reach the player
    for (const w of b.waves) {
      const d = Math.hypot(p.x - w.c.x, p.z - w.c.z);
      const eta = (d - w.r) / w.speed;
      if (!w.hit && eta > 0 && eta < 0.18) return { kind: 'wave', eta };
    }
    for (const s of b.spires) if (s.state === 'pending' && s.t > -0.2 && Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < 1.8) return { kind: 'spire' };
    if (!A) return null;
    const t = g.boss.t, ev = g.boss.clipMeta.events;
    const strike = ev.strike ?? ev.impact ?? ev.land ?? ev.pulse0;
    if (strike === undefined) return null;
    const ts = g.boss.action.timeScale || 1;
    const lead = (strike - t) / ts;
    const { d } = b.rel();
    const threat = (A.fam === 'lance' && d < A.reach + 2) || (A.fam === 'pierce' && A.spot && Math.hypot(p.x - A.spot.x, p.z - A.spot.z) < 3.4) ||
      (A.fam === 'sweep' && d > 2.8 && d < A.rOut + 1) || (A.fam === 'vault' && Math.hypot(p.x - A.target.x, p.z - A.target.z) < 6.5);
    if (A.fam === 'sweep') {
      // dodge as the scything head arrives, not when the sweep starts
      if (t >= ev.strike && t <= ev.strike_end) {
        const hd = g.boss.bonePos('head');
        if (Math.hypot(hd.x - p.x, hd.z - p.z) < 4.2) return { kind: 'sweep' };
      }
      return null;
    }
    const jitter = (1 - this.skill) * 0.25 * (Math.random() - 0.3);
    if (threat && lead > -0.06 + jitter && lead < 0.12 + jitter) return { kind: A.fam, lead };
    return null;
  }

  update(dt) {
    const g = this.g, pl = g.player, b = g.brain, p = pl.root.position;
    this.moveV = { x: 0, y: 0 };
    if (!pl.alive || g.state !== 'play') return;
    const boss = g.boss.root.position;
    const toBoss = new THREE.Vector3(boss.x - p.x, 0, boss.z - p.z);
    const dBoss = toBoss.length();
    const dz = this.danger();
    if (dz && pl.state !== 'dodge') {
      if (Math.random() < this.skill) {
        // skim sideways/away
        const away = toBoss.clone().multiplyScalar(-1).normalize();
        const side = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
        const dir = dz.kind === 'wave' ? toBoss.clone().normalize() : away.multiplyScalar(0.5).add(side).normalize();
        this.moveV = this.worldToInput(dir);
        this.pending.add('dodge');
      }
      return;
    }
    if (pl.hp < 42 && pl.flasks > 0 && !b.atk && dBoss > 9) { this.pending.add('heal'); return; }
    if (pl.hp < 42 && pl.flasks > 0 && dBoss < 12) {
      this.moveV = this.worldToInput(toBoss.clone().multiplyScalar(-1).normalize());
      return;
    }
    // target: the best reachable hurtbox point (stuck head during a lance, lantern when low)
    const aim = g.aimPoint();
    const toAim = new THREE.Vector3(aim.x - p.x, 0, aim.z - p.z);
    const dAim = toAim.length();
    if (dAim > 2.0) this.moveV = this.worldToInput(toAim.normalize());
    else if (pl.state === 'move' || pl.state === 'attack') this.pending.add('attack');
    if (pl.state === 'attack') this.pending.add('attack');
  }
}
