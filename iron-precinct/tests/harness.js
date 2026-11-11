// Shared helpers for *.test.html pages.
export const log = (...a) => console.log('TEST', ...a);
let failures = 0;

export function check(name, cond, detail = '') {
  if (cond) log('PASS', name);
  else { failures++; log('FAIL', name, detail); }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Load ../index.html?<query> in a new iframe; resolves with its window once window.game exists. */
export async function openGame(query, { width = 1280, height = 800 } = {}) {
  const f = document.createElement('iframe');
  f.style.cssText = `width:${width}px;height:${height}px;border:0`;
  f.src = '../index.html?' + query;
  document.body.appendChild(f);
  await new Promise((r) => (f.onload = r));
  for (let i = 0; i < 200 && !f.contentWindow.game; i++) await wait(20);
  return f;
}

/** Advance a game by `sec` seconds of simulation at 60 fps; onFrame runs after every step. */
export function sim(game, sec, onFrame) {
  for (let i = 0; i < Math.round(sec * 60); i++) {
    game.step(1 / 60);
    onFrame?.();
  }
}

/** Run an async test body, reporting uncaught errors, then DONE. */
export async function run(body) {
  try {
    await body();
  } catch (err) {
    failures++;
    log('FAIL', 'uncaught', String(err && err.stack || err).replace(/\n/g, ' | '));
  }
  log('DONE', failures ? `${failures} failure(s)` : 'all passed');
}

/** Largest amount the player circle overlaps any building (0 = no clipping). */
export function buildingOverlap(game, player) {
  const p = player.pos, r = player.radius;
  let worst = 0;
  for (const b of game.level.buildings) {
    const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
    worst = Math.max(worst, r - Math.hypot(p.x - cx, p.z - cz));
  }
  return worst;
}
