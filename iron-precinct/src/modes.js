import * as THREE from 'three';

// Rules for each way to play. Values come from the v2 design spec.
export const MODES = {
  solo: {
    name: 'solo', aiEnemies: true, countScale: 1, bossHpScale: 1, friendlyFire: false,
    respawnDelay: null, respawnNearPartner: false, killTarget: null, minimapShowsOthers: true,
    pickupRespawnEvery: null,
  },
  coop: {
    name: 'coop', aiEnemies: true, countScale: 1.5, bossHpScale: 1.5, friendlyFire: false,
    respawnDelay: 5, respawnNearPartner: true, killTarget: null, minimapShowsOthers: true,
    pickupRespawnEvery: null,
  },
  versus: {
    name: 'versus', aiEnemies: false, countScale: 0, bossHpScale: 1, friendlyFire: true,
    respawnDelay: 3, respawnNearPartner: false, killTarget: 10, minimapShowsOthers: false,
    pickupRespawnEvery: 10,
  },
};

/** Spawn the level's enemies, objectives and props for the current mode. */
export function populate(game) {
  const { level: L, enemies: E, def, mode } = game;
  const start = game.players[0].pos;
  if (mode.aiEnemies) {
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
    const n = (count) => Math.round(count * mode.countScale);
    for (const c of crossings.slice(0, n(def.turrets))) {
      E.spawn('turret', c.clone().add(new THREE.Vector3(L.rnd() < 0.5 ? -4 : 4, 0, L.rnd() < 0.5 ? -4 : 4)));
    }
    for (let i = 0; i < n(def.drones); i++) E.spawn('drone', L.randomRoadPoint(start, 40));
    for (let i = 0; i < n(def.rammers); i++) E.spawn('rammer', L.randomRoadPoint(start, 45));
  }
  for (let i = 0; i < def.crates; i++) E.spawn('crate', L.randomRoadPoint(start, 8));
  game.jammersLeft = mode.aiEnemies ? def.jammers.length : 0;
}

/** A player's mech was destroyed. killerSlot is set when another player did it. */
export function onPlayerDown(game, player, killerSlot) {
  if (game.mode.name === 'solo') {
    game.after(1.8, () => game.endMatch('lost'));
  }
}

/** Per-frame rule checks (respawns, win conditions). */
export function updateMode(game, dt) {}
