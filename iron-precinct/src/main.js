import * as THREE from 'three';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { LEVELS } from './levels.js';
import { createGame } from './game.js';
import { Net } from './net.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const canvas = $('game');
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

const MODE_DESC = {
  coop: 'Same mission, together: take down the jammers and the Siegebreaker.',
  versus: 'One-on-one in the city. First to 10 kills wins.',
};

/** App-level flow: 'title' -> ('solo' | 'lobby' -> 'match' -> 'lobby' ...). */
const app = {
  state: 'title',
  net: null,
  lobby: { players: [false, false], mode: 'coop', phase: 'lobby' },
};
window.app = app;

let game;
function setGame(g) {
  game?.dispose();
  game = g;
  window.game = g; // handy for debugging in the console
}

// Dev: ?mode=coop|versus runs a two-player game on one page (player 2 idle / test-driven),
// &role=guest makes this page player 2 with no host attached.
const devMode = ['coop', 'versus'].includes(params.get('mode')) ? params.get('mode') : 'solo';
const devRole = devMode === 'solo' ? 'solo' : params.get('role') === 'guest' ? 'guest' : 'host';
setGame(createGame({ renderer, def, input, audio, mode: devMode, role: devRole, localSlot: devRole === 'guest' ? 2 : 1 }));

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  game.setAspect(innerWidth / innerHeight);
});

// ---------------------------------------------------------------- screens

function showTitle(msg = '') {
  app.state = 'title';
  game.hud.setPlaying(false);
  game.hud.showScreen('IRON PRECINCT',
    'Neo Harbor, 2097. Rogue signal jammers have cut the district off.<br/>Deploy the Warden mech. Take them down.', '', true);
  $('screen-cta').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('title-msg').textContent = msg;
}

function renderLobby() {
  const { players, mode } = app.lobby;
  const me = app.net?.slot;
  for (const slot of [1, 2]) {
    const el = $(`lobby-p${slot}`);
    const on = players[slot - 1];
    el.textContent = `PLAYER ${slot} — ${on ? 'connected' : 'waiting…'}${slot === me ? ' (you)' : ''}`;
    el.className = 'slot ' + (on ? 'on' : 'off');
  }
  const isHost = me === 1;
  for (const m of ['coop', 'versus']) {
    const b = $(`btn-${m}`);
    b.classList.toggle('selected', mode === m);
    b.disabled = !isHost;
  }
  $('lobby-mode-desc').textContent = MODE_DESC[mode];
  const start = $('btn-start');
  start.classList.toggle('hidden', !isHost);
  start.disabled = !(isHost && players[0] && players[1]);
  $('lobby-hint').textContent = isHost
    ? (players[1] ? 'Pick a mode and press START.' : 'Waiting for player 2 — open this page on the other laptop and choose TWO-PLAYER.')
    : 'Waiting for player 1 to start…';
}

function showLobby(msg) {
  app.state = 'lobby';
  if (game.state !== 'title') game.state = 'lobby'; // freeze the finished match behind the lobby
  game.hud.setPlaying(false);
  game.hud.showScreen('TWO-PLAYER', 'Both laptops open this page and choose TWO-PLAYER.', '');
  $('screen-cta').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  if (msg !== undefined) $('lobby-msg').textContent = msg;
  renderLobby();
}

function startGame() {
  game.state = 'playing';
  game.hud.hideScreen();
  game.hud.setPlaying(true);
  game.hud.banner(def.name, 3);
  input.mouse.left = input.mouse.right = false;
}

function startMatch(mode) {
  const slot = app.net.slot;
  setGame(createGame({ renderer, def, input, audio, mode, role: slot === 1 ? 'host' : 'guest', localSlot: slot, net: app.net }));
  app.state = 'match';
  $('lobby-msg').textContent = '';
  startGame();
}

// ---------------------------------------------------------------- two-player

async function joinTwoPlayer() {
  if (app.net) return;
  const net = new Net();
  app.net = net;
  net.on('welcome', () => showLobby(''));
  net.on('full', () => { app.net = null; showTitle('Game full — two players already connected.'); });
  net.on('lobby', (m) => {
    app.lobby = m;
    if (app.state === 'match' && m.phase === 'lobby') showLobby();
    else if (app.state === 'lobby') renderLobby();
  });
  net.on('left', () => {
    if (app.state === 'match' || app.state === 'lobby') showLobby('Partner disconnected.');
  });
  net.on('start', (m) => startMatch(m.mode));
  net.on('snap', (m) => {
    if (app.state === 'match' && game.role === 'guest') game.applySnapshot(m);
  });
  net.on('input', (m) => {
    if (app.state === 'match' && game.role === 'host') game.setRemoteInput(2, m);
  });
  net.on('close', () => {
    if (app.net !== net) return;
    app.net = null;
    if (app.state === 'lobby' || app.state === 'match') {
      setGame(createGame({ renderer, def, input, audio }));
      showTitle('Lost connection to the game server.');
    }
  });
  try {
    await net.connect();
  } catch (err) {
    app.net = null;
    showTitle(err.message + ' — is server.py running?');
  }
}

$('btn-solo').addEventListener('click', (e) => {
  e.stopPropagation();
  audio.init();
  app.state = 'solo';
  startGame();
});
$('btn-2p').addEventListener('click', (e) => {
  e.stopPropagation();
  audio.init();
  joinTwoPlayer();
});
for (const m of ['coop', 'versus']) {
  $(`btn-${m}`).addEventListener('click', (e) => {
    e.stopPropagation();
    app.net?.send({ t: 'mode', mode: m });
  });
}
$('btn-start').addEventListener('click', (e) => {
  e.stopPropagation();
  app.net?.send({ t: 'start' });
});

// ---------------------------------------------------------------- pause / restart

const isOver = () => game.state === 'won' || game.state === 'lost';

function togglePause() {
  if (game.role !== 'solo') return; // a shared game can't be paused by one player
  if (game.state === 'playing') {
    game.state = 'paused';
    game.hud.showScreen('PAUSED', def.name, 'CLICK OR PRESS P TO RESUME', true);
  } else if (game.state === 'paused') {
    game.state = 'playing';
    game.hud.hideScreen();
    input.mouse.left = input.mouse.right = false;
  }
}

function afterMatch() {
  if (app.state === 'match') app.net?.send({ t: 'end' }); // both players return to the lobby
  else location.reload();
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyR' && isOver()) afterMatch();
});

$('screen').addEventListener('click', () => {
  if (game.state === 'paused') togglePause();
  else if (isOver()) afterMatch();
});

// ---------------------------------------------------------------- loop

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.step(dt);
  game.render();
}
requestAnimationFrame(frame);

// Dev: ?autostart skips the title screen (no audio until a click).
if (params.has('autostart')) { app.state = devMode === 'solo' ? 'solo' : 'match'; startGame(); }
else showTitle();
