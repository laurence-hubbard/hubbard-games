import * as THREE from 'three';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Level } from './level.js';
import { LEVELS } from './levels.js';
import { Effects } from './effects.js';
import { Projectiles } from './projectiles.js';
import { Enemies } from './enemies.js';
import { Player } from './player.js';
import { Pickups } from './pickups.js';
import { HUD } from './hud.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f1a);
scene.fog = new THREE.Fog(0x0b0f1a, 60, 140);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 400);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0x8090ff, 0x201828, 1.3));
const moon = new THREE.DirectionalLight(0xb8c8ff, 1.6);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 200 });
moon.shadow.bias = -0.0005;
scene.add(moon, moon.target);

const levelIndex = Math.min(Number(new URLSearchParams(location.search).get('level') || 0), LEVELS.length - 1);
const def = LEVELS[levelIndex];

const game = {
  scene, camera, renderer, def,
  time: 0,
  state: 'title',
  score: 0,
  shakeAmt: 0,
  aimPoint: new THREE.Vector3(),
  jammersLeft: def.jammers.length,
  boss: null,
  timers: [],

  shake(a) { this.shakeAmt = Math.min(1.2, Math.max(this.shakeAmt, a)); },
  addScore(n) { this.score += n; },
  after(t, fn) { this.timers.push({ t, fn }); },

  damageArea(pos, radius, dmg, owner) {
    if (owner === 'player') this.enemies.damageArea(pos, radius, dmg);
    else {
      const p = this.player;
      if (!p.dead && Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z) < radius + p.radius) p.damage(dmg);
    }
  },

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
      this.effects.explosion(c.clone().setY(2), 3);
    });
  },

  onBossDestroyed(boss) {
    const c = boss.pos.clone();
    for (let i = 1; i <= 5; i++) {
      this.after(i * 0.3, () => this.effects.explosion(
        c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 2 + Math.random() * 3, (Math.random() - 0.5) * 8)), 3));
    }
    this.after(2.8, () => {
      this.state = 'won';
      this.hud.showScreen('DISTRICT SECURED', `${this.def.name}<br/>Final score: <b>${this.score}</b>`, 'PRESS R OR CLICK TO PLAY AGAIN');
    });
  },

  onPlayerDead() {
    this.after(1.8, () => {
      this.state = 'dead';
      this.hud.showScreen('UNIT DESTROYED', `Score: <b>${this.score}</b>`, 'PRESS R OR CLICK TO REDEPLOY');
    });
  },
};

game.input = new Input();
game.audio = new Sfx();
game.level = new Level(scene, def);
game.effects = new Effects(game);
game.projectiles = new Projectiles(game);
game.enemies = new Enemies(game);
game.pickups = new Pickups(game);
const startPos = game.level.blockCenter(...def.start);
game.player = new Player(game, startPos.x, startPos.z + 4);
game.hud = new HUD(game);
populate();

function populate() {
  const L = game.level, E = game.enemies, start = game.player.pos;
  for (const [i, j] of def.jammers) {
    const c = L.blockCenter(i, j);
    E.spawn('jammer', c);
    E.spawn('turret', c.clone().add(new THREE.Vector3(-7, 0, -7)));
    E.spawn('turret', c.clone().add(new THREE.Vector3(7, 0, 7)));
  }
  const crossings = L.intersections().filter((p) => p.distanceTo(start) > 40);
  for (let i = crossings.length - 1; i > 0; i--) {
    const k = Math.floor(L.rnd() * (i + 1));
    [crossings[i], crossings[k]] = [crossings[k], crossings[i]];
  }
  for (const c of crossings.slice(0, def.turrets)) {
    E.spawn('turret', c.clone().add(new THREE.Vector3(L.rnd() < 0.5 ? -4 : 4, 0, L.rnd() < 0.5 ? -4 : 4)));
  }
  for (let i = 0; i < def.drones; i++) E.spawn('drone', L.randomRoadPoint(start, 40));
  for (let i = 0; i < def.rammers; i++) E.spawn('rammer', L.randomRoadPoint(start, 45));
  for (let i = 0; i < def.crates; i++) E.spawn('crate', L.randomRoadPoint(start, 8));
}

function startGame() {
  game.state = 'playing';
  game.hud.hideScreen();
  game.hud.setPlaying(true);
  game.hud.banner(def.name, 3);
  game.input.mouse.left = false;
}

// Title screen -> start.
document.getElementById('screen').addEventListener('click', () => {
  if (game.state === 'title') {
    game.audio.init();
    startGame();
  } else if (game.state === 'paused') {
    togglePause();
  } else if (game.state === 'dead' || game.state === 'won') {
    location.reload();
  }
});

function togglePause() {
  if (game.state === 'playing') {
    game.state = 'paused';
    game.hud.showScreen('PAUSED', game.def.name, 'CLICK OR PRESS P TO RESUME', true);
  } else if (game.state === 'paused') {
    game.state = 'playing';
    game.hud.hideScreen();
    game.input.mouse.left = game.input.mouse.right = false;
  }
}

// Camera.
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -3);
const camTarget = game.player.pos.clone();
const camOffset = new THREE.Vector3(0, 36, 25);
let camZoom = 1;

function updateAim() {
  raycaster.setFromCamera(game.input.ndc, camera);
  raycaster.ray.intersectPlane(aimPlane, game.aimPoint);
}

function updateCamera(dt) {
  const p = game.player.pos;
  const lead = new THREE.Vector3(game.aimPoint.x - p.x, 0, game.aimPoint.z - p.z);
  if (lead.length() > 12) lead.setLength(12);
  const desired = p.clone().addScaledVector(lead, 0.3);
  desired.y = 0;
  camTarget.lerp(desired, 1 - Math.exp(-6 * dt));
  camZoom += ((game.player.mode === 'hover' ? 1.18 : 1) - camZoom) * (1 - Math.exp(-3 * dt));
  camera.position.copy(camTarget).addScaledVector(camOffset, camZoom);
  camera.lookAt(camTarget);
  if (game.shakeAmt > 0) {
    camera.position.x += (Math.random() - 0.5) * game.shakeAmt;
    camera.position.y += (Math.random() - 0.5) * game.shakeAmt;
    camera.position.z += (Math.random() - 0.5) * game.shakeAmt;
    game.shakeAmt = Math.max(0, game.shakeAmt - dt * 2.5);
  }
  game.level.updateOcclusion(camera.position, game.player.pos, dt);
  moon.position.set(camTarget.x + 30, 60, camTarget.z + 20);
  moon.target.position.copy(camTarget);
}

// Main loop.
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
  renderer.render(scene, camera);
}

/** Advance the whole game by dt seconds (also used by automated tests). */
function step(dt) {
  const inp = game.input;

  if (inp.pressed('KeyP') || inp.pressed('Escape')) togglePause();
  if ((game.state === 'dead' || game.state === 'won') && inp.pressed('KeyR')) location.reload();

  const simulate = game.state === 'playing' || game.state === 'dead' || game.state === 'won';
  if (simulate) {
    game.time += dt;
    updateAim();
    if (game.state === 'playing') game.player.update(dt);
    game.enemies.update(dt);
    game.projectiles.update(dt);
    game.pickups.update(dt);
    game.effects.update(dt);
    for (let i = game.timers.length - 1; i >= 0; i--) {
      const t = game.timers[i];
      t.t -= dt;
      if (t.t <= 0) { game.timers.splice(i, 1); t.fn(); }
    }
  }
  updateCamera(dt);
  if (game.state !== 'title') game.hud.update(dt);
  inp.endFrame();
}
game.step = step;
updateAim();
requestAnimationFrame(frame);
// Dev: ?autostart skips the title screen (no audio until a click).
if (new URLSearchParams(location.search).has('autostart')) startGame();

window.game = game; // handy for debugging in the console
