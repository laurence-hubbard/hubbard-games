# Iron Precinct v2 Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two-player Co-op and Versus to Iron Precinct, played on two laptops over Tailscale, while solo stays unchanged.

**Architecture:** A stdlib-only Python `server.py` serves the game files and relays WebSocket messages between two browsers. Player 1's browser runs the authoritative simulation (the existing JS, generalised to N players and a pluggable "mode"); Player 2 sends inputs and renders ~30 Hz snapshots plus one-shot events.

**Tech Stack:** Python 3.12 stdlib (asyncio, hashlib, base64, unittest); plain ES modules + vendored Three.js r160; headless `chrome-headless-shell` for browser tests.

**Spec:** `docs/superpowers/specs/2026-11-11-iron-precinct-v2-multiplayer-design.md`

## Global Constraints

- No dependencies beyond Python 3.12 stdlib and the vendored `iron-precinct/vendor/three.module.js`. No build step.
- Server port **8137**; binds `127.0.0.1` plus the Tailscale IPv4 from `tailscale ip -4` when available; `--host`/`--port` override.
- Exactly 2 player slots; a 3rd connection gets `{"t":"full"}` and is closed.
- Co-op: drone/rammer/turret counts ×1.5 (rounded), boss HP ×1.5, respawn after **5 s** beside partner, lose only when both are down, no friendly fire.
- Versus: no AI enemies/jammers/boss (crates stay), respawn after **3 s** at the spawn point farthest from opponent, first to **10 kills** wins, minimap hides opponent.
- P1 colours blue/white (existing); P2 orange/white (accent `0xd1661f`).
- Solo behaviour and the `?autostart`, `?level=N`, `window.game`, `game.step(dt)` dev hooks keep working.

## Review Focus

- Host tab hidden / laptop lid closed → host simulation stops; Player 2 must see "WAITING FOR PLAYER 1…" after 2 s without snapshots, not a frozen game. (Task 5 test `guest_stall_overlay`.)
- Either player reloads mid-match → the other returns to the lobby with "Partner disconnected", and the reloader gets a slot again rather than "full". (Task 1 `test_reconnect_after_disconnect_gets_slot`, Task 5 `disconnect_returns_lobby`.)
- A stale third tab is open → it shows "Game full — two players already connected", not a hang. (Task 1 `test_third_client_full`, Task 5 `third_client_sees_full`.)
- P / Esc pressed in a two-player match → must not freeze the shared game; pause is disabled in two-player. (Task 5 `no_pause_in_two_player`.)
- Malformed/binary/oversized frame from one client → that client is dropped; the other client and the server keep working. (Task 1 `test_garbage_frame_drops_only_sender`.)

---

## File Structure

| File | Responsibility |
| --- | --- |
| `iron-precinct/server.py` (new) | HTTP static files + `/ws` WebSocket handshake/framing + 2-slot lobby relay |
| `iron-precinct/tests/test_server.py` (new) | unittest suite for server.py using raw sockets |
| `iron-precinct/tests/run_browser_tests.sh` (new) | Starts server on port 8199, runs each `*.test.html` in headless Chromium, fails on any `FAIL` line |
| `iron-precinct/tests/*.test.html` (new) | Browser tests that drive `game.step(dt)` and log `PASS name` / `FAIL name` / `DONE` |
| `iron-precinct/src/game.js` (new) | `createGame(opts)` — builds scene, level, entities, players for a mode; owns `step(dt)` |
| `iron-precinct/src/modes.js` (new) | Mode rule objects + populate / death / end-of-match logic |
| `iron-precinct/src/sync.js` (new) | Snapshot build/apply, event recording/replay |
| `iron-precinct/src/net.js` (new) | Browser WebSocket client wrapper |
| `iron-precinct/src/main.js` (modify) | Boot, renderer, title/lobby UI flow, render loop only |
| `src/player.js`, `src/enemies.js`, `src/projectiles.js`, `src/pickups.js`, `src/hud.js`, `index.html`, `style.css` (modify) | Generalise to N players, ids, net state, 2P HUD |

---

### Task 1: WebSocket relay server

**Files:**
- Create: `iron-precinct/server.py`
- Test: `iron-precinct/tests/test_server.py`

**Interfaces:**
- Produces: `python3 server.py [--host H ...] [--port P]`. Wire protocol (JSON text frames, every message has `"t"`):
  - server→client: `{"t":"welcome","slot":1|2}`, `{"t":"full"}` (then close), `{"t":"lobby","players":[bool,bool],"mode":"coop"|"versus","phase":"lobby"|"playing"}`, `{"t":"start","mode":...,"seed":int}`, `{"t":"left","slot":n}`
  - client→server handled by server: `{"t":"mode","mode":...}` (slot 1 only), `{"t":"start"}` (slot 1 only, both present), `{"t":"end"}` (either slot → phase lobby)
  - any other `t` (`input`, `snap`, …) is forwarded verbatim to the other slot.
- Produces for tests: `make_server(root: str, hosts: list[str], port: int) -> asyncio.Server`-style entry `async def serve(root, hosts, port)` and a `Lobby` class; tests run it in a background thread on port 0/8198.

- [ ] **Step 1: Write failing tests** in `tests/test_server.py` (unittest, raw-socket WS client helper that sends masked frames):
  - `test_static_serves_index` — GET `/` → 200, body contains `IRON PRECINCT`, `Content-Type: text/html`.
  - `test_js_mime_type` — GET `/src/main.js` → `Content-Type` starts with `text/javascript` (ES modules need it).
  - `test_path_traversal_blocked` — GET `/../server.py` and `/%2e%2e/server.py` → 404.
  - `test_first_two_get_slots_third_full` — welcomes slot 1 then 2; third receives `{"t":"full"}` then connection closes.
  - `test_lobby_broadcast_on_join` — after both join, both receive lobby with `players == [True, True]`, `phase == "lobby"`, default `mode == "coop"`.
  - `test_only_p1_sets_mode_and_starts` — P2 `mode`/`start` ignored; P1 `mode: versus` then `start` → both receive `{"t":"start","mode":"versus"}` with an int seed.
  - `test_start_requires_two_players` — P1 alone sends start → no `start` message within 0.3 s.
  - `test_relay_forwards_other_messages` — P2 `{"t":"input","x":1}` arrives at P1 unchanged; P1 `snap` arrives at P2; sender does not receive its own.
  - `test_disconnect_notifies_and_resets` — during playing, P2 closes → P1 gets `{"t":"left","slot":2}` and lobby with `phase == "lobby"`.
  - `test_reconnect_after_disconnect_gets_slot` — after P2 leaves, a new client is welcomed as slot 2.
  - `test_garbage_frame_drops_only_sender` — P2 sends a binary frame / invalid JSON / 2 MB frame → P2 is closed; P1 can still set mode and gets lobby replies; a new client can join.
  - `test_ping_gets_pong`.

- [ ] **Step 2: Run to verify failure**
  Run: `cd iron-precinct && python3 -m unittest tests.test_server -v`
  Expected: errors (`server` module missing).

- [ ] **Step 3: Implement `server.py`**
  asyncio `start_server` per host; parse request line + headers; `Upgrade: websocket` on `/ws` → RFC 6455 handshake (`Sec-WebSocket-Accept = base64(sha1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`); otherwise static file from the game root (resolve and confirm it stays under root; `mimetypes` with `.js → text/javascript`). Frame reader: FIN text/close/ping only, payload length 7/16/64-bit, client mask required, max 1 MiB → else close sender. `Lobby` holds `slots = {1: None, 2: None}`, `mode`, `phase`; assigns lowest free slot. Log one line per join/leave. `--host` repeatable; default hosts = `127.0.0.1` + `tailscale ip -4` output if the command succeeds.

- [ ] **Step 4: Run tests to verify pass**
  Run: `cd iron-precinct && python3 -m unittest tests.test_server -v`
  Expected: all 12 tests OK.

- [ ] **Step 5: Commit**
  `git add iron-precinct/server.py iron-precinct/tests/test_server.py && git commit -m "feat(server): stdlib static + WebSocket relay with 2-slot lobby"`

---

### Task 2: Multi-player-ready core (solo still identical)

**Files:**
- Create: `iron-precinct/src/game.js`, `iron-precinct/src/modes.js`, `iron-precinct/tests/run_browser_tests.sh`, `iron-precinct/tests/solo.test.html`
- Modify: `src/main.js`, `src/player.js`, `src/enemies.js`, `src/projectiles.js`, `src/pickups.js`, `src/hud.js`

**Interfaces:**
- Produces:
  - `createGame({ renderer, def, mode: 'solo'|'coop'|'versus', role: 'solo'|'host'|'guest', localSlot: 1|2, net? }) -> game`. `game.players: Player[]` (index = slot−1), `game.player` = local player (camera/HUD), `game.step(dt)`, `game.render()`, `game.dispose()`, `game.nextId() -> int`, `game.nearestPlayer(pos) -> Player|null` (alive only), `game.mode` (rules object from modes.js), `game.remoteInputs: {[slot]: InputState}`.
  - `InputState = { mx, mz, ax, az, fire: bool, missile: bool, tseq: int }` (move vector, world aim point, transform press counter).
  - `readLocalInput(game) -> InputState` in `game.js` (from `Input` + aim raycast; `tseq` increments on Space/Q press).
  - `new Player(game, x, z, { slot, accent })`; `player.update(dt, inp: InputState)`; `player.kills`; `player.damage(n, sourceSlot?)`; `player.respawnT`.
  - Every enemy, projectile and pickup gets `id = game.nextId()`. `enemy.damage(n, sourceSlot?)` records `lastHitBy`; on death credits `game.players[lastHitBy-1].kills`.
  - Projectiles: player-owned carry `ownerSlot`. `game.damageArea(pos, r, dmg, owner, ownerSlot?)`.
  - `modes.js`: `export const MODES = { solo, coop, versus }`, each `{ name, aiEnemies: bool, countScale, bossHpScale, friendlyFire: bool, respawnDelay: number|null, respawnNearPartner: bool, killTarget: number|null, minimapShowsOthers: bool, pickupRespawnEvery: number|null }`; `populate(game)`, `onPlayerDown(game, player, killerSlot)`, `checkEnd(game)` (sets `game.state` to `'won'|'lost'` and `game.winnerSlot`).
  - `game.onPlayerHurt(player)` — flashes vignette/plays hurt only if `player === game.player`.

- [ ] **Step 1: Write the browser test harness and failing solo test**
  `run_browser_tests.sh`: starts `python3 server.py --host 127.0.0.1 --port 8199` in background, runs `chrome-headless-shell --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=60000 --enable-logging=stderr --v=0 http://127.0.0.1:8199/tests/<name>.test.html` per test (LD_LIBRARY_PATH from `/tmp/chromelibs/ldpath` if present), prints lines matching `TEST`, exits 1 if any `FAIL` or no `DONE`.
  `solo.test.html` (iframe `../index.html?autostart`, drive `game.step(1/60)`), assertions:
  - `solo_shooting` — standing 10 south of a jammer aiming north with fire held 2.5 s → jammer hp < 240.
  - `solo_transform` — tseq bump → `player.mode === 'hover'` after 0.7 s.
  - `solo_boss_spawns` — kill all jammers → `game.boss` alive within 3.5 s.
  - `solo_missiles_hit_boss` — after camera settles, 2 s of missiles → boss hp drops ≥ 100.
  - `solo_win` — kill boss → `state === 'won'` within 3.8 s.
  - `solo_no_wall_clipping` — 20 s of driving along walls in hover → max building overlap < 0.01.
  - `solo_single_player` — `game.players.length === 1`, `game.mode.name === 'solo'`.

- [ ] **Step 2: Run to verify failure**
  Run: `bash iron-precinct/tests/run_browser_tests.sh solo`
  Expected: `FAIL solo_single_player` (no `players`/`mode` yet); others may pass.

- [ ] **Step 3: Implement the refactor**
  Move game construction + `step` from `main.js` into `createGame`; `main.js` keeps renderer, resize, title UI, rAF loop calling `game.step` + `game.render`. Replace every `game.player`/`g.player` in enemies with `this.target = game.nearestPlayer(this.pos)` (enemies idle if null). Projectiles: enemy-owned test all alive players. `solo` mode populate = existing `populate()`. Player death in solo → existing "UNIT DESTROYED" flow via `modes.onPlayerDown`.

- [ ] **Step 4: Run to verify pass**
  Run: `bash iron-precinct/tests/run_browser_tests.sh solo` → all `PASS`, `DONE`.
  Also play solo by hand at `http://127.0.0.1:8137` (server.py) for 1 minute: no console errors.

- [ ] **Step 5: Commit** — `git commit -m "refactor: N-player game core, modes module, browser test harness"`

---

### Task 3: Co-op and Versus rules (single page, no network)

**Files:**
- Modify: `src/modes.js`, `src/game.js`, `src/player.js`, `src/enemies.js`, `src/projectiles.js`, `src/pickups.js`
- Test: `iron-precinct/tests/rules.test.html`

**Interfaces:**
- Consumes: Task 2 interfaces.
- Produces: `createGame({ mode: 'coop'|'versus', role: 'host', localSlot: 1 })` with two players; P2 driven by `game.remoteInputs[2]` (test sets it directly). P2 built with `accent: 0xd1661f`.
- Spawns: P1 at start plaza +4 z, P2 at start plaza +4 z, +5 x (co-op); versus spawn points = road intersections; P1 starts at the one nearest `(-half, half)`, P2 farthest from P1.

- [ ] **Step 1: Write failing tests** in `rules.test.html` (iframe `../index.html?autostart&mode=coop` / `&mode=versus` — add a dev-only `mode` query param that creates a local host game with P2 fed from `remoteInputs`):
  - `coop_two_players` — `players.length === 2`, P2 accent differs from P1.
  - `coop_scaled_counts` — drone/rammer/turret counts equal `round(def.N × 1.5)` (+ 6 jammer guard turrets unchanged); boss maxHp after spawn === 2250.
  - `coop_enemies_target_nearer` — a woken drone 10 from P2 and 60 from P1 has `target === players[1]`.
  - `coop_no_friendly_fire` — P1 fires at P2 for 2 s → P2 hp unchanged.
  - `coop_respawn_near_partner` — P2 hp→0: `dead`, after 5.1 s alive with full hp within 8 units of P1.
  - `coop_both_down_loses` — P2 down, then P1 down within 5 s → `state === 'lost'`; and P1 down alone → state stays `playing`.
  - `coop_kill_credit` — enemy killed by a P2 bullet → `players[1].kills === 1`.
  - `versus_no_ai` — no enemy of type drone/turret/rammer/jammer/boss; crates > 0.
  - `versus_damage_and_kill` — P1 fires at P2 until dead → `players[0].kills === 1`.
  - `versus_respawn_far` — P2 respawns after 3.1 s at the spawn point farthest from P1 (≥ 60 units).
  - `versus_ten_kills_wins` — set P1 kills to 9 then kill P2 → `state === 'won'`, `winnerSlot === 1`.
  - `versus_pickups_respawn` — after 30 s with none collected, pickups count > 0.
  - `versus_minimap_hides_opponent` — `game.mode.minimapShowsOthers === false`, and `hud.minimapPlayers()` returns only the local player.

- [ ] **Step 2: Run to verify failure** — `bash iron-precinct/tests/run_browser_tests.sh rules` → FAILs.

- [ ] **Step 3: Implement** mode objects with the Global Constraints values; versus pickups every 10 s up to 6 alive (life Infinity in versus); `hud.minimapPlayers()` used by `drawMinimap`.

- [ ] **Step 4: Run to verify pass** — `bash iron-precinct/tests/run_browser_tests.sh solo rules` → all PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: co-op and versus rules"`

---

### Task 4: Snapshot sync (host → guest), without network

**Files:**
- Create: `iron-precinct/src/sync.js`
- Modify: `src/enemies.js`, `src/player.js`, `src/projectiles.js`, `src/pickups.js`, `src/game.js`
- Test: `iron-precinct/tests/sync.test.html`

**Interfaces:**
- Produces:
  - `recordEvents(game)` — on host, wraps `effects.explosion`, `effects.sparks`, `audio.play`, `hud.banner`, `hud.toast`(with slot), `onPlayerHurt` so each call also pushes to `game.events` (`{e:'boom',x,y,z,size}`, `{e:'sparks',x,y,z,c,n}`, `{e:'sfx',name}`, `{e:'banner',text,dur}`, `{e:'toast',slot,text}`, `{e:'hurt',slot}`).
  - `buildSnapshot(game) -> object` (`t:'snap'`, `time, state, winnerSlot, score, jammersLeft, bossId, players[], enemies[], proj[], pickups[], events[]`; numbers rounded to 2 dp; drains `game.events`).
  - `applySnapshot(game, snap)` on guest — creates/updates/removes entities by `id` using the same classes for meshes, replays events, sets state.
  - Per class: `netState() -> object` and `applyNet(s)`; enemies split visual-only animation into `animate(dt)` (called by `update` on host and every frame on guest). Guest smooths positions toward the latest snapshot and extrapolates projectiles by velocity.
  - Guest `createGame({ role: 'guest' })` builds the level from the seed but does not `populate`, and never runs enemy AI, collisions or damage.

- [ ] **Step 1: Write failing tests** — page creates a host game and a guest game (no renderer) in two iframes (`?autostart&mode=coop&role=host|guest&net=loopback` — loopback = direct function calls via `window.parent`), steps host, feeds `buildSnapshot` into `applySnapshot`:
  - `sync_entities_match` — guest enemy ids/types equal host's after one snapshot.
  - `sync_positions_close` — after host moves P1 for 2 s with snapshots each 1/30 s, guest P1 within 0.5 units.
  - `sync_removal` — host kills a drone → after next snapshot guest has no such id and the guest scene no longer contains its mesh.
  - `sync_events_replayed` — host explosion → guest `effects.flashes.length > 0` after apply; `hurt` for slot 2 flashes guest vignette, `hurt` for slot 1 does not.
  - `sync_guest_inputs_drive_p2` — guest `readLocalInput` → host `remoteInputs[2]` with `mx: 1` for 1 s → host P2 x increased > 5.
  - `sync_snapshot_size` — `JSON.stringify(snap).length < 40000` at mission start.

- [ ] **Step 2: Run to verify failure** — `bash iron-precinct/tests/run_browser_tests.sh sync`.
- [ ] **Step 3: Implement** `sync.js` and per-class `netState/applyNet/animate`.
- [ ] **Step 4: Run to verify pass** — `bash iron-precinct/tests/run_browser_tests.sh solo rules sync` → all PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: host snapshot sync and guest rendering"`

---

### Task 5: Networking, lobby UI and match flow

**Files:**
- Create: `iron-precinct/src/net.js`, `iron-precinct/tests/mp.test.html`
- Modify: `src/main.js`, `src/game.js`, `index.html`, `style.css`, `src/hud.js`

**Interfaces:**
- Consumes: Task 1 protocol, Task 4 sync functions.
- Produces: `class Net { connect(url) -> Promise<void>; on(t, fn); send(obj); close(); slot }` (URL `ws(s)://<location.host>/ws`). Host sends `buildSnapshot` every 1/30 s of sim time inside `game.step`; guest sends `{t:'input', ...InputState}` every step.
- UI: title screen buttons **SOLO** and **TWO-PLAYER**. Lobby screen: "PLAYER 1 — connected (you)" / "PLAYER 2 — waiting…", mode buttons **CO-OP** / **VERSUS** (P1 clickable, P2 read-only), **START** (P1 only, enabled when both connected). Messages: `Game full — two players already connected`, `Partner disconnected`, `WAITING FOR PLAYER 1…` (guest, no snapshot for 2 s).

- [ ] **Step 1: Write failing tests** in `mp.test.html` — two iframes (`../index.html`), real server, buttons clicked via DOM, game stepped via `game.step`, `await` 20 ms between batches so sockets flush:
  - `lobby_slots` — first iframe slot 1, second slot 2; both lobby UIs show both connected.
  - `p2_cannot_start` — P2 START button absent/disabled.
  - `coop_start_both_playing` — P1 picks CO-OP, START → both `game.state === 'playing'`, `mode.name === 'coop'`, same level seed.
  - `guest_moves_on_both` — guest holds D 1 s → host P2 x increases > 5 and guest's own P2 within 1 unit of host's.
  - `guest_bullets_damage_enemy` — guest fires at a jammer → host jammer hp decreases.
  - `versus_round_trip` — return to lobby (`end`), P1 picks VERSUS, START → host P1 kills guest P2 → guest sees P1 kills 1 in HUD.
  - `no_pause_in_two_player` — P key on either side → host state stays `playing`.
  - `guest_stall_overlay` — host stops stepping 2.5 s → guest overlay text contains `WAITING FOR PLAYER 1`.
  - `disconnect_returns_lobby` — remove guest iframe → host shows `Partner disconnected` and lobby; re-add iframe → it gets slot 2.
  - `third_client_sees_full` — a third iframe clicking TWO-PLAYER shows `Game full`.

- [ ] **Step 2: Run to verify failure** — `bash iron-precinct/tests/run_browser_tests.sh mp`.
- [ ] **Step 3: Implement** `net.js`, lobby screens, wiring in `main.js` (new `createGame` per match; `game.dispose()` on return to lobby), R/click after a 2P match sends `{t:'end'}`.
- [ ] **Step 4: Run all tests** — `cd iron-precinct && python3 -m unittest tests.test_server && bash tests/run_browser_tests.sh solo rules sync mp` → all PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: two-player lobby, networking and match flow"`

---

### Task 6: Two-player HUD, end screens, docs, ship

**Files:**
- Modify: `src/hud.js`, `index.html`, `style.css`, `README.md`
- Test: extend `iron-precinct/tests/mp.test.html`

**Interfaces:**
- Consumes: `game.mode`, `game.players`, `game.winnerSlot`.
- HUD: co-op shows `PARTNER` hull % under the local hull bar; versus replaces SCORE panel with `YOU n — n RIVAL`. End screens: co-op win `DISTRICT SECURED` + per-player kills; co-op loss `SQUAD DESTROYED`; versus `YOU WIN` / `YOU LOSE` with final kills from each perspective; CTA `PRESS R OR CLICK TO RETURN TO LOBBY`.

- [ ] **Step 1: Write failing tests** (append to `mp.test.html`): `hud_partner_hp` (co-op, guest HUD shows partner % equal to host P1 hp), `hud_versus_scoreboard` (after P1 kill, host shows `YOU 1 — 0 RIVAL`, guest shows `YOU 0 — 1 RIVAL`), `end_screens_perspective` (P1 reaches 10 → host `YOU WIN`, guest `YOU LOSE`), `end_returns_to_lobby` (click → both lobby).
- [ ] **Step 2: Run to verify failure** — `bash iron-precinct/tests/run_browser_tests.sh mp`.
- [ ] **Step 3: Implement** HUD + end screens; README: two-player section (`python3 server.py`, open `http://otto-dell:8137`, controls, modes).
- [ ] **Step 4: Run full suite** — `cd iron-precinct && python3 -m unittest tests.test_server && bash tests/run_browser_tests.sh solo rules sync mp` → all PASS. Restart the live server (`pkill -f "http.server 8137"; nohup python3 server.py &`) and confirm `curl http://100.106.82.96:8137/` → 200.
- [ ] **Step 5: Commit and push** — `git commit -m "feat: two-player HUD, end screens, docs" && git push`
