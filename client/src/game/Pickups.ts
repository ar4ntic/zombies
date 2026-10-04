import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  type Scene,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { PickupKind, PickupState } from "@zombies/shared";

const HOVER_HEIGHT = 0.55;
const SPIN_SPEED = 1.6;
const APPEAR_SPEED = 4;
const ENERGY_COLOR = "#ffa33d";
const HEALTH_COLOR = "#5dff7a";

const metal = new MeshStandardMaterial({ color: "#c7cbd2", metalness: 1, roughness: 0.25 });
const shell = new MeshStandardMaterial({ color: "#f3f5f7", roughness: 0.45 });
const energyGlow = new MeshStandardMaterial({ color: "#111", emissive: ENERGY_COLOR, emissiveIntensity: 1.6, roughness: 0.4 });
const healthGlow = new MeshStandardMaterial({ color: "#111", emissive: HEALTH_COLOR, emissiveIntensity: 2.5, roughness: 0.4 });
const capsuleGeometry = new CylinderGeometry(0.1, 0.1, 0.34, 20);
const capGeometry = new CylinderGeometry(0.115, 0.115, 0.06, 20);
const packGeometry = new RoundedBoxGeometry(0.42, 0.3, 0.18, 3, 0.04);
const crossBar = new BoxGeometry(0.2, 0.06, 0.02);
const ringGeometry = new RingGeometry(0.34, 0.42, 40).rotateX(-Math.PI / 2);

function ring(color: string): Mesh {
  const mesh = new Mesh(ringGeometry, new MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false }));
  mesh.position.y = 0.03;
  return mesh;
}

function energyCapsule(): Group {
  const body = new Group();
  body.add(new Mesh(capsuleGeometry, energyGlow));
  for (const y of [-0.19, 0.19]) {
    const cap = new Mesh(capGeometry, metal);
    cap.position.y = y;
    body.add(cap);
  }
  body.rotation.z = 0.5;
  return body;
}

function healthPack(): Group {
  const body = new Group();
  body.add(new Mesh(packGeometry, shell));
  for (const z of [-0.095, 0.095]) {
    for (const turn of [0, Math.PI / 2]) {
      const bar = new Mesh(crossBar, healthGlow);
      bar.position.z = z;
      bar.rotation.z = turn;
      body.add(bar);
    }
  }
  return body;
}

interface Pickup {
  state: PickupState;
  root: Group;
  body: Group;
  ring: Mesh;
  appear: number;
}

/** Energy capsules and health packs lying in the arena, as the server placed them. */
export class Pickups {
  private readonly items = new Map<string, Pickup>();

  constructor(private readonly scene: Scene) {}

  add(id: string, state: PickupState) {
    const health = (state.kind as PickupKind) === "health";
    const root = new Group();
    const body = health ? healthPack() : energyCapsule();
    const glow = ring(health ? HEALTH_COLOR : ENERGY_COLOR);
    root.add(body, glow);
    root.position.set(state.x, 0, state.z);
    this.scene.add(root);
    this.items.set(id, { state, root, body, ring: glow, appear: 0 });
  }

  remove(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    this.scene.remove(item.root);
    (item.ring.material as MeshBasicMaterial).dispose();
    this.items.delete(id);
  }

  clear() {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  /** Energy capsules within `radius` of a point on the ground. */
  energyNear(x: number, z: number, radius: number): string[] {
    const ids: string[] = [];
    for (const [id, { state }] of this.items) {
      if (state.kind === "energy" && Math.hypot(state.x - x, state.z - z) <= radius) ids.push(id);
    }
    return ids;
  }

  update(dt: number, time: number) {
    for (const item of this.items.values()) {
      item.appear = Math.min(1, item.appear + dt * APPEAR_SPEED);
      const phase = time * 2 + item.state.x;
      item.body.position.y = HOVER_HEIGHT + Math.sin(phase) * 0.07;
      item.body.rotation.y = time * SPIN_SPEED + item.state.z;
      item.body.scale.setScalar(item.appear);
      item.ring.scale.setScalar(item.appear * (1 + Math.sin(phase) * 0.06));
    }
  }
}
