import * as THREE from 'three';
import { box, cyl, angleLerp, lerp } from './util.js';

const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3344 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e222b, roughness: 0.6, metalness: 0.6 });
const hazardMat = new THREE.MeshBasicMaterial({ color: 0xd9a400 });
const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });
const orangeGlow = new THREE.MeshBasicMaterial({ color: 0xff7a1a });

class Enemy {
  constructor(game, type, pos, hp, radius) {
    this.game = game;
    this.id = game.nextId();
    this.type = type;
    this.pos = pos.clone();
    this.pos.y = 0;
    this.hp = this.maxHp = hp;
    this.radius = radius;
    this.alive = true;
    this.dormant = true;
    this.solid = false;
    this.isTarget = true;
    this.wakeRange = 48;
    this.score = 100;
    this.boomSize = 1.4;
    this.deathY = 1.5;
    this.dropChance = 0.12;
    this.flashT = 0;
    this.flashing = false;
    this.flashMats = [];
    this.seed = Math.random() * 100;
    this.mesh = new THREE.Group();
    this.mesh.position.copy(this.pos);
    game.scene.add(this.mesh);
  }

  mat(color, opts = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.5, ...opts });
    this.flashMats.push(m);
    return m;
  }

  /** sourceSlot: the player whose shot did this, for kill credit. */
  damage(n, sourceSlot) {
    if (!this.alive) return;
    if (sourceSlot) this.lastHitBy = sourceSlot;
    this.hp -= n;
    this.flashT = 0.08;
    this.dormant = false;
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }

  die() {
    const g = this.game;
    this.alive = false;
    g.scene.remove(this.mesh);
    g.effects.explosion(this.pos.clone().setY(this.deathY), this.boomSize);
    g.addScore(this.score);
    const killer = this.lastHitBy && g.players[this.lastHitBy - 1];
    if (killer && this.type !== 'crate') killer.kills++;
    if (Math.random() < this.dropChance) g.pickups.spawn(Math.random() < 0.5 ? 'health' : 'ammo', this.pos);
    this.onDeath?.();
  }

  baseUpdate(dt) {
    const p = (this.target = this.game.nearestPlayer(this.pos));
    if (p) {
      this.dx = p.pos.x - this.pos.x;
      this.dz = p.pos.z - this.pos.z;
      this.dist = Math.hypot(this.dx, this.dz) || 0.0001;
    } else {
      this.dx = 0; this.dz = 1; this.dist = Infinity;
    }
    if (this.dormant && this.dist < this.wakeRange) this.dormant = false;
    if (this.flashT > 0) this.flashT -= dt;
    const want = this.flashT > 0;
    if (want !== this.flashing) {
      this.flashing = want;
      for (const m of this.flashMats) m.emissive.setHex(want ? 0xff7755 : 0x000000);
    }
  }

  canSeePlayer(y = 2) {
    return !!this.target && this.game.level.lineOfSight(this.pos, this.target.pos, y);
  }

  fireBolt(from, speed, dmg, yawOffset = 0) {
    const p = this.target.pos;
    const a = Math.atan2(p.x - from.x, p.z - from.z) + yawOffset;
    this.game.projectiles.spawn({
      type: 'bolt', owner: 'enemy', pos: from, dir: new THREE.Vector3(Math.sin(a), 0, Math.cos(a)),
      speed, dmg, life: 2.5, radius: 0.6,
    });
    this.game.audio.play('enemyShoot');
  }
}

export class Drone extends Enemy {
  constructor(game, pos) {
    super(game, 'drone', pos, 30, 1.2);
    this.alt = 4.2;
    this.fireCd = 1 + Math.random() * 2;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = 2;
    const hull = this.mat(0x434a58);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 10), hull);
    body.castShadow = true;
    this.mesh.add(body);
    this.mesh.add(box(0.55, 0.22, 0.15, eyeMat, 0, 0, 0.76));
    const a1 = box(2.6, 0.14, 0.22, hull); a1.rotation.y = Math.PI / 4;
    const a2 = box(2.6, 0.14, 0.22, hull); a2.rotation.y = -Math.PI / 4;
    this.mesh.add(a1, a2);
    const rotorMat = new THREE.MeshBasicMaterial({ color: 0xaabbcc, transparent: true, opacity: 0.35 });
    this.rotors = [];
    for (const [x, z] of [[0.92, 0.92], [-0.92, 0.92], [0.92, -0.92], [-0.92, -0.92]]) {
      const r = cyl(0.55, 0.55, 0.04, rotorMat, x, 0.18, z, 12);
      r.castShadow = false;
      this.rotors.push(r);
      this.mesh.add(r);
    }
    this.mesh.add(box(0.3, 0.1, 0.3, eyeMat, 0, -0.8, 0));
  }

  update(dt) {
    this.baseUpdate(dt);
    const g = this.game, t = g.time;
    for (const r of this.rotors) r.scale.x = r.scale.z = 0.8 + 0.2 * Math.sin(t * 40 + this.seed);
    this.mesh.position.set(this.pos.x, this.alt + Math.sin(t * 3 + this.seed) * 0.3, this.pos.z);
    if (this.dormant) return;
    const nx = this.dx / this.dist, nz = this.dz / this.dist;
    let mx = 0, mz = 0;
    if (this.dist > 17) { mx = nx; mz = nz; } else if (this.dist < 10) { mx = -nx; mz = -nz; }
    this.strafeT -= dt;
    if (this.strafeT < 0) { this.strafe *= -1; this.strafeT = 1.5 + Math.random() * 2; }
    mx += -nz * this.strafe * 0.7;
    mz += nx * this.strafe * 0.7;
    this.pos.x += mx * 7 * dt;
    this.pos.z += mz * 7 * dt;
    g.level.resolveCircle(this.pos, this.radius);
    g.enemies.separate(this);
    this.mesh.rotation.y = Math.atan2(this.dx, this.dz);

    this.fireCd -= dt;
    if (this.fireCd <= 0 && this.dist < 26 && this.target) {
      if (this.canSeePlayer(this.alt)) {
        this.fireBolt(this.mesh.position.clone(), 20, 6);
        this.fireCd = 1.5 + Math.random() * 0.9;
      } else this.fireCd = 0.5;
    }
  }
}

export class Turret extends Enemy {
  constructor(game, pos) {
    super(game, 'turret', pos, 70, 1.5);
    this.solid = true;
    this.score = 150;
    this.fireCd = Math.random() * 2;
    this.burst = 0;
    this.burstT = 0;
    this.deathY = 1;
    const hull = this.mat(0x5a6170);
    this.mesh.add(cyl(1.3, 1.6, 1.0, darkMat, 0, 0.5, 0, 12));
    this.head = new THREE.Group();
    this.head.position.y = 1.4;
    this.head.add(box(1.7, 0.9, 1.7, hull));
    this.head.add(box(0.85, 0.15, 0.05, eyeMat, 0, 0.2, 0.86));
    for (const sx of [-0.38, 0.38]) {
      const b = cyl(0.13, 0.13, 1.6, darkMat, sx, -0.1, 1.2, 8);
      b.rotation.x = Math.PI / 2;
      this.head.add(b);
    }
    this.mesh.add(this.head);
  }

  update(dt) {
    this.baseUpdate(dt);
    if (this.dormant) return;
    const g = this.game;
    const yaw = Math.atan2(this.dx, this.dz);
    this.head.rotation.y = angleLerp(this.head.rotation.y, yaw, 1 - Math.exp(-4 * dt));
    this.fireCd -= dt;
    if (this.burst > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        this.burst--;
        this.burstT = 0.15;
        const hy = this.head.rotation.y;
        this.fireBolt(new THREE.Vector3(this.pos.x + Math.sin(hy) * 2, 1.4, this.pos.z + Math.cos(hy) * 2), 24, 7);
      }
    } else if (this.fireCd <= 0 && this.dist < 32 && this.target) {
      if (this.canSeePlayer(1.4)) { this.burst = 3; this.burstT = 0; this.fireCd = 2.6; }
      else this.fireCd = 0.6;
    }
  }
}

export class Rammer extends Enemy {
  constructor(game, pos) {
    super(game, 'rammer', pos, 45, 1.5);
    this.score = 120;
    this.yaw = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.state = 'chase';
    this.stateT = 0;
    this.deathY = 1;
    const hull = this.mat(0x8a1f2a);
    this.mesh.add(box(2.0, 0.8, 3.2, hull, 0, 0.9, 0));
    this.mesh.add(box(1.6, 0.6, 1.4, darkMat, 0, 1.6, -0.3));
    this.mesh.add(box(2.1, 0.12, 0.3, hazardMat, 0, 1.0, 1.55));
    this.mesh.add(box(0.4, 0.2, 0.05, headlightMat, -0.6, 1.0, 1.62), box(0.4, 0.2, 0.05, headlightMat, 0.6, 1.0, 1.62));
    const spikeGeo = new THREE.ConeGeometry(0.18, 0.8, 6);
    for (const sx of [-0.6, 0, 0.6]) {
      const s = new THREE.Mesh(spikeGeo, darkMat);
      s.rotation.x = Math.PI / 2;
      s.position.set(sx, 0.8, 2.0);
      this.mesh.add(s);
    }
    this.wheels = [];
    for (const [x, z] of [[1.1, 1.1], [-1.1, 1.1], [1.1, -1.1], [-1.1, -1.1]]) {
      const w = cyl(0.5, 0.5, 0.4, darkMat, x, 0.5, z, 12);
      w.rotation.z = Math.PI / 2;
      this.wheels.push(w);
      this.mesh.add(w);
    }
  }

  update(dt) {
    this.baseUpdate(dt);
    const g = this.game, p = this.target;
    if (this.dormant || !p) return;
    if (this.state === 'chase') {
      this.yaw = angleLerp(this.yaw, Math.atan2(this.dx, this.dz), 1 - Math.exp(-2.5 * dt));
      this.speed = Math.min(this.speed + 18 * dt, 15);
      if (this.dist < this.radius + p.radius + 0.4) {
        p.damage(14);
        p.knock(this.dx / this.dist, this.dz / this.dist, 14);
        g.effects.sparks(p.pos.clone().setY(1.5), 0xffd04a, 10);
        g.shake(0.4);
        this.state = 'recoil';
        this.stateT = 1.3;
        this.speed = -8;
      }
    } else {
      this.stateT -= dt;
      this.speed = lerp(this.speed, -3, 1 - Math.exp(-2 * dt));
      if (this.stateT <= 0) this.state = 'chase';
    }
    this.pos.x += Math.sin(this.yaw) * this.speed * dt;
    this.pos.z += Math.cos(this.yaw) * this.speed * dt;
    if (g.level.resolveCircle(this.pos, this.radius)) this.speed *= 0.6;
    g.enemies.separate(this);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    for (const w of this.wheels) w.rotation.x += this.speed * dt * 2;
  }
}

export class Jammer extends Enemy {
  constructor(game, pos) {
    super(game, 'jammer', pos, 240, 2.2);
    this.solid = true;
    this.score = 1000;
    this.boomSize = 3;
    this.deathY = 3;
    this.dropChance = 1;
    this.isObjective = true;
    this.wakeRange = 45;
    this.spawnT = 3;
    this.spawned = [];
    const hull = this.mat(0x3d4250);
    this.mesh.add(box(3.4, 1.2, 3.4, hull, 0, 0.6, 0));
    this.mesh.add(box(3.5, 0.2, 3.5, hazardMat, 0, 1.1, 0));
    this.mesh.add(cyl(0.35, 0.55, 8, hull, 0, 5.2, 0));
    this.dish = new THREE.Group();
    this.dish.position.y = 8.2;
    this.dish.add(box(3.0, 0.2, 0.6, darkMat));
    this.dish.add(box(0.2, 1.2, 0.2, eyeMat, 1.5, 0.5, 0), box(0.2, 1.2, 0.2, eyeMat, -1.5, 0.5, 0));
    this.mesh.add(this.dish);
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 10), eyeMat);
    this.core.position.y = 9.6;
    this.mesh.add(this.core);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.1, 40), new THREE.MeshBasicMaterial({
      color: 0xff2a3a, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.3;
    this.ring = ring;
    this.mesh.add(ring);
  }

  update(dt) {
    this.baseUpdate(dt);
    const g = this.game, t = g.time;
    this.dish.rotation.y += dt * 1.5;
    this.core.scale.setScalar(1 + 0.25 * Math.sin(t * 6));
    this.ring.material.opacity = 0.35 + 0.3 * Math.sin(t * 4);
    if (this.dormant || !this.target) return;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.dist < 50) {
      this.spawnT = 7;
      this.spawned = this.spawned.filter((e) => e.alive);
      if (this.spawned.length < 3) {
        const a = Math.random() * Math.PI * 2;
        const d = g.enemies.spawn('drone', this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 3, 0, Math.sin(a) * 3)));
        d.dormant = false;
        this.spawned.push(d);
        g.effects.sparks(this.pos.clone().setY(8), 0xff3344, 12);
      }
    }
  }

  onDeath() { this.game.onJammerDestroyed(this); }
}

export class Boss extends Enemy {
  constructor(game, pos) {
    super(game, 'boss', pos, 1500, 4.8);
    this.solid = true;
    this.dormant = false;
    this.score = 5000;
    this.boomSize = 6;
    this.deathY = 3.5;
    this.dropChance = 0;
    this.isBoss = true;
    this.yaw = 0;
    this.attackT = 3;
    this.cycle = 0;
    this.volley = null;
    this.walk = 0;
    const hull = this.mat(0x3b3f4a);
    const accent = this.mat(0xc2571a);
    this.mesh.add(box(7, 2.6, 8.5, hull, 0, 3.6, 0));
    this.mesh.add(box(7.4, 0.6, 6, accent, 0, 5.1, -0.5));
    this.mesh.add(box(7.1, 0.3, 0.4, hazardMat, 0, 2.5, 4.3));
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), orangeGlow);
    core.position.set(0, 3.6, 4.2);
    this.mesh.add(core);
    this.core = core;
    const turret = new THREE.Group();
    turret.position.y = 6.1;
    turret.add(box(3.8, 1.4, 3.8, hull));
    turret.add(box(2.4, 0.25, 0.05, eyeMat, 0, 0.3, 1.92));
    for (const sx of [-0.9, 0.9]) {
      const c = cyl(0.35, 0.4, 4, darkMat, sx, 0, 2.7, 10);
      c.rotation.x = Math.PI / 2;
      turret.add(c);
    }
    this.mesh.add(turret);
    this.legs = [];
    for (const sx of [-1, 1]) {
      for (const z of [-3, 0, 3]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * 3.4, 3.4, z);
        pivot.add(box(2.8, 0.7, 0.8, accent, sx * 1.4, 0, 0));
        pivot.add(box(0.8, 3.6, 0.8, darkMat, sx * 2.8, -1.6, 0));
        this.mesh.add(pivot);
        this.legs.push({ pivot, phase: (z / 3 + (sx > 0 ? 1 : 0)) * Math.PI / 2 });
      }
    }
  }

  update(dt) {
    this.baseUpdate(dt);
    const g = this.game, p = this.target;
    const enraged = this.hp < this.maxHp * 0.5;
    if (!p) { this.mesh.position.set(this.pos.x, 0, this.pos.z); return; }
    this.yaw = angleLerp(this.yaw, Math.atan2(this.dx, this.dz), 1 - Math.exp(-1.2 * dt));
    let speed = 0;
    if (this.dist > 20) speed = enraged ? 6 : 4.5;
    else if (this.dist < 12) speed = -3;
    this.pos.x += Math.sin(this.yaw) * speed * dt;
    this.pos.z += Math.cos(this.yaw) * speed * dt;
    g.level.resolveCircle(this.pos, this.radius);
    this.walk += Math.abs(speed) * dt * 1.2 + dt * 0.5;
    for (const l of this.legs) {
      l.pivot.rotation.y = Math.sin(this.walk + l.phase) * 0.3;
      l.pivot.position.y = 3.4 + Math.max(0, Math.sin(this.walk + l.phase)) * 0.4;
    }
    this.mesh.position.set(this.pos.x, Math.sin(this.walk * 2) * 0.1, this.pos.z);
    this.mesh.rotation.y = this.yaw;
    this.core.scale.setScalar(1 + 0.15 * Math.sin(g.time * (enraged ? 14 : 6)));

    if (this.volley) {
      this.volley.t -= dt;
      if (this.volley.t <= 0) {
        this.volley.t = 0.35;
        const from = new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * 5, 3.6, this.pos.z + Math.cos(this.yaw) * 5);
        const off = this.volley.n % 2 ? 0.07 : 0;
        for (let k = -4; k <= 4; k++) this.fireBolt(from.clone(), 17, 9, k * 0.15 + off);
        if (--this.volley.n <= 0) this.volley = null;
      }
    }
    this.attackT -= dt;
    if (this.attackT <= 0) {
      const kind = this.cycle++ % 3;
      if (kind === 0 || (kind === 2 && !enraged)) {
        this.volley = { n: enraged ? 4 : 3, t: 0 };
      } else if (kind === 1) {
        const from = this.pos.clone().setY(7);
        const count = enraged ? 7 : 5;
        for (let i = 0; i < count; i++) {
          const target = p.pos.clone().addScaledVector(p.vel, 1.0);
          if (i > 0) target.add(new THREE.Vector3((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12));
          g.projectiles.mortar(from, target, 1.4 + i * 0.08, 18, 3.5);
        }
        g.audio.play('missile');
      } else {
        for (const s of [-1, 1]) {
          const side = new THREE.Vector3(Math.cos(this.yaw) * s * 7, 0, -Math.sin(this.yaw) * s * 7);
          const r = g.enemies.spawn('rammer', this.pos.clone().add(side));
          r.dormant = false;
        }
        g.effects.sparks(this.pos.clone().setY(4), 0xff7a1a, 20);
      }
      this.attackT = enraged ? 2.2 : 3.2;
    }
  }

  onDeath() { this.game.onBossDestroyed(this); }
}

export class Crate extends Enemy {
  constructor(game, pos) {
    super(game, 'crate', pos, 15, 1.1);
    this.solid = true;
    this.isTarget = false;
    this.wakeRange = 0;
    this.score = 10;
    this.boomSize = 0.7;
    this.deathY = 0.8;
    this.dropChance = 0.5;
    this.mesh.add(box(1.6, 1.6, 1.6, this.mat(0x6b5a3a, { metalness: 0.1, roughness: 0.9 }), 0, 0.8, 0));
    this.mesh.add(box(1.65, 0.25, 1.65, hazardMat, 0, 1.2, 0));
    this.mesh.rotation.y = Math.random() * Math.PI;
  }

  update(dt) { this.baseUpdate(dt); }
}

const TYPES = { drone: Drone, turret: Turret, rammer: Rammer, jammer: Jammer, boss: Boss, crate: Crate };

export class Enemies {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(type, pos) {
    const e = new TYPES[type](this.game, pos);
    this.list.push(e);
    return e;
  }

  update(dt) {
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.alive) e.update(dt);
    }
    this.list = this.list.filter((e) => e.alive);
  }

  hitTest(pos, r) {
    for (const e of this.list) {
      if (e.alive && Math.hypot(pos.x - e.pos.x, pos.z - e.pos.z) < e.radius + r) return e;
    }
    return null;
  }

  nearestTarget(point, maxDist) {
    let best = null, bd = maxDist;
    for (const e of this.list) {
      if (!e.alive || !e.isTarget) continue;
      const d = Math.hypot(point.x - e.pos.x, point.z - e.pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  pushOutSolids(pos, r) {
    for (const e of this.list) {
      if (!e.alive || !e.solid) continue;
      const dx = pos.x - e.pos.x, dz = pos.z - e.pos.z;
      const d = Math.hypot(dx, dz), min = r + e.radius;
      if (d < min && d > 1e-4) {
        pos.x = e.pos.x + (dx / d) * min;
        pos.z = e.pos.z + (dz / d) * min;
      }
    }
  }

  separate(e) {
    for (const o of this.list) {
      if (o === e || !o.alive) continue;
      const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz), min = e.radius + o.radius;
      if (d < min && d > 1e-4) {
        const push = o.solid ? min - d : (min - d) * 0.5;
        e.pos.x += (dx / d) * push;
        e.pos.z += (dz / d) * push;
      }
    }
  }

  damageArea(pos, radius, dmg, sourceSlot) {
    for (const e of [...this.list]) {
      if (!e.alive) continue;
      const d = Math.hypot(pos.x - e.pos.x, pos.z - e.pos.z);
      const reach = radius + e.radius;
      if (d < reach) e.damage(dmg * (1 - 0.5 * (d / reach)), sourceSlot);
    }
  }
}
