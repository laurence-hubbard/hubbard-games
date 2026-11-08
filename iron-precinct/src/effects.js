import * as THREE from 'three';

const MAX_PARTS = 700;

export class Effects {
  constructor(game) {
    this.game = game;
    this.parts = [];
    this.flashes = [];
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.flashGeo = new THREE.SphereGeometry(1, 16, 12);
    this.matCache = new Map();
  }

  mat(color) {
    let m = this.matCache.get(color);
    if (!m) { m = new THREE.MeshBasicMaterial({ color }); this.matCache.set(color, m); }
    return m;
  }

  particle(pos, vel, color, size, life, gravity = 22) {
    if (this.parts.length >= MAX_PARTS) return;
    const m = new THREE.Mesh(this.geo, this.mat(color));
    m.position.copy(pos);
    m.scale.setScalar(size);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    this.game.scene.add(m);
    this.parts.push({ m, vel, life, max: life, size, gravity, spin: (Math.random() - 0.5) * 10 });
  }

  flash(pos, size, color, life) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(this.flashGeo, mat);
    m.position.copy(pos);
    m.scale.setScalar(size);
    this.game.scene.add(m);
    this.flashes.push({ m, life, max: life, size });
  }

  sparks(pos, color, n = 6, speed = 8) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5)
        .normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      this.particle(pos, v, color, 0.16, 0.25 + Math.random() * 0.2, 15);
    }
  }

  muzzle(pos, color = 0x8ff7ff) { this.flash(pos, 0.55, color, 0.06); }

  explosion(pos, size = 1) {
    this.flash(pos, size * 2.4, 0xff9a3a, 0.3);
    this.flash(pos, size * 1.3, 0xffffff, 0.12);
    const n = Math.min(50, Math.round(10 + size * 9));
    const cols = [0xff8a2a, 0xffd04a, 0xff5a1a, 0x3a3a3a, 0x222222];
    for (let i = 0; i < n; i++) {
      const sp = (6 + Math.random() * 10) * Math.sqrt(size);
      const v = new THREE.Vector3(Math.random() - 0.5, 0.3 + Math.random() * 0.9, Math.random() - 0.5)
        .normalize().multiplyScalar(sp);
      this.particle(pos, v, cols[Math.floor(Math.random() * cols.length)],
        (0.2 + Math.random() * 0.35) * Math.sqrt(size), 0.5 + Math.random() * 0.6);
    }
    this.game.shake(Math.min(1, 0.12 * size + 0.1));
    this.game.audio.play(size >= 4 ? 'bigExplosion' : 'explosion');
  }

  trail(pos) {
    const v = new THREE.Vector3((Math.random() - 0.5) * 1.5, 1 + Math.random(), (Math.random() - 0.5) * 1.5);
    this.particle(pos, v, Math.random() < 0.4 ? 0xffaa33 : 0x8a8f9c, 0.35, 0.35, -2);
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.game.scene.remove(p.m);
        this.parts.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.m.position.addScaledVector(p.vel, dt);
      if (p.m.position.y < 0.1) {
        p.m.position.y = 0.1;
        p.vel.y *= -0.3; p.vel.x *= 0.7; p.vel.z *= 0.7;
      }
      p.m.rotation.x += p.spin * dt;
      p.m.rotation.y += p.spin * dt;
      p.m.scale.setScalar(p.size * (p.life / p.max));
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.game.scene.remove(f.m);
        f.m.material.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      const t = f.life / f.max;
      f.m.scale.setScalar(f.size * (1.5 - 0.5 * t));
      f.m.material.opacity = t;
    }
  }
}
