/* global BABYLON */
import { canvasPlane, drawLabel, roundRect } from './world.js';

const B = BABYLON;

export const EMOTE_ICONS = { wave: '👋', cheer: '🎉', heart: '❤️', laugh: '😂' };

const toVec = (p) => new B.Vector3(p[0], p[1], p[2]);
const toQuat = (p) => new B.Quaternion(p[3], p[4], p[5], p[6]);

/** Text that floats upward and fades out, e.g. an emote or "+15". */
export function floatingText(scene, position, text, { color = '#fff', size = 0.6, duration = 1800 } = {}) {
  const label = canvasPlane(scene, { name: 'float', width: size * 2, height: size, res: 256, billboard: true });
  label.draw((ctx, w, h) => drawLabel(ctx, w, h, text, { color, bg: 'rgba(0,0,0,0)' }));
  label.mesh.position.copyFrom(position);
  const start = performance.now();
  const obs = scene.onBeforeRenderObservable.add(() => {
    const k = (performance.now() - start) / duration;
    if (k >= 1) {
      scene.onBeforeRenderObservable.remove(obs);
      label.dispose();
      return;
    }
    label.mesh.position.y = position.y + k * 0.8;
    label.mesh.visibility = 1 - k * k;
  });
}

/** A remote player: capsule body, head with visor, hands, name tag, chat bubble and a "nearby" ring. */
export class Avatar {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;
    this.target = { head: null, hands: [null, null] };

    const color = B.Color3.FromHexString(player.color);
    const mat = new B.StandardMaterial(`av-mat-${player.id}`, scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.15);
    this.material = mat;
    const meta = { playerId: player.id };

    this.body = B.MeshBuilder.CreateCapsule(`av-body-${player.id}`, { height: 1.2, radius: 0.24 }, scene);
    this.body.material = mat;
    this.body.metadata = meta;

    this.head = B.MeshBuilder.CreateSphere(`av-head-${player.id}`, { diameter: 0.34, segments: 16 }, scene);
    this.head.material = mat;
    this.head.metadata = meta;
    this.head.rotationQuaternion = B.Quaternion.Identity();
    const visor = B.MeshBuilder.CreateBox(`av-visor-${player.id}`, { width: 0.26, height: 0.09, depth: 0.08 }, scene);
    const visorMat = new B.StandardMaterial(`av-visor-mat-${player.id}`, scene);
    visorMat.diffuseColor = new B.Color3(0.05, 0.05, 0.1);
    visorMat.emissiveColor = new B.Color3(0.2, 0.6, 1).scale(0.6);
    visor.material = visorMat;
    visor.parent = this.head;
    visor.position.set(0, 0.02, 0.14); // Babylon's forward is +Z
    visor.metadata = meta;

    this.hands = [0, 1].map((i) => {
      const hand = B.MeshBuilder.CreateSphere(`av-hand-${i}-${player.id}`, { diameter: 0.1, segments: 8 }, scene);
      hand.material = mat;
      hand.rotationQuaternion = B.Quaternion.Identity();
      hand.isVisible = false;
      hand.metadata = meta;
      return hand;
    });

    this.nameTag = canvasPlane(scene, { name: `av-name-${player.id}`, width: 1.2, height: 0.24, res: 384, billboard: true });
    this.drawNameTag();

    this.ring = B.MeshBuilder.CreateTorus(`av-ring-${player.id}`, { diameter: 1.1, thickness: 0.05, tessellation: 32 }, scene);
    this.ringMat = new B.StandardMaterial(`av-ring-mat-${player.id}`, scene);
    this.ringMat.disableLighting = true;
    this.ring.material = this.ringMat;
    this.ring.isPickable = false;
    this.ring.isVisible = false;

    this.bubble = null;
    this.bubbleTimer = null;
  }

  drawNameTag() {
    this.nameTag.draw((ctx, w, h) => drawLabel(ctx, w, h, `${this.player.name} · ${this.player.points}`, { color: '#fff' }));
  }

  updatePlayer(player) {
    this.player = player;
    this.drawNameTag();
  }

  setTarget(head, left, right) {
    const first = !this.target.head;
    this.target.head = head;
    this.target.hands = [left, right];
    if (first) this.snap();
  }

  snap() {
    const h = this.target.head;
    this.head.position.copyFrom(toVec(h));
    this.head.rotationQuaternion.copyFrom(toQuat(h));
    this.layout();
  }

  /** Smoothly move toward the latest network pose (called every frame). */
  update(dt) {
    const h = this.target.head;
    if (!h) return;
    const k = 1 - Math.exp(-dt * 12);
    B.Vector3.LerpToRef(this.head.position, toVec(h), k, this.head.position);
    B.Quaternion.SlerpToRef(this.head.rotationQuaternion, toQuat(h), k, this.head.rotationQuaternion);
    this.target.hands.forEach((pose, i) => {
      const hand = this.hands[i];
      hand.isVisible = !!pose;
      if (pose) B.Vector3.LerpToRef(hand.position, toVec(pose), k, hand.position);
    });
    this.layout();
  }

  layout() {
    const p = this.head.position;
    const bodyHeight = Math.max(0.5, p.y - 0.28);
    this.body.scaling.y = bodyHeight / 1.2;
    this.body.position.set(p.x, bodyHeight / 2, p.z);
    // Body only turns with the head's yaw.
    const yaw = this.head.rotationQuaternion.toEulerAngles().y;
    this.body.rotation.y = yaw;
    this.nameTag.mesh.position.set(p.x, p.y + 0.34, p.z);
    if (this.bubble) this.bubble.mesh.position.set(p.x, p.y + 0.72, p.z);
    this.ring.position.set(p.x, 0.03, p.z);
  }

  /** 'none' | 'near' (can connect) | 'connected' (already a connection) */
  setHighlight(state) {
    this.ring.isVisible = state !== 'none';
    this.ringMat.emissiveColor = state === 'connected' ? new B.Color3(1, 0.82, 0.4) : new B.Color3(0.24, 0.86, 0.6);
  }

  say(text) {
    clearTimeout(this.bubbleTimer);
    if (!this.bubble) this.bubble = canvasPlane(this.scene, { name: `av-bubble-${this.player.id}`, width: 1.8, height: 0.45, res: 512, billboard: true });
    this.bubble.draw((ctx, w, h) => {
      roundRect(ctx, 0, 0, w, h, 24);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.fillStyle = '#10162a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = 44;
      ctx.font = `${size}px system-ui, sans-serif`;
      const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
      while (ctx.measureText(short).width > w * 0.92 && size > 18) {
        size -= 2;
        ctx.font = `${size}px system-ui, sans-serif`;
      }
      ctx.fillText(short, w / 2, h / 2);
    });
    this.layout();
    this.bubbleTimer = setTimeout(() => {
      this.bubble?.dispose();
      this.bubble = null;
    }, 6000);
  }

  emote(e) {
    const pos = this.head.position.add(new B.Vector3(0, 0.6, 0));
    floatingText(this.scene, pos, EMOTE_ICONS[e] || '⭐', { size: 0.5 });
  }

  dispose() {
    clearTimeout(this.bubbleTimer);
    this.bubble?.dispose();
    this.nameTag.dispose();
    for (const mesh of [this.body, this.head, this.ring, ...this.hands]) mesh.dispose(false, true);
  }
}
