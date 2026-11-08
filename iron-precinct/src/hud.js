const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), hp: $('hp-fill'), mode: $('mode'), missiles: $('missiles'), score: $('score'),
      objective: $('objective'), bossBar: $('boss-bar'), bossFill: $('boss-fill'), banner: $('banner'),
      toast: $('toast'), vignette: $('vignette'), crosshair: $('crosshair'), minimap: $('minimap'),
      screen: $('screen'), title: $('screen-title'), sub: $('screen-sub'), controls: $('controls'), cta: $('screen-cta'),
    };
    this.cache = {};
    this.hurtV = 0;
    this.bannerT = 0;
    this.toastT = 0;
    this.mm = this.el.minimap.getContext('2d');
    this.buildMinimapBase();
  }

  set(key, el, prop, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  buildMinimapBase() {
    const L = this.game.level, S = 200, s = S / (L.half * 2);
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#0b1220';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#2b3a55';
    for (const b of L.buildings) {
      if (b.h <= 3) continue;
      g.fillRect((b.minX + L.half) * s, (b.minZ + L.half) * s, (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);
    }
    this.mmBase = c;
    this.mmScale = s;
  }

  drawMinimap() {
    const { game } = this, g = this.mm, s = this.mmScale, h = game.level.half;
    const X = (x) => (x + h) * s, Z = (z) => (z + h) * s;
    g.drawImage(this.mmBase, 0, 0);
    for (const e of game.enemies.list) {
      if (!e.alive || e.type === 'crate') continue;
      if (e.type === 'jammer') {
        g.fillStyle = Math.floor(game.time * 4) % 2 ? '#ffd24a' : '#ff8a2a';
        g.fillRect(X(e.pos.x) - 4, Z(e.pos.z) - 4, 8, 8);
      } else if (e.type === 'boss') {
        g.fillStyle = '#ff7a1a';
        g.beginPath(); g.arc(X(e.pos.x), Z(e.pos.z), 6, 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = '#ff3a4a';
        g.fillRect(X(e.pos.x) - 1.5, Z(e.pos.z) - 1.5, 3, 3);
      }
    }
    g.fillStyle = '#4dff7a';
    for (const p of game.pickups.list) g.fillRect(X(p.g.position.x) - 1.5, Z(p.g.position.z) - 1.5, 3, 3);
    const p = game.player;
    if (!p.dead) {
      g.save();
      g.translate(X(p.pos.x), Z(p.pos.z));
      g.rotate(-p.aimYaw + Math.PI);
      g.fillStyle = '#8ff7ff';
      g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 4); g.lineTo(-4, 4); g.closePath(); g.fill();
      g.restore();
    }
  }

  showScreen(title, sub, cta, showControls = false) {
    this.el.title.textContent = title;
    this.el.sub.innerHTML = sub;
    this.el.cta.textContent = cta;
    this.el.controls.classList.toggle('hidden', !showControls);
    this.el.screen.classList.remove('hidden');
  }

  hideScreen() { this.el.screen.classList.add('hidden'); }

  setPlaying(on) {
    this.el.hud.classList.toggle('hidden', !on);
    this.el.crosshair.classList.toggle('hidden', !on);
  }

  banner(text, dur = 2.5) {
    this.el.banner.textContent = text;
    this.el.banner.style.opacity = 1;
    this.bannerT = dur;
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = 1;
    this.toastT = 1.2;
  }

  hurt() { this.hurtV = 0.8; }

  update(dt) {
    const { game, el } = this, p = game.player;
    const hpPct = Math.round((p.hp / p.maxHp) * 100);
    this.set('hp', el.hp.style, 'width', hpPct + '%');
    this.set('hpLow', el.hp, 'className', hpPct < 30 ? 'low' : '');
    this.set('mode', el.mode, 'textContent', 'MODE: ' + p.stats.label);
    this.set('mis', el.missiles, 'textContent', 'MISSILES: ' + p.missiles);
    this.set('score', el.score, 'textContent', String(game.score));
    this.set('obj', el.objective, 'textContent', game.objectiveText());
    const boss = game.boss;
    const showBoss = !!(boss && boss.alive);
    this.set('bossOn', el.bossBar, 'className', showBoss ? '' : 'hidden');
    if (showBoss) this.set('bossHp', el.bossFill.style, 'width', (boss.hp / boss.maxHp) * 100 + '%');

    el.crosshair.style.left = game.input.mouse.x + 'px';
    el.crosshair.style.top = game.input.mouse.y + 'px';

    this.hurtV = Math.max(0, this.hurtV - dt * 2);
    const lowPulse = hpPct < 30 && !p.dead ? 0.25 + 0.15 * Math.sin(game.time * 6) : 0;
    el.vignette.style.opacity = Math.max(this.hurtV, lowPulse).toFixed(2);
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) el.banner.style.opacity = 0; }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) el.toast.style.opacity = 0; }
    this.drawMinimap();
  }
}
