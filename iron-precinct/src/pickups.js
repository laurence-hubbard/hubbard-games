import * as THREE from 'three';
import { box } from './util.js';
import { MAX_MISSILES } from './player.js';

const healthMat = new THREE.MeshBasicMaterial({ color: 0x4dff7a });
const ammoMat = new THREE.MeshBasicMaterial({ color: 0xffd24a });
const stripeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });

export class Pickups {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(type, pos) {
    const g = new THREE.Group();
    if (type === 'health') {
      g.add(box(1.2, 0.38, 0.38, healthMat), box(0.38, 1.2, 0.38, healthMat));
    } else {
      g.add(box(0.9, 0.6, 0.9, ammoMat), box(0.95, 0.15, 0.95, stripeMat));
    }
    g.position.set(pos.x, 1.3, pos.z);
    this.game.scene.add(g);
    const life = this.game.mode.pickupRespawnEvery ? Infinity : 25; // versus pickups stay until taken
    this.list.push({ id: this.game.nextId(), type, g, life });
  }

  update(dt) {
    const game = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i];
      it.life -= dt;
      it.g.rotation.y += dt * 2;
      it.g.position.y = 1.3 + Math.sin(game.time * 3 + i) * 0.25;
      it.g.visible = it.life > 5 || Math.floor(it.life * 8) % 2 === 0;
      let take = false;
      for (const p of game.players) {
        if (take || p.dead || Math.hypot(it.g.position.x - p.pos.x, it.g.position.z - p.pos.z) >= 2.6) continue;
        let text = null;
        if (it.type === 'health' && p.hp < p.maxHp) {
          p.heal(30);
          text = '+30 HULL';
        } else if (it.type === 'ammo' && p.missiles < MAX_MISSILES) {
          p.missiles = Math.min(MAX_MISSILES, p.missiles + 4);
          text = '+4 MISSILES';
        }
        if (text) {
          take = true;
          if (p === game.player) game.hud.toast(text);
          game.audio.play('pickup');
        }
      }
      if (take || it.life <= 0) {
        game.scene.remove(it.g);
        this.list.splice(i, 1);
      }
    }
  }
}
