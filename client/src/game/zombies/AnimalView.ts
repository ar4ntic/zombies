import {
  Box3,
  CapsuleGeometry,
  ConeGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Material,
  type Object3D,
  type Scene,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ZombieAnim, zombieHash, type ZombieState, type ZombieType } from "@zombies/shared";
import { loadCharacter } from "../../engine/assets.ts";
import { applyDissolve, isStandardMaterial, type DissolveUniforms } from "../fx/dissolve.ts";
import { LEGS, rigAnimal, type Leg } from "./animalRig.ts";
import { loadManifest } from "./cast.ts";
import { SnapshotTrack, type Pose } from "./SnapshotTrack.ts";
import type { ZombieBody } from "./ZombieBody.ts";

const DISSOLVE_TIME = 1.1;
/** Seconds a knocked-out animal takes to tumble onto its side. */
const FALL_TIME = 0.4;
/** How quickly the body follows the pose of its current move. */
const POSE_RATE = 16;
/** Radians the legs swing forward and back at a full run. */
const LEG_SWING = 0.75;
const KNEE_BEND = 0.7;

/** Height in meters when the manifest does not give one. */
const DEFAULT_HEIGHT: Partial<Record<ZombieType, number>> = { dog: 0.8, cat: 0.55 };

const templates = new Map<ZombieType, Promise<Object3D>>();

/**
 * The model of a four-legged zombie, standing on the ground, facing +Z and scaled to its height, with a
 * skeleton worked out from its shape. Without a generated model a simple built-in animal stands in, which
 * moves as one piece.
 */
function loadAnimal(type: ZombieType): Promise<Object3D> {
  let template = templates.get(type);
  if (!template) {
    template = loadManifest()
      .then(async (manifest) => {
        const entry = manifest.animals?.[type];
        if (!entry) throw new Error(`No model listed for ${type}`);
        const { scene } = await loadCharacter(entry.model);
        return rigAnimal(grounded(scene, entry.height, entry.yaw ?? 0));
      })
      .catch(() => standIn(type));
    templates.set(type, template);
  }
  return template;
}

function grounded(model: Object3D, height: number, yaw: number): Object3D {
  const holder = new Group();
  model.rotation.y = yaw;
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const scale = height / Math.max(size.y, 1e-3);
  model.scale.multiplyScalar(scale);
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  holder.add(model);
  return holder;
}

/** A blocky mint-green dog or cat with glowing eyes, in the look of the cartoon zombies. */
function standIn(type: ZombieType): Object3D {
  const cat = type === "cat";
  const h = DEFAULT_HEIGHT[type] ?? 0.6;
  const fur = new MeshStandardMaterial({ color: cat ? "#a9d9b0" : "#8fcf9c", roughness: 0.85 });
  const dark = new MeshStandardMaterial({ color: "#4f7f5c", roughness: 0.9 });
  const eyes = new MeshStandardMaterial({ color: "#111", emissive: "#f6ff7a", emissiveIntensity: 2.5 });
  const group = new Group();
  const add = (mesh: Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const length = h * (cat ? 1.25 : 1.2);
  const girth = h * (cat ? 0.34 : 0.4);
  add(new Mesh(new RoundedBoxGeometry(girth, girth, length, 3, girth * 0.3), fur), 0, h * 0.58, 0);
  const head = h * (cat ? 0.36 : 0.38);
  add(new Mesh(new RoundedBoxGeometry(head, head * 0.9, head, 3, head * 0.25), fur), 0, h * 0.82, length * 0.55);
  if (!cat) add(new Mesh(new RoundedBoxGeometry(head * 0.5, head * 0.4, head * 0.55, 2, head * 0.1), dark), 0, h * 0.74, length * 0.55 + head * 0.6);
  for (const side of [-1, 1]) {
    const ear = add(new Mesh(new ConeGeometry(head * 0.2, head * (cat ? 0.5 : 0.4), 4), dark), side * head * 0.3, h * 0.82 + head * 0.6, length * 0.52);
    ear.rotation.z = -side * (cat ? 0.1 : 0.5);
    add(new Mesh(new SphereGeometry(head * 0.09, 10, 8), eyes), side * head * 0.24, h * 0.86, length * 0.55 + head * 0.5);
    for (const end of [-1, 1]) {
      add(new Mesh(new CapsuleGeometry(girth * 0.16, h * 0.3, 3, 8), dark), side * girth * 0.32, h * 0.22, end * length * 0.36);
    }
  }
  const tail = add(new Mesh(new CapsuleGeometry(girth * 0.1, h * (cat ? 0.6 : 0.3), 3, 8), dark), 0, h * (cat ? 0.95 : 0.8), -length * 0.52);
  tail.rotation.x = cat ? -0.25 : -0.8;
  return group;
}

interface LegBones {
  upper?: Object3D;
  lower?: Object3D;
}

/** A zombie dog or cat. The game itself makes it gallop, snap and tumble, as these models come without animations. */
export class AnimalView implements ZombieBody {
  readonly root = new Group();
  readonly position = new Vector3();
  readonly scale = 1;
  readonly leaning = false;
  readonly level = 0;
  dying = false;
  dead = false;
  dissolve = 0;

  private readonly body: Object3D;
  private readonly height: number;
  private readonly head?: Object3D;
  private readonly tail?: Object3D;
  private readonly legs: Record<Leg, LegBones>;
  private readonly track = new SnapshotTrack();
  private readonly pose: Pose = { x: 0, z: 0, rot: 0 };
  private readonly lastPos = new Vector3();
  private readonly knock = new Vector3();
  private readonly uniforms: DissolveUniforms[] = [];
  private readonly side: number;
  private phase: number;
  private speed = 0;
  private flash = 0;
  private fall = 0;

  private constructor(
    private readonly scene: Scene,
    id: string,
    readonly type: ZombieType,
    template: Object3D,
    private readonly state: ZombieState,
  ) {
    this.body = cloneSkinned(template);
    this.height = new Box3().setFromObject(this.body).max.y;
    this.head = this.body.getObjectByName("head");
    this.tail = this.body.getObjectByName("tail");
    this.legs = Object.fromEntries(
      LEGS.map((leg) => [leg, { upper: this.body.getObjectByName(`leg${leg}`), lower: this.body.getObjectByName(`shin${leg}`) }]),
    ) as Record<Leg, LegBones>;
    this.side = zombieHash(id, 3) < 0.5 ? -1 : 1;
    this.phase = zombieHash(id, 5) * Math.PI * 2;
    const materials = new Map<Material, Material>();
    this.body.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const source = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
      let material = materials.get(source);
      if (!material) {
        material = source.clone();
        if (isStandardMaterial(material)) this.uniforms.push(applyDissolve(material));
        materials.set(source, material);
      }
      mesh.material = material;
    });
    this.root.add(this.body);
    this.position.set(state.x, 0, state.z);
    this.lastPos.copy(this.position);
    this.pose.rot = state.rot;
    this.pushSnapshot();
    this.syncTransform();
    scene.add(this.root);
  }

  static async create(scene: Scene, id: string, state: ZombieState): Promise<AnimalView> {
    const type = state.type as ZombieType;
    return new AnimalView(scene, id, type, await loadAnimal(type), state);
  }

  get facing(): number {
    return this.root.rotation.y;
  }

  get castsShadow(): boolean {
    return this.root.userData.shadows !== false && this.dissolve === 0;
  }

  pushSnapshot() {
    this.track.push(this.state);
  }

  hit(from: Vector3, head: boolean) {
    if (this.dying) return;
    this.flash = head ? 1.6 : 1;
    this.knock.subVectors(this.position, from).setY(0).normalize().multiplyScalar(head ? 0.25 : 0.15);
  }

  die() {
    if (this.dying) return;
    this.dying = true;
    this.flash = 1.4;
  }

  update(dt: number) {
    const h = this.height;
    let y = 0;
    let z = 0;
    let pitch = 0;
    let roll = 0;
    let spin = 0;
    // Bone angles of this frame: how far the leg pairs reach (forward is positive), how far they fold, and the head and tail.
    let frontReach = 0;
    let hindReach = 0;
    let fold = 0;
    let nod = 0;
    let wag = Math.sin(this.phase * 1.3) * 0.35;
    if (this.dying) {
      // Hops, rolls onto its side, then dissolves like the other zombies.
      this.fall = Math.min(1, this.fall + dt / FALL_TIME);
      y = Math.sin(Math.PI * this.fall) * h * 0.4 + this.fall * h * 0.18;
      roll = this.fall * (Math.PI / 2) * this.side;
      frontReach = 0.5 * this.fall;
      hindReach = -0.5 * this.fall;
      nod = -0.4 * this.fall;
      wag = 0;
      if (this.fall >= 1) {
        if (this.dissolve === 0) this.root.traverse((c) => (c.castShadow = false));
        this.dissolve = Math.min(1, this.dissolve + dt / DISSOLVE_TIME);
        if (this.dissolve >= 1) this.dead = true;
      }
    } else {
      this.track.sample(this.state, this.pose);
      const frameSpeed = Math.hypot(this.pose.x - this.lastPos.x, this.pose.z - this.lastPos.z) / Math.max(1e-3, dt);
      this.speed = MathUtils.damp(this.speed, frameSpeed, 8, dt);
      this.lastPos.set(this.pose.x, 0, this.pose.z);
      this.position.set(this.pose.x, 0, this.pose.z);

      switch (this.state.anim) {
        case ZombieAnim.Attack: {
          // Rears up and snaps forward.
          this.phase += dt * 9;
          const lunge = Math.max(0, Math.sin(this.phase));
          y = lunge * h * 0.28;
          z = lunge * 0.35;
          pitch = -lunge * 0.55;
          frontReach = lunge * 1.1;
          hindReach = -lunge * 0.4;
          nod = lunge * 0.9 - 0.35;
          break;
        }
        case ZombieAnim.Scream:
          // Jumps up at a player it cannot reach.
          this.phase += dt * 7;
          y = Math.abs(Math.sin(this.phase)) * h * 0.45;
          pitch = -0.4;
          frontReach = 0.5 + Math.abs(Math.sin(this.phase)) * 0.5;
          hindReach = -Math.abs(Math.sin(this.phase)) * 0.6;
          nod = -0.5;
          wag = Math.sin(this.phase * 2) * 0.6;
          break;
        case ZombieAnim.Dance:
          this.phase += dt * 6;
          y = Math.abs(Math.sin(this.phase)) * h * 0.3;
          spin = this.phase * 0.8;
          frontReach = Math.sin(this.phase * 2) * 0.5;
          hindReach = -frontReach;
          wag = Math.sin(this.phase * 3) * 0.8;
          break;
        default: {
          // Gallops: one leap per stride. In the air the front legs reach forward and the hind legs back;
          // on landing all four gather under the body.
          const run = Math.min(1, this.speed / 2.5);
          this.phase += dt * (2 + this.speed * 1.5);
          const stretch = -Math.cos(this.phase * 2);
          y = Math.abs(Math.sin(this.phase)) * h * 0.18 * run;
          pitch = Math.sin(this.phase * 2) * 0.14 * run;
          roll = Math.sin(this.phase) * 0.04 * run;
          frontReach = stretch * LEG_SWING * run;
          hindReach = -stretch * LEG_SWING * run;
          fold = Math.max(0, -stretch) * KNEE_BEND * run;
          nod = -pitch * 0.8 + Math.sin(this.phase * 2 + 0.6) * 0.12 * run;
          wag = Math.sin(this.phase * 1.3) * 0.35 * (1 - run) + 0.25 * run;
        }
      }
    }

    const blend = this.dying ? 1 : Math.min(1, POSE_RATE * dt);
    const { position, rotation } = this.body;
    position.y += (y - position.y) * blend;
    position.z += (z - position.z) * blend;
    rotation.x += (pitch - rotation.x) * blend;
    rotation.z += (roll - rotation.z) * blend;
    rotation.y = spin;

    // A positive turn about X swings what hangs below a joint backwards, so reaching forward is negative.
    for (const leg of LEGS) {
      const front = leg.startsWith("F");
      const { upper, lower } = this.legs[leg];
      if (upper) upper.rotation.x += (-(front ? frontReach : hindReach) - upper.rotation.x) * blend;
      if (lower) lower.rotation.x += ((front ? fold : -fold * 0.7) - lower.rotation.x) * blend;
    }
    if (this.head) this.head.rotation.x += (nod - this.head.rotation.x) * blend;
    if (this.tail) {
      this.tail.rotation.y += (wag - this.tail.rotation.y) * blend;
      this.tail.rotation.x = -0.15 * Math.min(1, this.speed / 2.5);
    }

    this.flash = Math.max(0, this.flash - dt * 6);
    this.knock.multiplyScalar(Math.max(0, 1 - dt * 10));
    for (const u of this.uniforms) {
      u.uDissolve.value = this.dissolve > 0 ? Math.max(0.001, this.dissolve) : 0;
      u.uFlash.value = this.flash;
      u.uOrigin.value.set(this.position.x, 0, this.position.z);
    }
    this.syncTransform();
  }

  setLevel() {}

  setShadows(enabled: boolean) {
    if (this.dissolve > 0) enabled = false;
    if (this.root.userData.shadows === enabled) return;
    this.root.userData.shadows = enabled;
    this.root.traverse((c) => (c.castShadow = enabled));
  }

  private syncTransform() {
    this.root.position.set(this.position.x + this.knock.x, -0.1 * this.dissolve, this.position.z + this.knock.z);
    this.root.rotation.y = this.pose.rot;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) (mesh.material as Material).dispose();
    });
  }
}
