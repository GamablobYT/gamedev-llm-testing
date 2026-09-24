const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), hp: $('hp-bar'), boss: $('boss-panel'), bossBar: $('boss-bar'), flasks: $('flasks'),
      title: $('title'), prompt: $('t-prompt'), death: $('death'), victory: $('victory'), stats: $('v-stats'),
      namecard: $('namecard'), flash: $('flash'), hurt: $('vignette-hurt'), lock: $('lock-hint'), debug: $('debug'),
    };
    this.flashA = 0;
    this.hurtA = 0;
    this.shown = {};
  }
  show(id, on) {
    const e = this.el[id];
    if (!e || this.shown[id] === on) return;
    this.shown[id] = on;
    e.classList.toggle('hidden', !on);
  }
  setBar(el, frac) {
    const f = Math.max(0, Math.min(1, frac));
    el.querySelector('.fill').style.transform = `scaleX(${f})`;
    el.querySelector('.chip').style.transform = `scaleX(${f})`;
  }
  setFlasks(n, max) {
    if (this.lastFlasks === n) return;
    this.lastFlasks = n;
    this.el.flasks.innerHTML = '';
    for (let i = 0; i < max; i++) {
      const d = document.createElement('div');
      d.className = 'flask' + (i >= n ? ' spent' : '');
      this.el.flasks.appendChild(d);
    }
  }
  playerHurt() {
    this.el.hp.classList.remove('hurt');
    void this.el.hp.offsetWidth;
    this.el.hp.classList.add('hurt');
    this.hurtA = 1;
  }
  flash(a, color = '#ffffff') { this.flashA = Math.max(this.flashA, a); this.el.flash.style.background = color; }
  update(dt) {
    this.flashA = Math.max(0, this.flashA - dt * 3);
    this.hurtA = Math.max(0, this.hurtA - dt * 1.6);
    this.el.flash.style.opacity = this.flashA.toFixed(3);
    this.el.hurt.style.opacity = this.hurtA.toFixed(3);
  }
}
