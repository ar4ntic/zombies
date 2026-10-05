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
  type Vector3,
} from "three";
import { PLAYER_RADIUS, skinDef, type PlayerState, type WeaponId } from "@zombies/shared";
import { PlayerView } from "./players/PlayerView.ts";
import { loadSkin } from "./players/skins.ts";
import { rayCylinder } from "./rays.ts";

const SMOOTHING = 14;
/** Height of the cylinder a shot hits a player in. */
const BODY_HEIGHT = 1.8;

interface Remote {
  state: PlayerState;
  root: Group;
  body: Group;
  /** Stand-in shown until the skin has loaded, or instead of it when it cannot be loaded. */
  placeholder: Group;
  placeholderSuit: MeshStandardMaterial;
  view?: PlayerView;
  skin: string;
  label: Sprite;
  shield: Mesh;
  deadT: number;
  wasDead: boolean;
  speed: number;
}

const bodyGeometry = new CapsuleGeometry(0.3, 0.75, 6, 16);
const headGeometry = new SphereGeometry(0.2, 24, 16);
const shieldGeometry = new SphereGeometry(1, 32, 16);
const skinTone = new MeshStandardMaterial({ color: "#e8b996", roughness: 0.6 });

export class RemotePlayers {
  private readonly players = new Map<string, Remote>();
  /** Set once the round is over, when everybody celebrates. */
  cheering = false;

  constructor(private readonly scene: Scene) {}

  add(id: string, state: PlayerState) {
    const root = new Group();
    const body = new Group();
    const placeholder = new Group();
    const placeholderSuit = new MeshStandardMaterial({ color: skinDef(state.skin).sleeve, roughness: 0.55, metalness: 0.05 });
    const torso = new Mesh(bodyGeometry, placeholderSuit);
    torso.position.y = 0.68;
    const head = new Mesh(headGeometry, skinTone);
    head.position.y = 1.5;
    placeholder.add(torso, head);
    placeholder.traverse((c) => (c.castShadow = true));
    body.add(placeholder);

    const label = nameSprite(state.name, skinDef(state.skin).sleeve);
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
    const remote: Remote = { state, root, body, placeholder, placeholderSuit, skin: "", label, shield, deadT: 0, wasDead: state.dead, speed: 0 };
    this.players.set(id, remote);
    this.applySkin(id, remote);
  }

  /** Swaps in the player's skin once it has loaded; the stand-in stays if it cannot be loaded. */
  private applySkin(id: string, remote: Remote) {
    const skin = remote.state.skin;
    remote.skin = skin;
    remote.placeholderSuit.color.set(skinDef(skin).sleeve);
    loadSkin(skin).then(
      (template) => {
        if (this.players.get(id) !== remote || remote.skin !== skin) return;
        this.dropView(remote);
        remote.view = new PlayerView(template);
        remote.body.add(remote.view.root);
        remote.placeholder.visible = false;
      },
      (err) => console.warn(`Player skin ${skin} unavailable`, err),
    );
  }

  private dropView(remote: Remote) {
    if (!remote.view) return;
    remote.body.remove(remote.view.root);
    remote.view.dispose();
    remote.view = undefined;
    remote.placeholder.visible = true;
  }

  /** A remote player fired; their skin raises the weapon. */
  shot(id: string) {
    this.players.get(id)?.view?.shot();
  }

  /** The nearest standing player a ray hits, for friendly fire. */
  raycast(origin: Vector3, dir: Vector3, maxDistance: number): { id: string; distance: number } | null {
    let best: { id: string; distance: number } | null = null;
    for (const [id, { state, root }] of this.players) {
      if (state.dead) continue;
      const t = rayCylinder(origin, dir, root.position.x, root.position.z, PLAYER_RADIUS, BODY_HEIGHT, root.position.y);
      if (t >= 0 && t <= maxDistance && (!best || t < best.distance)) best = { id, distance: t };
    }
    return best;
  }

  remove(id: string) {
    const entry = this.players.get(id);
    if (!entry) return;
    this.dropView(entry);
    this.scene.remove(entry.root);
    entry.placeholderSuit.dispose();
    (entry.shield.material as MeshBasicMaterial).dispose();
    entry.label.material.map?.dispose();
    entry.label.material.dispose();
    this.players.delete(id);
  }

  clear() {
    for (const id of [...this.players.keys()]) this.remove(id);
    this.cheering = false;
  }

  get count(): number {
    return this.players.size;
  }

  update(dt: number, time: number) {
    for (const [id, p] of this.players) {
      const { state, root, body, shield } = p;
      if (state.skin !== p.skin) this.applySkin(id, p);
      if (p.wasDead && !state.dead) {
        root.position.set(state.x, state.y, state.z);
        p.deadT = 0;
      }
      p.wasDead = state.dead;
      const fromX = root.position.x;
      const fromZ = root.position.z;
      root.position.x = MathUtils.damp(root.position.x, state.x, SMOOTHING, dt);
      root.position.y = MathUtils.damp(root.position.y, state.y, SMOOTHING, dt);
      root.position.z = MathUtils.damp(root.position.z, state.z, SMOOTHING, dt);
      if (dt > 0) p.speed = MathUtils.damp(p.speed, Math.hypot(root.position.x - fromX, root.position.z - fromZ) / dt, 10, dt);
      let delta = state.yaw - body.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      body.rotation.y += delta * Math.min(1, SMOOTHING * dt);

      p.deadT = MathUtils.damp(p.deadT, state.dead ? 1 : 0, 6, dt);
      if (p.view) {
        p.view.update(dt, { speed: p.speed, pitch: state.pitch, dead: state.dead, weapon: state.weapon as WeaponId, cheering: this.cheering });
      } else {
        p.placeholder.rotation.x = -p.deadT * 1.45;
        p.placeholder.position.y = p.deadT * 0.3;
      }
      p.label.position.y = MathUtils.lerp(2.1, 0.9, p.deadT);

      const shimmer = state.protection > 0 ? 0.5 + 0.5 * Math.sin(time * 14) : 0;
      shield.visible = shimmer > 0;
      (shield.material as MeshBasicMaterial).opacity = 0.12 + shimmer * 0.18;
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
