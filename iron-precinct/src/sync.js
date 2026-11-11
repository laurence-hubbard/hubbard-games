// Host -> guest state sync. The host runs the real simulation; the guest renders
// what the host sends: a snapshot of every moving thing plus one-shot events.
import * as THREE from 'three';

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Host only: make explosions, sparks, sounds, banners, toasts and hurt flashes also
 * push an event into game.events so the guest can replay them. Calls nested inside
 * a recorded call (e.g. the sound an explosion plays) are not recorded twice.
 */
export function recordEvents(game) {
  const events = (game.events = []);
  let depth = 0;
  const wrap = (obj, name, toEvent) => {
    const orig = obj[name].bind(obj);
    obj[name] = (...args) => {
      if (depth === 0) {
        const e = toEvent(...args);
        if (e) events.push(e);
      }
      depth++;
      try { return orig(...args); } finally { depth--; }
    };
  };
  game.audio = Object.create(game.audio); // per-game wrapper; the shared Sfx stays untouched
  wrap(game.effects, 'explosion', (pos, size = 1) => ({ e: 'boom', x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), size }));
  wrap(game.effects, 'sparks', (pos, c, n = 6) => ({ e: 'sparks', x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), c, n }));
  wrap(game.audio, 'play', (name) => ({ e: 'sfx', name }));
  wrap(game.hud, 'banner', (text, dur = 2.5) => ({ e: 'banner', text, dur }));
  wrap(game, 'toastFor', (player, text) => ({ e: 'toast', slot: player.slot, text }));
  wrap(game, 'onPlayerHurt', (player) => ({ e: 'hurt', slot: player.slot }));
}

/** Host: everything the guest needs to draw this moment. Drains game.events. */
export function buildSnapshot(game) {
  return {
    t: 'snap',
    time: r2(game.time),
    state: game.state,
    winnerSlot: game.winnerSlot,
    score: game.score,
    jammersLeft: game.jammersLeft,
    players: game.players.map((p) => p.netState()),
    enemies: game.enemies.list.filter((e) => e.alive).map((e) => e.netState()),
    proj: game.projectiles.netState(),
    pickups: game.pickups.netState(),
    events: game.events ? game.events.splice(0) : [],
  };
}

/** Guest: bring the local world in line with a host snapshot and replay its events. */
export function applySnapshot(game, snap) {
  game.lastSnapAt = performance.now();
  game.score = snap.score;
  game.jammersLeft = snap.jammersLeft;
  for (const s of snap.players) game.players[s.s - 1]?.applyNet(s);
  game.enemies.applyNet(snap.enemies);
  game.projectiles.applyNet(snap.proj);
  game.pickups.applyNet(snap.pickups);

  for (const ev of snap.events) {
    const at = () => new THREE.Vector3(ev.x, ev.y, ev.z);
    switch (ev.e) {
      case 'boom': game.effects.explosion(at(), ev.size); break;
      case 'sparks': game.effects.sparks(at(), ev.c, ev.n); break;
      case 'sfx': game.audio.play(ev.name); break;
      case 'banner': game.hud.banner(ev.text, ev.dur); break;
      case 'toast': if (ev.slot === game.localSlot) game.hud.toast(ev.text); break;
      case 'hurt': if (ev.slot === game.localSlot) game.onPlayerHurt(game.player); break;
    }
  }

  if (snap.state !== game.state) {
    if ((snap.state === 'won' || snap.state === 'lost') && game.state === 'playing') game.endMatch(snap.state, snap.winnerSlot);
    else if (snap.state === 'playing') game.state = 'playing';
  }
}
