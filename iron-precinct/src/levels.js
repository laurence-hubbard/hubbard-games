// Level definitions. Coordinates are in city-block units: block (i, j) is centred
// at (i * 34, j * 34) in world space. -j is "north" (up on screen).
// Add new levels by appending entries here.
export const LEVELS = [
  {
    name: 'DISTRICT 1 — HARBOR GRID',
    seed: 1337,
    blocks: 3, // city spans blocks -3..3 on each axis
    start: [0, 3],
    plazas: [[0, 3], [-2, 1], [2, 1], [0, -1], [0, -3]],
    jammers: [[-2, 1], [2, 1], [0, -1]],
    boss: [0, -3],
    turrets: 10,
    drones: 14,
    rammers: 8,
    crates: 34,
  },
];
