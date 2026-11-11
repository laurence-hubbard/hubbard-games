# Iron Precinct v2 — Two-Player Co-op & Versus

## Intent

Laurence wants to play Iron Precinct with his wife, in the same room, each on
their own laptop. Two modes, both his request:

- **Co-op:** "same mission as the solo game but together."
- **Versus:** "we are trying to shoot each other — we're on the same map."

Success = the two of them sit down, open a URL, pick a mode, and play a
smooth, fair match without fiddling. Solo mode must keep working exactly as it does now.

## Goals

- Two players, two laptops, connected over Laurence's Tailscale tailnet to
  this Linux machine (`otto-dell`, 100.106.82.96).
- Co-op: the existing District 1 mission (3 jammers → Siegebreaker) with two mechs.
- Versus: 1v1 deathmatch on the same city map.
- Solo play unchanged.
- Zero install: `python3 server.py` (stdlib only — no pip/Node on this machine).

## Non-goals (for v2)

- More than 2 players, matchmaking, accounts or passwords. ("Log in" = open the URL and join.)
- Internet play outside the tailnet.
- Same-screen split-screen.
- New levels or graphics upgrades (separate future work).

## Anti-goals

- Lag or desync that makes the game feel worse than solo.
- A setup ritual (IP typing, room codes, restarting servers) before each game.
- Versus being one-sided because of information asymmetry (e.g. a minimap
  that shows the opponent).

## Decided by Laurence

- Same room, two players, both co-op and versus.
- Co-op = the same mission as solo, played together.
- Versus = shoot each other on the same map.
- Approved the playback below ("yes build it").

## Design (approved playback; items marked *[Claude's call]* were guesses he approved)

### Joining *[Claude's call]*
- Both open `http://otto-dell:8137` (or the Tailscale IP).
- Title screen: **Solo**, **Two-Player**.
- Two-Player: first to connect is **Player 1 (host)**, second is **Player 2**.
  A third connection is told "game full".
- Lobby shows both players' connection status. Player 1 picks **Co-op** or
  **Versus** and presses Start. Player 2 sees the choice live.
- After a match ends, either player can press R / click to return to the lobby;
  no reconnect needed.

### Co-op *[Claude's call]*
- Same level, jammers and boss. Two mechs; each transforms independently.
- Mech colours differ (P1 blue/white, P2 orange/white) so you can tell who's who.
- Enemies target whichever living player is nearer.
- Difficulty scaled for two: enemy counts ×1.5 (drones, rammers, turrets), boss HP ×1.5.
- Destroyed player respawns after 5 s next to their partner. Mission is lost only
  if both are down at the same time.
- Player bullets don't hurt your partner.
- Shared score; end screen shows each player's kills.

### Versus *[Claude's call]*
- Same city, no AI enemies, no jammers/boss. Crates stay (cover + pickups).
- Health and missile pickups respawn periodically on the roads.
- Destroyed player respawns after 3 s at the spawn point farthest from the opponent.
- First to **10 kills** wins.
- Minimap does **not** show the opponent.
- HUD shows both kill counts.

### Architecture *[Claude's call]*
- **`server.py`** (Python stdlib, asyncio): serves the static game files over
  HTTP and runs a WebSocket endpoint `/ws` on the same port (8137). It is a
  **relay**: it assigns player slots, tracks lobby state, and forwards
  messages between the two browsers. Binds to the Tailscale IP and localhost.
- **Host-authoritative simulation:** Player 1's browser runs the full game
  simulation (reusing the existing JS game code, generalised to N players).
- **Player 2** sends input (movement vector, aim point, fire buttons, transform
  presses) every frame, and receives state snapshots ~30×/s: players, enemies,
  projectiles, pickups, score/state, plus one-shot events (explosions, sparks,
  sounds, banners). Player 2 renders these with interpolation/extrapolation.
- The city is generated identically on both sides from the level seed; only
  dynamic entities travel over the wire.
- Trade-off accepted: if Player 1 closes their laptop, the match ends.

### Disconnects *[Claude's call]*
- If either player drops mid-match, the other sees "Partner disconnected" and
  returns to the lobby when they reconnect.

## Constraints

- No Node/npm/pip on this machine; Python 3.12 stdlib and the vendored Three.js only.
- No build step — plain ES modules served as files.
- Must stay playable on a laptop trackpad/mouse + keyboard.

## Left to the builder

- Message format and snapshot compression (JSON is fine at this scale).
- Interpolation buffer size, whether to add local prediction for Player 2's own mech
  (add it only if Player 2's movement feels laggy in testing).
- Exact spawn points, pickup respawn timers, co-op enemy placement.
- Test approach (headless Chromium with two clients driven via `game.step`).
