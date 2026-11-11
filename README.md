# Hubbard Games

Browser games, built from scratch.

## Iron Precinct

Neo Harbor, 2097. Rogue signal jammers have cut the district off. Pilot a
transforming police mech — a heavily armoured **walker** or a fast **hover**
pursuit mode — destroy the jammers, then take down the Siegebreaker.

### Play

No build step or install needed — Python 3 (standard library only) runs the server:

```sh
cd iron-precinct
python3 server.py
```

Then open <http://localhost:8137> and choose **SOLO** or **TWO-PLAYER**.

By default the server listens on `127.0.0.1` and, if Tailscale is installed, on this
machine's Tailscale address — so other devices on your tailnet can join, but nothing
else on your network can. Use `--host` / `--port` to change that.

### Two-player

1. Run `python3 server.py` on one machine.
2. On each laptop, open `http://<that machine's Tailscale name or IP>:8137` and choose **TWO-PLAYER**.
3. Player 1 (first to join) picks a mode and presses **START**.

| Mode | What happens |
| --- | --- |
| **Co-op** | The full mission, together. 1.5× enemies and a tougher boss. A destroyed mech respawns beside its partner after 5 s; the mission fails only if both are down at once. No friendly fire. |
| **Versus** | One-on-one in the city — no AI enemies. Respawn after 3 s far from your rival; pickups keep appearing. The minimap doesn't show your rival. First to **10 kills** wins. |

Player 1's browser runs the game and the server relays it to Player 2, so if Player 1
closes their laptop the match pauses ("WAITING FOR PLAYER 1…"). Pause is disabled in
two-player. After a match, press R or click to return both players to the lobby.

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
| `server.py` | Serves the game and relays two-player messages (stdlib WebSocket) |
| `src/game.js` | Builds a game world for a mode/role; the `step` loop |
| `src/modes.js` | Solo / co-op / versus rules: spawning, respawns, win & loss |
| `src/sync.js` | Host → guest snapshots and replayed events |
| `src/net.js` | Browser WebSocket client |

Dev helpers: `?autostart` skips the title screen, `?level=N` picks a level,
`?mode=coop|versus` runs a two-player game on one page, and `window.game` /
`game.step(dt)` are exposed for debugging and automated tests.

### Tests

```sh
cd iron-precinct
python3 -m unittest tests.test_server      # server
bash tests/run_browser_tests.sh             # game, in headless Chromium
```
