import * as THREE from 'three';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { LEVELS } from './levels.js';
import { createGame } from './game.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const input = new Input();
const audio = new Sfx();
const levelIndex = Math.min(Number(params.get('level') || 0), LEVELS.length - 1);
const def = LEVELS[levelIndex];

// Dev: ?mode=coop|versus runs a two-player game on one page (player 2 idle / test-driven).
const devMode = ['coop', 'versus'].includes(params.get('mode')) ? params.get('mode') : 'solo';
let game = createGame({ renderer, def, input, audio, mode: devMode, role: devMode === 'solo' ? 'solo' : 'host' });
window.game = game; // handy for debugging in the console

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  game.setAspect(innerWidth / innerHeight);
});

function startGame() {
  game.state = 'playing';
  game.hud.hideScreen();
  game.hud.setPlaying(true);
  game.hud.banner(def.name, 3);
  input.mouse.left = false;
}

function togglePause() {
  if (game.state === 'playing') {
    game.state = 'paused';
    game.hud.showScreen('PAUSED', def.name, 'CLICK OR PRESS P TO RESUME', true);
  } else if (game.state === 'paused') {
    game.state = 'playing';
    game.hud.hideScreen();
    input.mouse.left = input.mouse.right = false;
  }
}

const isOver = () => game.state === 'won' || game.state === 'lost';

document.getElementById('screen').addEventListener('click', () => {
  if (game.state === 'title') {
    audio.init();
    startGame();
  } else if (game.state === 'paused') {
    togglePause();
  } else if (isOver()) {
    location.reload();
  }
});

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (input.pressed('KeyP') || input.pressed('Escape')) togglePause();
  if (isOver() && input.pressed('KeyR')) location.reload();
  game.step(dt);
  game.render();
}
requestAnimationFrame(frame);

// Dev: ?autostart skips the title screen (no audio until a click).
if (params.has('autostart')) startGame();
