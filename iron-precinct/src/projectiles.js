import * as THREE from 'three';
import { lerp } from './util.js';

const COLORS = { bullet: 0x8ff7ff, bolt: 0xff5a2a, missile: 0xffe066, mortar: 0xff7a1a };

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.geo = {
      bullet: new THREE.BoxGeometry(0.22, 0.22, 1.7),
      bolt: new THREE.SphereGeometry(0.38, 8, 6),
      missile: new THREE.BoxGeometry(0.32, 0.32, 1.1),
      mortar: new THREE.SphereGeometry(0.65, 10, 8),
    };
    this.mats = {};
    for (const k in COLORS) this.mats[k] = new THREE.MeshBasicMaterial({ color: COLORS[k] });
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 32);
  }

  /** opts: {type, owner, pos, dir, speed, dmg, life, radius, splash?, target?} */
  spawn(o) {
    const mesh = new THREE.Mesh(this.geo[o.type], this.mats[o.type]);
    mesh.position.copy(o.pos);
    mesh.rotation.y = Math.atan2(o.dir.x, o.dir.z);
    this.game.scene.add(mesh);
    const p = { ...o, id: this.game.nextId(), mesh, vel: o.dir.clone().normalize().multiplyScalar(o.speed), age: 0, trailT: 0 };
    this.list.push(p);
    return p;
  }

  /** Guest: create / update / remove projectiles to match a snapshot list. */
  applyNet(list) {
    const byId = new Map(this.list.map((p) => [p.id, p]));
    const seen = new Set();
    for (const s of list) {
      seen.add(s.i);
      let p = byId.get(s.i);
      if (s.t === 'mortar') {
        if (!p) {
          this.mortar(new THREE.Vector3(s.fx, s.fy, s.fz), new THREE.Vector3(s.tx, 0, s.tz), s.T, 0, s.sp);
          p = this.list[this.list.length - 1];
          p.id = s.i;
        }
        p.age = s.a;
        continue;
      }
      const pos = new THREE.Vector3(s.x, s.y, s.z);
      if (!p) {
        p = this.spawn({ type: s.t, owner: 'net', pos, dir: new THREE.Vector3(s.vx, 0, s.vz), speed: Math.hypot(s.vx, s.vz) || 1 });
        p.id = s.i;
        if (s.t === 'bullet') this.game.effects.muzzle(pos);
      }
      p.mesh.position.copy(pos);
      p.vel.set(s.vx, 0, s.vz);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (!seen.has(this.list[i].id)) this.remove(i);
    }
  }

  /** Guest-side per-frame motion (no collisions or damage). */
  netAnimate(dt) {
    for (const p of this.list) {
      p.age += dt;
      if (p.type === 'mortar') { this.placeMortar(p); continue; }
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.y = Math.atan2(p.vel.x, p.vel.z);
      if (p.type === 'missile') {
        p.trailT -= dt;
        if (p.trailT <= 0) { this.game.effects.trail(p.mesh.position); p.trailT = 0.025; }
      }
    }
  }

  netState() {
    const r2 = (v) => Math.round(v * 100) / 100;
    return this.list.map((p) => p.type === 'mortar'
      ? { i: p.id, t: 'mortar', fx: r2(p.from.x), fy: r2(p.from.y), fz: r2(p.from.z), tx: r2(p.target.x), tz: r2(p.target.z), T: p.T, a: r2(p.age), sp: p.splash }
      : { i: p.id, t: p.type, x: r2(p.mesh.position.x), y: r2(p.mesh.position.y), z: r2(p.mesh.position.z), vx: r2(p.vel.x), vz: r2(p.vel.z) });
  }

  placeMortar(p) {
    const t = Math.min(1, p.age / p.T);
    p.mesh.position.set(lerp(p.from.x, p.target.x, t), lerp(p.from.y, 0.5, t) + Math.sin(t * Math.PI) * 14, lerp(p.from.z, p.target.z, t));
    p.ring.material.opacity = 0.4 + 0.4 * Math.sin(p.age * 20);
    return t;
  }

  remove(i) {
    const p = this.list[i];
    this.game.scene.remove(p.mesh);
    if (p.ring) { this.game.scene.remove(p.ring); p.ring.material.dispose(); }
    this.list.splice(i, 1);
  }

  mortar(from, target, T, dmg, splash) {
    const mesh = new THREE.Mesh(this.geo.mortar, this.mats.mortar);
    mesh.position.copy(from);
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color: 0xff3a1a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(target.x, 0.3, target.z);
    ring.scale.setScalar(splash);
    this.game.scene.add(mesh, ring);
    this.list.push({ id: this.game.nextId(), type: 'mortar', owner: 'enemy', from: from.clone(), target: target.clone(), T, age: 0, dmg, splash, mesh, ring });
  }

  explode(p, pos) {
    this.game.effects.explosion(pos, 1.3);
    this.game.damageArea(pos, p.splash, p.dmg, p.owner, p.ownerSlot);
  }

  update(dt) {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      let dead = false;
      const pos = p.mesh.position;

      if (p.type === 'mortar') {
        if (this.placeMortar(p) >= 1) {
          this.explode(p, p.target.clone().setY(0.6));
          dead = true;
        }
      } else {
        if (p.type === 'missile') {
          p.speed = Math.min(p.speed + 35 * dt, 48);
          if (p.target && p.target.alive) {
            const desired = new THREE.Vector3(p.target.pos.x - pos.x, 0, p.target.pos.z - pos.z).normalize().multiplyScalar(p.speed);
            p.vel.lerp(desired, 1 - Math.exp(-5 * dt));
          }
          p.vel.setLength(p.speed);
          p.trailT -= dt;
          if (p.trailT <= 0) { g.effects.trail(pos); p.trailT = 0.025; }
        }
        pos.addScaledVector(p.vel, dt);
        p.mesh.rotation.y = Math.atan2(p.vel.x, p.vel.z);

        if (p.age > p.life) {
          dead = true;
          if (p.splash) this.explode(p, pos.clone());
        } else if (g.level.blockedAt(pos.x, pos.z, pos.y)) {
          dead = true;
          if (p.splash) this.explode(p, pos.clone());
          else g.effects.sparks(pos, COLORS[p.type], 4);
        } else if (p.owner === 'player') {
          const e = g.enemies.hitTest(pos, p.radius);
          const rival = !e && g.mode.friendlyFire && g.players.find((pl) => pl.slot !== p.ownerSlot && !pl.dead &&
            Math.hypot(pos.x - pl.pos.x, pos.z - pl.pos.z) < pl.radius + p.radius);
          if (rival) {
            dead = true;
            if (p.splash) this.explode(p, pos.clone());
            else {
              rival.damage(p.dmg, p.ownerSlot);
              g.effects.sparks(pos, COLORS.bullet, 5);
              g.audio.play('hit');
            }
          } else if (e) {
            dead = true;
            if (p.splash) this.explode(p, pos.clone());
            else {
              e.damage(p.dmg, p.ownerSlot);
              g.effects.sparks(pos, COLORS.bullet, 5);
              g.audio.play('hit');
            }
          }
        } else {
          for (const pl of g.players) {
            if (!pl.dead && Math.hypot(pos.x - pl.pos.x, pos.z - pl.pos.z) < pl.radius + p.radius) {
              pl.damage(p.dmg);
              g.effects.sparks(pos, COLORS[p.type], 6);
              dead = true;
              break;
            }
          }
        }
      }

      if (dead) this.remove(i);
    }
  }
}
