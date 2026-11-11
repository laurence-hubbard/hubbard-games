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
  const { mode } = game;
  if (mode.name === 'solo') {
    game.after(1.8, () => game.endMatch('lost'));
    return;
  }
  if (mode.name === 'coop' && game.players.every((p) => p.dead)) {
    game.matchDecided = true; // squad wiped: no more respawns
    game.after(1.8, () => game.endMatch('lost'));
    return;
  }
  if (mode.name === 'versus' && killerSlot && killerSlot !== player.slot) {
    const killer = game.players[killerSlot - 1];
    killer.kills++;
    if (killer.kills >= mode.killTarget) {
      game.matchDecided = true;
      game.after(1.5, () => game.endMatch('won', killerSlot));
      return;
    }
  }
  player.respawnT = mode.respawnDelay;
}

/** Where a downed player comes back: beside their partner (co-op) or far from the rival (versus). */
function respawnPoint(game, player) {
  const others = game.players.filter((p) => p !== player && !p.dead);
  if (game.mode.respawnNearPartner && others.length) {
    const partner = others[0];
    for (const [ox, oz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, -3]]) {
      const p = partner.pos.clone().add(new THREE.Vector3(ox, 0, oz));
      if (!game.level.blockedAt(p.x, p.z, 1)) return p;
    }
    return partner.pos.clone();
  }
  if (!others.length) return game.spawnPoints[0].clone();
  return game.spawnPoints
    .reduce((best, s) => (Math.min(...others.map((o) => s.distanceTo(o.pos))) >
      Math.min(...others.map((o) => best.distanceTo(o.pos))) ? s : best))
    .clone();
}

function respawn(game, player) {
  const p = respawnPoint(game, player);
  player.pos.set(p.x, 0, p.z);
  game.level.resolveCircle(player.pos, player.radius);
  player.vel.set(0, 0, 0);
  player.hp = player.maxHp;
  player.missiles = Math.max(player.missiles, 12);
  player.dead = false;
  player.root.visible = true;
  game.effects.sparks(player.pos.clone().setY(2), 0x5ff3ff, 20);
}

/** Per-frame rule checks (respawns, pickup drops). */
export function updateMode(game, dt) {
  const { mode } = game;
  if (mode.respawnDelay && !game.matchDecided) {
    for (const p of game.players) {
      if (!p.dead || p.respawnT <= 0) continue;
      p.respawnT -= dt;
      if (p.respawnT <= 0) respawn(game, p);
    }
  }
  if (mode.pickupRespawnEvery) {
    game.pickupT = (game.pickupT ?? mode.pickupRespawnEvery) - dt;
    if (game.pickupT <= 0) {
      game.pickupT = mode.pickupRespawnEvery;
      if (game.pickups.list.length < 6) {
        game.pickups.spawn(Math.random() < 0.5 ? 'health' : 'ammo', game.level.randomRoadPoint(null));
      }
    }
  }
}
