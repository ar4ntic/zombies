import {
  AdditiveBlending,
  CanvasTexture,
  CapsuleGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Scene,
} from "three";
import type { PlayerState } from "@zombies/shared";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const SMOOTHING = 14;
const COLORS = ["#3d8bff", "#ff8a3d", "#c35bff", "#ffd23d"];

interface Remote {
  state: PlayerState;
  root: Group;
  body: Group;
  shield: Mesh;
  suit: MeshStandardMaterial;
  deadT: number;
  wasDead: boolean;
}

const bodyGeometry = new CapsuleGeometry(0.3, 0.75, 6, 16);
const headGeometry = new SphereGeometry(0.2, 24, 16);
const visorGeometry = new RoundedBoxGeometry(0.3, 0.09, 0.12, 2, 0.03);
const gunGeometry = new RoundedBoxGeometry(0.08, 0.1, 0.5, 2, 0.02);
const shieldGeometry = new SphereGeometry(1, 32, 16);
const skin = new MeshStandardMaterial({ color: "#e8b996", roughness: 0.6 });
const visor = new MeshStandardMaterial({ color: "#101418", roughness: 0.15, metalness: 0.6, emissive: "#2fd8ff", emissiveIntensity: 0.6 });
const gunMaterial = new MeshStandardMaterial({ color: "#2a2d33", metalness: 0.8, roughness: 0.35 });

export class RemotePlayers {
  private readonly players = new Map<string, Remote>();
  private colorIndex = 0;

  constructor(private readonly scene: Scene) {}

  add(id: string, state: PlayerState) {
    const color = COLORS[this.colorIndex++ % COLORS.length]!;
    const root = new Group();
    const body = new Group();
    const suit = new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, emissive: "#6ee7ff", emissiveIntensity: 0 });
    const torso = new Mesh(bodyGeometry, suit);
    torso.position.y = 0.68;
    const head = new Mesh(headGeometry, skin);
    head.position.y = 1.5;
    const eyes = new Mesh(visorGeometry, visor);
    eyes.position.set(0, 1.53, -0.15);
    const gun = new Mesh(gunGeometry, gunMaterial);
    gun.position.set(0.22, 1.15, -0.35);
    body.add(torso, head, eyes, gun);
    body.traverse((c) => (c.castShadow = true));

    const label = nameSprite(state.name, color);
    label.position.y = 2.1;

    const shield = new Mesh(
      shieldGeometry,
      new MeshBasicMaterial({ color: "#6ee7ff", transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
    );
    shield.scale.set(0.65, 1.05, 0.65);
    shield.position.y = 0.95;
    shield.visible = false;

    root.add(body, label, shield);
    root.position.set(state.x, state.y, state.z);
    this.scene.add(root);
    this.players.set(id, { state, root, body, shield, suit, deadT: 0, wasDead: state.dead });
  }

  remove(id: string) {
    const entry = this.players.get(id);
    if (!entry) return;
    this.scene.remove(entry.root);
    entry.suit.dispose();
    (entry.shield.material as MeshBasicMaterial).dispose();
    this.players.delete(id);
  }

  clear() {
    for (const id of [...this.players.keys()]) this.remove(id);
  }

  get count(): number {
    return this.players.size;
  }

  update(dt: number, time: number) {
    for (const p of this.players.values()) {
      const { state, root, body, shield, suit } = p;
      if (p.wasDead && !state.dead) {
        root.position.set(state.x, state.y, state.z);
        p.deadT = 0;
      }
      p.wasDead = state.dead;
      root.position.x = MathUtils.damp(root.position.x, state.x, SMOOTHING, dt);
      root.position.y = MathUtils.damp(root.position.y, state.y, SMOOTHING, dt);
      root.position.z = MathUtils.damp(root.position.z, state.z, SMOOTHING, dt);
      let delta = state.yaw - body.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      body.rotation.y += delta * Math.min(1, SMOOTHING * dt);

      p.deadT = MathUtils.damp(p.deadT, state.dead ? 1 : 0, 6, dt);
      body.rotation.x = -p.deadT * 1.45;
      body.position.y = p.deadT * 0.3;

      const shimmer = state.protection > 0 ? 0.5 + 0.5 * Math.sin(time * 14) : 0;
      shield.visible = shimmer > 0;
      (shield.material as MeshBasicMaterial).opacity = 0.12 + shimmer * 0.18;
      suit.emissiveIntensity = shimmer * 0.8;
    }
  }
}

function nameSprite(name: string, color: string): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "600 48px 'Segoe UI', system-ui, sans-serif";
  const width = Math.min(500, ctx.measureText(name).width + 48);
  ctx.fillStyle = "rgba(10,14,12,0.7)";
  ctx.beginPath();
  ctx.roundRect((512 - width) / 2, 14, width, 68, 34);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect((512 - width) / 2 + 22, 42, 12, 12);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, 256 + 10, 50);
  const material = new SpriteMaterial({ map: new CanvasTexture(canvas), depthWrite: false, transparent: true });
  const sprite = new Sprite(material);
  sprite.scale.set(1.6, 0.3, 1);
  return sprite;
}
