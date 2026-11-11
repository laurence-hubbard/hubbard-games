import * as THREE from 'three';
import { box, cyl, angleLerp, clamp } from './util.js';

const MODES = {
  walker: { speed: 9, accel: 12, fireRate: 0.11, dmg: 11, armor: 0.6, bulletSpeed: 62, label: 'WALKER — ARMORED' },
  hover: { speed: 21, accel: 3.5, fireRate: 0.17, dmg: 6, armor: 1.0, bulletSpeed: 72, label: 'HOVER — PURSUIT' },
};
const TRANSFORM_TIME = 0.4;
export const MAX_MISSILES = 20;

export class Player {
  constructor(game, x, z, { slot = 1, accent = 0x1f5fd1 } = {}) {
    this.game = game;
    this.slot = slot;
    this.accent = accent;
    this.kills = 0;
    this.respawnT = 0;
    this.lastTseq = 0;
    this.aim = new THREE.Vector3(x, 0, z - 10);
    this.pos = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.radius = 1.6;
    this.hp = this.maxHp = 100;
    this.mode = 'walker';
    this.nextMode = null;
    this.transformT = 0;
    this.fireCd = 0;
    this.missileCd = 0;
    this.missiles = 12;
    this.side = 1;
    this.walkPhase = 0;
    this.aimYaw = Math.PI;
    this.moveYaw = Math.PI;
    this.dead = false;

    this.root = new THREE.Group();
    game.scene.add(this.root);
    this.lightRed = new THREE.MeshBasicMaterial({ color: 0xff1a2e });
    this.lightBlue = new THREE.MeshBasicMaterial({ color: 0x1a5cff });
    this.buildWalker();
    this.buildHover();
    this.hover.visible = false;
    this.light = new THREE.PointLight(0x66ccff, 40, 20, 2);
    this.light.position.set(0, 6, 0);
    this.root.add(this.light);
  }

  get stats() { return MODES[this.mode]; }

  buildWalker() {
    const hull = new THREE.MeshStandardMaterial({ color: 0xdfe6f0, roughness: 0.45, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.6, metalness: 0.6 });
    const accent = new THREE.MeshStandardMaterial({ color: this.accent, roughness: 0.4, metalness: 0.4 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x5ff3ff });

    const g = (this.walker = new THREE.Group());
    this.root.add(g);
    this.legs = new THREE.Group();
    g.add(this.legs);
    this.legs.add(box(2.2, 0.6, 1.4, dark, 0, 2.55, 0));
    const mkLeg = (sx) => {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.85, 2.5, 0);
      pivot.add(box(0.7, 1.3, 0.8, dark, 0, -0.6, 0));
      const knee = new THREE.Group();
      knee.position.y = -1.25;
      knee.add(box(0.6, 1.2, 0.7, accent, 0, -0.55, 0.05));
      knee.add(box(1.0, 0.3, 1.5, dark, 0, -1.1, 0.2));
      pivot.add(knee);
      this.legs.add(pivot);
      return { pivot, knee };
    };
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);

    const t = (this.torso = new THREE.Group());
    t.position.y = 2.8;
    g.add(t);
    t.add(box(2.8, 1.6, 2.0, hull, 0, 0.8, 0));
    t.add(box(2.82, 0.25, 2.02, accent, 0, 0.35, 0));
    t.add(box(2.0, 0.6, 1.0, accent, 0, 1.8, -0.4));
    t.add(box(1.7, 0.35, 0.1, glow, 0, 1.1, 1.02));
    t.add(box(0.55, 0.22, 0.35, this.lightRed, -0.4, 2.2, 0.2));
    t.add(box(0.55, 0.22, 0.35, this.lightBlue, 0.4, 2.2, 0.2));
    for (const sx of [-1, 1]) {
      t.add(box(0.8, 0.8, 1.2, dark, sx * 1.8, 0.9, 0));
      t.add(box(0.55, 0.55, 1.4, hull, sx * 1.8, 0.6, 0.7));
      const barrel = cyl(0.14, 0.14, 1.2, dark, sx * 1.8, 0.6, 1.9, 8);
      barrel.rotation.x = Math.PI / 2;
      t.add(barrel);
    }
  }

  buildHover() {
    const hull = new THREE.MeshStandardMaterial({ color: 0xdfe6f0, roughness: 0.4, metalness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.6, metalness: 0.6 });
    const accent = new THREE.MeshStandardMaterial({ color: this.accent, roughness: 0.4, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a2a3a, emissive: 0x0c6d8a, roughness: 0.2, metalness: 0.8 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x5ff3ff });

    const g = (this.hover = new THREE.Group());
    g.rotation.order = 'YXZ';
    this.root.add(g);
    g.add(box(2.4, 0.7, 4.2, hull, 0, 1.4, 0));
    g.add(box(1.8, 0.5, 1.2, accent, 0, 1.3, 2.5));
    g.add(box(1.4, 0.5, 1.6, glass, 0, 1.95, 0.3));
    for (const sx of [-1, 1]) {
      g.add(box(0.9, 0.7, 3.6, dark, sx * 1.65, 1.2, -0.2));
      g.add(box(0.7, 0.08, 3.2, glow, sx * 1.65, 0.82, -0.2));
    }
    g.add(box(0.5, 0.2, 0.35, this.lightRed, -0.35, 2.3, -0.4));
    g.add(box(0.5, 0.2, 0.35, this.lightBlue, 0.35, 2.3, -0.4));
    g.add(box(2.0, 0.45, 0.25, glow, 0, 1.4, -2.15));
    const cannon = cyl(0.18, 0.18, 1.4, dark, 0, 1.3, 3.3, 8);
    cannon.rotation.x = Math.PI / 2;
    g.add(cannon);
  }

  meshFor(mode) { return mode === 'walker' ? this.walker : this.hover; }

  /** inp: InputState { mx, mz, ax, az, fire, missile, tseq } */
  update(dt, inp) {
    if (this.dead) return;
    const g = this.game;
    this.aim.set(inp.ax, 0, inp.az);

    // Transform walker <-> hover.
    const wantsTransform = inp.tseq !== this.lastTseq;
    this.lastTseq = inp.tseq;
    if (wantsTransform && this.transformT <= 0) {
      this.nextMode = this.mode === 'walker' ? 'hover' : 'walker';
      this.transformT = TRANSFORM_TIME;
      g.audio.play('transform');
      g.effects.sparks(this.pos.clone().setY(2), 0x5ff3ff, 16);
    }
    this.animateTransform(dt);

    // Movement.
    const st = this.stats;
    let mx = inp.mx || 0, mz = inp.mz || 0;
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    const speed = st.speed * (this.transformT > 0 ? 0.4 : 1);
    const k = 1 - Math.exp(-st.accel * dt);
    this.vel.x += (mx * speed - this.vel.x) * k;
    this.vel.z += (mz * speed - this.vel.z) * k;
    this.pos.addScaledVector(this.vel, dt);
    const px = this.pos.x, pz = this.pos.z;
    g.enemies.pushOutSolids(this.pos, this.radius);
    g.level.resolveCircle(this.pos, this.radius); // buildings last: they always win
    // Lose velocity into walls so hover mode doesn't "stick".
    if (dt > 0) {
      this.vel.x += ((this.pos.x - px) / dt) * 0.5;
      this.vel.z += ((this.pos.z - pz) / dt) * 0.5;
    }

    // Aim & animation.
    const ax = this.aim.x - this.pos.x, az = this.aim.z - this.pos.z;
    this.aimYaw = angleLerp(this.aimYaw, Math.atan2(ax, az), 1 - Math.exp(-18 * dt));
    this.animate(dt);

    // Weapons.
    this.fireCd -= dt;
    this.missileCd -= dt;
    if (this.transformT <= 0) {
      if (inp.fire && this.fireCd <= 0) { this.fire(st); this.fireCd = st.fireRate; }
      if (inp.missile && this.missileCd <= 0 && this.missiles > 0) {
        this.fireMissile();
        this.missileCd = 0.3;
        this.missiles--;
      }
    }
  }

  /** Walker <-> hover squash-and-swap animation. */
  animateTransform(dt) {
    if (this.transformT <= 0) return;
    this.transformT = Math.max(0, this.transformT - dt);
    const t = 1 - this.transformT / TRANSFORM_TIME;
    if (t >= 0.5 && this.nextMode) {
      const old = this.meshFor(this.mode);
      old.visible = false;
      old.scale.y = 1;
      this.mode = this.nextMode;
      this.nextMode = null;
      this.meshFor(this.mode).visible = true;
    }
    const cur = this.meshFor(this.mode);
    cur.scale.y = this.transformT === 0 ? 1 : t < 0.5 ? 1 - t * 1.8 : 0.1 + (t - 0.5) * 1.8;
  }

  /** Visual-only animation from pos / vel / aimYaw (runs on host and guest). */
  animate(dt) {
    const g = this.game;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.5) this.moveYaw = angleLerp(this.moveYaw, Math.atan2(this.vel.x, this.vel.z), 1 - Math.exp(-10 * dt));

    if (this.mode === 'walker') {
      this.torso.rotation.y = this.aimYaw;
      this.legs.rotation.y = this.moveYaw;
      this.walkPhase += sp * dt * 0.9;
      const amp = Math.min(1, sp / MODES.walker.speed) * 0.7;
      const s = Math.sin(this.walkPhase);
      this.legL.pivot.rotation.x = s * amp;
      this.legR.pivot.rotation.x = -s * amp;
      this.legL.knee.rotation.x = Math.max(0, -s) * amp * 1.3;
      this.legR.knee.rotation.x = Math.max(0, s) * amp * 1.3;
      this.walker.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.12 * amp;
    } else {
      const yaw = this.aimYaw;
      this.hover.rotation.y = yaw;
      const fwd = this.vel.x * Math.sin(yaw) + this.vel.z * Math.cos(yaw);
      const right = this.vel.x * Math.cos(yaw) - this.vel.z * Math.sin(yaw);
      this.hover.rotation.x = clamp(fwd * 0.012, -0.25, 0.25);
      this.hover.rotation.z = clamp(right * 0.02, -0.35, 0.35);
      this.hover.position.y = Math.sin(g.time * 3) * 0.15;
    }
    const on = Math.floor(g.time * 6) % 2 === 0;
    this.lightRed.color.setHex(on ? 0xff1a2e : 0x2a0508);
    this.lightBlue.color.setHex(on ? 0x08102a : 0x1a5cff);
    this.root.position.copy(this.pos);
  }

  // --- network sync (host -> guest) ---
  netState() {
    const r2 = (v) => Math.round(v * 100) / 100;
    return {
      s: this.slot, x: r2(this.pos.x), z: r2(this.pos.z), vx: r2(this.vel.x), vz: r2(this.vel.z),
      ay: r2(this.aimYaw), m: this.nextMode || this.mode, hp: Math.ceil(this.hp), mi: this.missiles,
      d: this.dead ? 1 : 0, k: this.kills,
    };
  }

  applyNet(s) {
    if (!this.netTarget) {
      this.netTarget = new THREE.Vector3(s.x, 0, s.z);
      this.pos.set(s.x, 0, s.z);
    }
    this.netTarget.set(s.x, 0, s.z);
    this.vel.set(s.vx, 0, s.vz);
    this.netAimYaw = s.ay;
    if (s.m !== (this.nextMode || this.mode) && this.transformT <= 0) {
      this.nextMode = s.m;
      this.transformT = TRANSFORM_TIME;
    }
    this.hp = s.hp;
    this.missiles = s.mi;
    this.kills = s.k;
    const wasDead = this.dead;
    this.dead = !!s.d;
    if (wasDead && !this.dead) this.pos.copy(this.netTarget); // respawned: snap, don't glide across the map
    this.root.visible = !this.dead;
  }

  /** Guest-side per-frame update: extrapolate by velocity, ease toward the snapshot, animate. */
  netAnimate(dt) {
    if (!this.netTarget) return;
    this.netTarget.addScaledVector(this.vel, dt);
    this.pos.addScaledVector(this.vel, dt);
    const k = 1 - Math.exp(-12 * dt);
    this.pos.x += (this.netTarget.x - this.pos.x) * k;
    this.pos.z += (this.netTarget.z - this.pos.z) * k;
    this.aimYaw = angleLerp(this.aimYaw, this.netAimYaw ?? this.aimYaw, 1 - Math.exp(-20 * dt));
    this.animateTransform(dt);
    this.animate(dt);
  }

  shotDir(from, spread = 0) {
    const aim = this.aim;
    let dx = aim.x - from.x, dz = aim.z - from.z;
    if (Math.hypot(dx, dz) < 4) { dx = Math.sin(this.aimYaw); dz = Math.cos(this.aimYaw); }
    const a = Math.atan2(dx, dz) + spread + (Math.random() - 0.5) * 0.03;
    return new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
  }

  fire(st) {
    const g = this.game;
    this.root.updateMatrixWorld(true);
    const muzzles = [];
    if (this.mode === 'walker') {
      this.side *= -1;
      muzzles.push([this.torso.localToWorld(new THREE.Vector3(this.side * 1.8, 0.6, 2.5)), 0]);
    } else {
      const m = this.hover.localToWorld(new THREE.Vector3(0, 1.3, 4));
      muzzles.push([m, -0.05], [m.clone(), 0.05]);
    }
    for (const [m, spread] of muzzles) {
      g.projectiles.spawn({
        type: 'bullet', owner: 'player', ownerSlot: this.slot, pos: m, dir: this.shotDir(m, spread),
        speed: st.bulletSpeed, dmg: st.dmg, life: 0.9, radius: 0.5,
      });
      g.effects.muzzle(m);
    }
    g.audio.play('shoot');
  }

  fireMissile() {
    const g = this.game;
    const from = this.pos.clone().setY(4.6);
    const target = g.enemies.nearestTarget(this.aim, 14);
    g.projectiles.spawn({
      type: 'missile', owner: 'player', ownerSlot: this.slot, pos: from, dir: this.shotDir(from, (Math.random() - 0.5) * 0.6),
      speed: 18, dmg: 42, splash: 4.5, life: 3, radius: 0.6, target,
    });
    g.audio.play('missile');
  }

  knock(nx, nz, force) {
    this.vel.x += nx * force;
    this.vel.z += nz * force;
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }

  /** sourceSlot: the player who caused the damage (versus), if any. */
  damage(n, sourceSlot) {
    const g = this.game;
    if (this.dead || g.state !== 'playing') return;
    this.hp -= n * this.stats.armor;
    g.onPlayerHurt(this);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.root.visible = false;
      g.effects.explosion(this.pos.clone().setY(2), 4);
      g.onPlayerDown(this, sourceSlot);
    }
  }
}
