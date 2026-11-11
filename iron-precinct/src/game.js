import * as THREE from 'three';
import { Level } from './level.js';
import { Effects } from './effects.js';
import { Projectiles } from './projectiles.js';
import { Enemies } from './enemies.js';
import { Player } from './player.js';
import { Pickups } from './pickups.js';
import { HUD } from './hud.js';
import { MODES, populate, onPlayerDown, updateMode } from './modes.js';
import { recordEvents, buildSnapshot, applySnapshot } from './sync.js';

const IDLE_INPUT = Object.freeze({ mx: 0, mz: 0, ax: 0, az: -1, fire: false, missile: false, tseq: 0 });
const CAM_OFFSET = new THREE.Vector3(0, 36, 25);
const PLAYER_ACCENTS = [0x1f5fd1, 0xd1661f]; // P1 blue, P2 orange

/** Starting positions: side by side in the start plaza, or opposite corners in versus. */
function spawnPositions(game, count) {
  const start = game.level.blockCenter(...game.def.start);
  if (game.mode.name !== 'versus') {
    return Array.from({ length: count }, (_, i) => new THREE.Vector3(start.x + i * 5, 0, start.z + 4));
  }
  const h = game.level.half;
  const pts = game.spawnPoints;
  const corner = new THREE.Vector3(-h, 0, h);
  const first = pts.reduce((a, b) => (a.distanceTo(corner) < b.distanceTo(corner) ? a : b));
  const second = pts.reduce((a, b) => (a.distanceTo(first) > b.distanceTo(first) ? a : b));
  return [first.clone(), second.clone()].slice(0, count);
}

/** InputState for the local player, read from the keyboard/mouse and the aim raycast. */
export function readLocalInput(game) {
  const inp = game.input;
  let mx = 0, mz = 0;
  if (inp.down('KeyW') || inp.down('ArrowUp')) mz -= 1;
  if (inp.down('KeyS') || inp.down('ArrowDown')) mz += 1;
  if (inp.down('KeyA') || inp.down('ArrowLeft')) mx -= 1;
  if (inp.down('KeyD') || inp.down('ArrowRight')) mx += 1;
  if (inp.pressed('Space') || inp.pressed('KeyQ')) game.localTseq++;
  return {
    mx, mz, ax: game.aimPoint.x, az: game.aimPoint.z,
    fire: inp.mouse.left, missile: inp.mouse.right, tseq: game.localTseq,
  };
}

/**
 * Build a complete game world.
 * opts: { renderer, def, input, audio, mode='solo', role='solo'|'host'|'guest', localSlot=1 }
 */
export function createGame(opts) {
  const { renderer, def, input, audio, net } = opts;
  const mode = MODES[opts.mode || 'solo'];
  const role = opts.role || 'solo';
  const localSlot = opts.localSlot || 1;
  const playerCount = mode.name === 'solo' ? 1 : 2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f1a);
  scene.fog = new THREE.Fog(0x0b0f1a, 60, 140);
  const size = renderer ? renderer.getSize(new THREE.Vector2()) : new THREE.Vector2(1280, 800);
  const camera = new THREE.PerspectiveCamera(45, size.x / size.y, 0.5, 400);
  scene.add(new THREE.HemisphereLight(0x8090ff, 0x201828, 1.3));
  const moon = new THREE.DirectionalLight(0xb8c8ff, 1.6);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 200 });
  moon.shadow.bias = -0.0005;
  scene.add(moon, moon.target);

  let idCounter = 0;
  const raycaster = new THREE.Raycaster();
  const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -3);
  const camTarget = new THREE.Vector3();
  let camZoom = 1;

  const game = {
    scene, camera, renderer, def, input, audio, mode, role, localSlot,
    time: 0,
    state: 'title',
    winnerSlot: null,
    score: 0,
    shakeAmt: 0,
    aimPoint: new THREE.Vector3(),
    jammersLeft: 0,
    boss: null,
    timers: [],
    players: [],
    player: null,
    remoteInputs: {},
    net: net || null,
    snapT: 0,
    localTseq: 0,

    nextId() { return ++idCounter; },
    shake(a) { this.shakeAmt = Math.min(1.2, Math.max(this.shakeAmt, a)); },
    addScore(n) { this.score += n; },
    after(t, fn) { this.timers.push({ t, fn }); },

    nearestPlayer(pos) {
      let best = null, bd = Infinity;
      for (const p of this.players) {
        if (p.dead) continue;
        const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    },

    damageArea(pos, radius, dmg, owner, ownerSlot) {
      if (owner === 'player') {
        this.enemies.damageArea(pos, radius, dmg, ownerSlot);
        if (!this.mode.friendlyFire) return;
      }
      for (const p of this.players) {
        if (p.dead || (owner === 'player' && p.slot === ownerSlot)) continue;
        if (Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z) < radius + p.radius) p.damage(dmg, ownerSlot);
      }
    },

    /** Show a pickup message to whoever picked it up (if that's us). */
    toastFor(player, text) {
      if (player === this.player) this.hud.toast(text);
    },

    buildSnapshot() { return buildSnapshot(this); },
    applySnapshot(snap) { applySnapshot(this, snap); },

    onPlayerHurt(player) {
      if (player !== this.player) return;
      this.shake(0.25);
      this.hud.hurt();
      this.audio.play('hurt');
    },

    onPlayerDown(player, killerSlot) { onPlayerDown(this, player, killerSlot); },

    objectiveText() {
      if (this.jammersLeft > 0) {
        const total = this.def.jammers.length;
        return `DESTROY SIGNAL JAMMERS  ${total - this.jammersLeft}/${total}`;
      }
      if (this.boss && this.boss.alive) return 'DESTROY THE SIEGEBREAKER';
      if (this.state === 'won') return 'DISTRICT SECURED';
      return 'HOSTILE INBOUND — STAND BY';
    },

    onJammerDestroyed() {
      this.jammersLeft--;
      this.audio.play('jammerDown');
      if (this.jammersLeft > 0) {
        this.hud.banner(`JAMMER DOWN — ${this.jammersLeft} REMAINING`);
        return;
      }
      this.hud.banner('ALL JAMMERS DOWN', 2);
      this.after(2.2, () => {
        this.hud.banner('WARNING: SIEGEBREAKER INBOUND', 3);
        this.audio.play('alarm');
        const c = this.level.blockCenter(...this.def.boss);
        this.boss = this.enemies.spawn('boss', c);
        this.boss.hp = this.boss.maxHp = this.boss.maxHp * this.mode.bossHpScale;
        this.effects.explosion(c.clone().setY(2), 3);
      });
    },

    onBossDestroyed(boss) {
      const c = boss.pos.clone();
      for (let i = 1; i <= 5; i++) {
        this.after(i * 0.3, () => this.effects.explosion(
          c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 2 + Math.random() * 3, (Math.random() - 0.5) * 8)), 3));
      }
      this.after(2.8, () => this.endMatch('won'));
    },

    /** Finish the match: 'won' or 'lost', optionally naming the winning slot (versus). */
    endMatch(state, winnerSlot = null) {
      if (this.state !== 'playing') return;
      this.state = state;
      this.winnerSlot = winnerSlot;
      if (state === 'won') {
        this.hud.showScreen('DISTRICT SECURED', `${this.def.name}<br/>Final score: <b>${this.score}</b>`, 'PRESS R OR CLICK TO PLAY AGAIN');
      } else {
        this.hud.showScreen('UNIT DESTROYED', `Score: <b>${this.score}</b>`, 'PRESS R OR CLICK TO REDEPLOY');
      }
    },

    updateAim() {
      raycaster.setFromCamera(this.input.ndc, camera);
      raycaster.ray.intersectPlane(aimPlane, this.aimPoint);
    },

    updateCamera(dt) {
      const p = this.player.pos;
      const lead = new THREE.Vector3(this.aimPoint.x - p.x, 0, this.aimPoint.z - p.z);
      if (lead.length() > 12) lead.setLength(12);
      const desired = p.clone().addScaledVector(lead, 0.3);
      desired.y = 0;
      camTarget.lerp(desired, 1 - Math.exp(-6 * dt));
      camZoom += ((this.player.mode === 'hover' ? 1.18 : 1) - camZoom) * (1 - Math.exp(-3 * dt));
      camera.position.copy(camTarget).addScaledVector(CAM_OFFSET, camZoom);
      camera.lookAt(camTarget);
      if (this.shakeAmt > 0) {
        camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
        camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
        camera.position.z += (Math.random() - 0.5) * this.shakeAmt;
        this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
      }
      this.level.updateOcclusion(camera.position, p, dt);
      moon.position.set(camTarget.x + 30, 60, camTarget.z + 20);
      moon.target.position.copy(camTarget);
    },

    /** Advance the whole game by dt seconds (also used by automated tests). */
    step(dt) {
      const simulate = this.state === 'playing' || this.state === 'won' || this.state === 'lost';
      if (simulate && this.role === 'guest') {
        // The host simulates; we only send input and animate what it reports.
        this.time += dt;
        this.updateAim();
        if (this.state === 'playing') {
          this.lastInput = readLocalInput(this);
          this.net?.send({ t: 'input', ...this.lastInput });
        }
        for (const p of this.players) p.netAnimate(dt);
        this.enemies.netAnimate(dt);
        this.projectiles.netAnimate(dt);
        this.pickups.netAnimate(dt);
        this.effects.update(dt);
      } else if (simulate) {
        this.time += dt;
        this.updateAim();
        if (this.state === 'playing') {
          const local = readLocalInput(this);
          for (const p of this.players) {
            p.update(dt, p.slot === this.localSlot ? local : this.remoteInputs[p.slot] || IDLE_INPUT);
          }
          updateMode(this, dt);
        }
        this.enemies.update(dt);
        this.projectiles.update(dt);
        this.pickups.update(dt);
        this.effects.update(dt);
        for (let i = this.timers.length - 1; i >= 0; i--) {
          const t = this.timers[i];
          t.t -= dt;
          if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
        }
        if (this.net && this.role === 'host') {
          this.snapT -= dt;
          if (this.snapT <= 0) {
            this.snapT += 1 / 30;
            this.net.send(buildSnapshot(this));
          }
        }
      }
      this.updateCamera(dt);
      if (this.state !== 'title') this.hud.update(dt);
      this.input.endFrame();
    },

    render() { if (this.renderer) this.renderer.render(scene, camera); },

    setAspect(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },

    dispose() {
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) m.dispose?.();
      });
      scene.clear();
    },
  };

  game.level = new Level(scene, def);
  game.effects = new Effects(game);
  game.projectiles = new Projectiles(game);
  game.enemies = new Enemies(game);
  game.pickups = new Pickups(game);
  game.spawnPoints = game.level.intersections();
  for (const [slot, pos] of spawnPositions(game, playerCount).entries()) {
    game.players.push(new Player(game, pos.x, pos.z, { slot: slot + 1, accent: PLAYER_ACCENTS[slot] }));
  }
  game.player = game.players[localSlot - 1];
  game.hud = new HUD(game);
  if (role !== 'guest') populate(game);
  if (role === 'host') recordEvents(game);
  camTarget.copy(game.player.pos);
  game.updateAim();
  return game;
}
