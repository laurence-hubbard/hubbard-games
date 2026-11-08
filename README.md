# Hubbard Games

Browser games, built from scratch.

## Iron Precinct

Neo Harbor, 2097. Rogue signal jammers have cut the district off. Pilot a
transforming police mech — a heavily armoured **walker** or a fast **hover**
pursuit mode — destroy the jammers, then take down the Siegebreaker.

### Play

No build step or install needed — just serve the folder:

```sh
cd iron-precinct
python3 -m http.server 8137
```

Then open <http://localhost:8137>.

### Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Aim |
| Left click | Pulse cannons |
| Right click | Homing missiles |
| Space / Q | Transform walker ⇄ hover |
| P / Esc | Pause |
| R | Restart after win / loss |

### Tech

- [Three.js](https://threejs.org/) r160 (vendored in `iron-precinct/vendor/`, MIT licence)
- Plain ES modules — no bundler
- Sound effects are synthesized with the Web Audio API; all models are built from code

### Code map

| File | What it does |
| --- | --- |
| `src/main.js` | Renderer, camera, game state and main loop |
| `src/levels.js` | Level definitions — add new districts here |
| `src/level.js` | City generation, collision, line of sight |
| `src/player.js` | The mech: movement, transform, weapons |
| `src/enemies.js` | Drones, turrets, rammers, jammers, boss, crates |
| `src/projectiles.js` | Bullets, bolts, homing missiles, mortars |
| `src/effects.js` | Explosions, sparks, trails |
| `src/pickups.js` | Health and missile pickups |
| `src/hud.js` | HUD, minimap, overlays |
| `src/audio.js` | Synthesized sound effects |

Dev helpers: `?autostart` skips the title screen, `?level=N` picks a level, and
`window.game` / `game.step(dt)` are exposed for debugging and automated tests.
