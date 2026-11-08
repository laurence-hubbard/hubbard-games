import * as THREE from 'three';
import { mulberry32, clamp } from './util.js';

export const BLOCK = 34;       // distance between block centres
export const BLOCK_SIZE = 22;  // width of a city block (rest is road)
const ROAD_W = BLOCK - BLOCK_SIZE;
const TILE = 8;                // world units per window-texture tile

function makeWindowTextures() {
  const size = 128, cells = 8, cell = size / cells;
  const base = document.createElement('canvas');
  const glow = document.createElement('canvas');
  base.width = base.height = glow.width = glow.height = size;
  const b = base.getContext('2d'), g = glow.getContext('2d');
  b.fillStyle = '#4a505e'; b.fillRect(0, 0, size, size);
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  const rnd = mulberry32(7);
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const r = rnd();
      const px = x * cell + 4, py = y * cell + 3, w = cell - 8, h = cell - 6;
      b.fillStyle = '#1b1f28'; b.fillRect(px, py, w, h);
      if (r < 0.5) continue;
      const col = r < 0.8 ? '#ffd88a' : r < 0.92 ? '#8ad8ff' : '#ff7ad1';
      g.globalAlpha = 0.35 + rnd() * 0.65;
      g.fillStyle = col; g.fillRect(px, py, w, h);
    }
  }
  const mk = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: mk(base), emissive: mk(glow) };
}

function scaleBoxUVs(geo, w, h, d, ou) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const f = Math.floor(i / 4); // face order: +x, -x, +y, -y, +z, -z
    let su = 1, sv = 1;
    if (f === 0 || f === 1) { su = d / TILE; sv = h / TILE; }
    else if (f === 4 || f === 5) { su = w / TILE; sv = h / TILE; }
    uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
}

export class Level {
  constructor(scene, def) {
    this.def = def;
    this.rnd = mulberry32(def.seed);
    this.buildings = []; // collision AABBs {minX,maxX,minZ,maxZ,h}
    this.fadeables = []; // buildings that fade when they hide the player
    this._ray = new THREE.Ray();
    this._tmp = new THREE.Vector3();
    this.half = def.blocks * BLOCK + BLOCK_SIZE / 2 + ROAD_W;
    this.plazas = new Set(def.plazas.map(([i, j]) => `${i},${j}`));
    this.group = new THREE.Group();
    scene.add(this.group);
    this.build();
  }

  blockCenter(i, j) { return new THREE.Vector3(i * BLOCK, 0, j * BLOCK); }

  roadCoords() {
    const r = [];
    for (let k = -this.def.blocks - 1; k <= this.def.blocks; k++) r.push(k * BLOCK + BLOCK / 2);
    return r;
  }

  intersections() {
    const r = this.roadCoords(), out = [];
    for (const x of r) for (const z of r) out.push(new THREE.Vector3(x, 0, z));
    return out;
  }

  build() {
    const n = this.def.blocks, H = this.half;
    const tex = makeWindowTextures();

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 2 + 260, H * 2 + 260),
      new THREE.MeshStandardMaterial({ color: 0x16181e, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    const tints = [0x9aa6bf, 0xb0a596, 0x8798b3, 0xa596b8];
    this.sideMats = tints.map((c) => new THREE.MeshStandardMaterial({
      color: c, map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff,
      emissiveIntensity: 1.1, roughness: 0.85, metalness: 0.1,
    }));
    this.roofMat = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.9 });
    this.neonMats = [0xff2bd6, 0x2bf3ff, 0xffb02b].map((c) => new THREE.MeshBasicMaterial({ color: c }));
    const walkMat = new THREE.MeshStandardMaterial({ color: 0x2b2e37, roughness: 0.9 });
    const plazaMat = new THREE.MeshStandardMaterial({ color: 0x323848, roughness: 0.6, metalness: 0.3 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x2b6cff, transparent: true, opacity: 0.5, side: THREE.DoubleSide });

    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const cx = i * BLOCK, cz = j * BLOCK;
        const plaza = this.plazas.has(`${i},${j}`);
        const slab = new THREE.Mesh(new THREE.BoxGeometry(BLOCK_SIZE, 0.25, BLOCK_SIZE), plaza ? plazaMat : walkMat);
        slab.position.set(cx, 0.125, cz);
        slab.receiveShadow = true;
        this.group.add(slab);
        if (plaza) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(7, 7.5, 48), ringMat);
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(cx, 0.27, cz);
          this.group.add(ring);
        } else {
          this.fillBlock(cx, cz, true);
        }
      }
    }
    // Skyline beyond the boundary wall (visual only).
    for (let i = -n - 2; i <= n + 2; i++) {
      for (let j = -n - 2; j <= n + 2; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) <= n) continue;
        this.fillBlock(i * BLOCK, j * BLOCK, false);
      }
    }

    // Boundary walls.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4c, roughness: 0.8 });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffb02b });
    const L = H * 2 + 4;
    for (const [x, z, w, d] of [[0, -H - 1, L, 2], [0, H + 1, L, 2], [-H - 1, 0, 2, L], [H + 1, 0, 2, L]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), wallMat);
      wall.position.set(x, 1.5, z);
      wall.receiveShadow = wall.castShadow = true;
      this.group.add(wall);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.25, d + 0.05), stripeMat);
      stripe.position.set(x, 2.6, z);
      this.group.add(stripe);
      this.buildings.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h: 3 });
    }

    // Lane markings.
    const roads = this.roadCoords();
    const placements = [];
    for (const rc of roads) {
      for (let t = -H + 3; t < H - 3; t += 5) {
        if (roads.some((q) => Math.abs(q - t) < 7.5)) continue;
        placements.push([t, rc, 0], [rc, t, Math.PI / 2]);
      }
    }
    const dashes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.2, 0.03, 0.25),
      new THREE.MeshBasicMaterial({ color: 0x77703f }),
      placements.length
    );
    const dummy = new THREE.Object3D();
    placements.forEach(([x, z, ry], idx) => {
      dummy.position.set(x, 0.02, z);
      dummy.rotation.set(0, ry, 0);
      dummy.updateMatrix();
      dashes.setMatrixAt(idx, dummy.matrix);
    });
    this.group.add(dashes);
  }

  fillBlock(cx, cz, collide) {
    const r = this.rnd;
    if (r() < 0.25) {
      this.addBuilding(cx, cz, 16 + r() * 4, 16 + r() * 4, 20 + r() * 26, collide);
      return;
    }
    // Buildings sit flush against the block's centre lines, so neighbours either
    // touch or leave a full empty lot — never a slot too narrow for the mech.
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (r() < 0.12) continue;
      const w = 7 + r() * 3.5, d = 7 + r() * 3.5;
      this.addBuilding(cx + (sx * w) / 2, cz + (sz * d) / 2, w, d, 7 + r() * 22, collide);
    }
  }

  addBuilding(x, z, w, d, h, collide) {
    const r = this.rnd;
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d, Math.floor(r() * 8) / 8);
    // Per-building material clones (textures shared) so each can fade independently.
    const side = this.sideMats[Math.floor(r() * this.sideMats.length)].clone();
    const roof = this.roofMat.clone();
    const mesh = new THREE.Mesh(geo, [side, side, roof, roof, side, side]);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    const fadeMats = [side, roof];
    if (r() < 0.35) {
      const neon = this.neonMats[Math.floor(r() * 3)].clone();
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.3, d + 0.2), neon);
      trim.position.set(x, h - 0.6, z);
      this.group.add(trim);
      fadeMats.push(neon);
    }
    for (const m of fadeMats) m.transparent = true;
    this.fadeables.push({
      box: new THREE.Box3(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, h, z + d / 2)),
      mats: fadeMats, opacity: 1,
    });
    if (collide) this.buildings.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
  }

  /** Fade out buildings that sit between the camera and the player. */
  updateOcclusion(camPos, playerPos, dt) {
    const target = this._tmp.set(playerPos.x, 2, playerPos.z);
    const dist = camPos.distanceTo(target);
    this._ray.set(camPos, target.clone().sub(camPos).normalize());
    const k = 1 - Math.exp(-10 * dt);
    for (const f of this.fadeables) {
      // Only buildings on the camera side of the player can occlude it.
      const want = f.box.max.z > playerPos.z - 6 && this.hits(f.box, dist) ? 0.18 : 1;
      if (Math.abs(f.opacity - want) < 0.01) continue;
      f.opacity += (want - f.opacity) * k;
      if (Math.abs(f.opacity - want) < 0.01) f.opacity = want;
      for (const m of f.mats) {
        m.opacity = f.opacity;
        m.depthWrite = f.opacity > 0.99;
      }
    }
  }

  hits(box, maxDist) {
    // Slightly inflate so the mech isn't half-hidden at building edges.
    const b = box.clone().expandByScalar(1.5);
    const hit = this._ray.intersectBox(b, new THREE.Vector3());
    return !!hit && hit.distanceTo(this._ray.origin) < maxDist;
  }

  /** Push a circle at p (Vector3, XZ) with radius r out of all buildings. Returns true if it collided. */
  resolveCircle(p, r) {
    // Two passes so corners between touching buildings resolve cleanly.
    const a = this.resolvePass(p, r);
    const b = this.resolvePass(p, r);
    return a || b;
  }

  resolvePass(p, r) {
    let hit = false;
    for (const b of this.buildings) {
      if (p.x < b.minX - r || p.x > b.maxX + r || p.z < b.minZ - r || p.z > b.maxZ + r) continue;
      const cx = clamp(p.x, b.minX, b.maxX), cz = clamp(p.z, b.minZ, b.maxZ);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * r;
        p.z = cz + (dz / d) * r;
      } else {
        const l = p.x - b.minX, rr = b.maxX - p.x, t = p.z - b.minZ, bt = b.maxZ - p.z;
        const m = Math.min(l, rr, t, bt);
        if (m === l) p.x = b.minX - r; else if (m === rr) p.x = b.maxX + r;
        else if (m === t) p.z = b.minZ - r; else p.z = b.maxZ + r;
      }
    }
    const lim = this.half - r;
    if (Math.abs(p.x) > lim || Math.abs(p.z) > lim) hit = true;
    p.x = clamp(p.x, -lim, lim);
    p.z = clamp(p.z, -lim, lim);
    return hit;
  }

  blockedAt(x, z, y) {
    if (Math.abs(x) > this.half + 2 || Math.abs(z) > this.half + 2) return true;
    for (const b of this.buildings) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && y < b.h) return true;
    }
    return false;
  }

  lineOfSight(a, b, y = 2) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const steps = Math.ceil(Math.hypot(dx, dz) / 1.5);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (this.blockedAt(a.x + dx * t, a.z + dz * t, y)) return false;
    }
    return true;
  }

  randomRoadPoint(avoid, minDist = 35) {
    const roads = this.roadCoords();
    for (let tries = 0; tries < 200; tries++) {
      const rc = roads[Math.floor(this.rnd() * roads.length)];
      const t = (this.rnd() * 2 - 1) * (this.half - 8);
      const off = (this.rnd() * 2 - 1) * 3.5;
      const p = this.rnd() < 0.5 ? new THREE.Vector3(t, 0, rc + off) : new THREE.Vector3(rc + off, 0, t);
      if (avoid && Math.hypot(p.x - avoid.x, p.z - avoid.z) < minDist) continue;
      return p;
    }
    return new THREE.Vector3(roads[0], 0, roads[0]);
  }
}
