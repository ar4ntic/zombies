import {
  Color,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Bone,
  type Object3D,
  type SkinnedMesh,
  type Texture,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { SkinDef } from "@zombies/shared";
import { loadModel } from "../../engine/assets.ts";

export type Side = "L" | "R";

/** How one hand holds a weapon, in the weapon's own space. */
export interface GripPose {
  /** The middle of what the hand closes around. */
  at: Vector3;
  /** Direction from the palm into the held object. */
  palm: Vector3;
  /** Direction across the knuckles, from the index finger to the little finger. */
  knuckles: Vector3;
  /** How far the three joints of a finger can bend, in radians. Each closes until the finger lies against the weapon. */
  curl: [number, number, number];
  /** The thumb, in radians: how far it swings over the palm, and how far its outer joints can close towards the fingers. */
  thumb: [number, number];
  /** Direction in which the forearm runs towards the wrist, where the wrist is bent; otherwise it continues the hand. */
  forearm?: Vector3;
}

/** A box-shaped part of a weapon: its bounds, and the way from the weapon's space into the space they are given in. */
export interface Solid {
  min: Vector3;
  max: Vector3;
  inverse: Matrix4;
}

const FINGERS = ["index", "middle", "ring", "pinky"];
/** How far a finger sinks into what it holds, as soft skin does, in meters. */
const SQUEEZE = 0.002;
/** Skin this close to a joint folds when the joint bends and is not what stops the finger, in meters. */
const CREASE = 0.012;
/** Step in which a closing joint looks for the weapon, in radians. */
const CLOSE_STEP = 0.08;
/** How far a joint is opened beyond its rest pose, in which the fingers are already a little bent, before it closes. */
const OPENED = 0.35;
/** Distance from the wrist to the middle of the palm along the fingers, and how deep the held object sits in the palm. */
const PALM_REACH = 0.088;
const PALM_DEPTH = 0.022;
/** How far up the forearm a glove or bare hand reaches before the sleeve begins, in meters. */
const CUFF_ABOVE_WRIST = 0.035;
/** Width of the darker hem that finishes a sleeve or a glove there, in meters. */
const HEM_WIDTH = 0.012;

const CLOTHING_PARS = /* glsl */ `
varying float vCut;
uniform vec3 handColor;
uniform vec3 sleeveColor;
uniform float handCovered;
uniform float sleeveCovered;
`;
/** Paints gloves and sleeves over the skin. Where a sleeve ends it carries the hem, on a bare arm the glove does. */
const CLOTHING = /* glsl */ `
float cutEdge = fwidth(vCut) + 0.00001;
float onHand = smoothstep(-cutEdge, cutEdge, vCut);
float hemSide = sleeveCovered > 0.5 ? 1.0 - onHand : onHand;
float hem = hemSide * (1.0 - step(${HEM_WIDTH}, abs(vCut)));
vec3 cloth = mix(sleeveColor, handColor, onHand) * (1.0 - 0.25 * hem);
diffuseColor.rgb = mix(diffuseColor.rgb, cloth, mix(sleeveCovered, handCovered, onHand));
`;

interface ArmBones {
  /** The two chains that make up an arm: shoulder to forearm, and the hand. Each is moved as a rigid piece. */
  roots: Bone[];
  rootBind: Matrix4[];
  /** Bind pose of the hand: wrist position and the directions of fingers, knuckles and palm. */
  bind: Matrix4;
  knuckles: Vector3;
  wrist: Vector3;
  /** Direction of the forearm towards the wrist in the bind pose. */
  forearm: Vector3;
  fingers: Bone[][];
  /** How far each finger points away from the hand's own direction in the rest pose, towards the little finger. */
  splay: number[];
  thumb: Bone[];
  rest: Map<Bone, Quaternion>;
}

/** Joints that close one after the other about an axis, as far as `limit` allows. */
interface Closing {
  joints: Bone[];
  axis: Vector3;
  limit: number[];
  /** Turn of the first joint that brings a finger in line with the others before it bends. */
  gather?: Quaternion;
}

let template: Promise<{ scene: Object3D; skin: Texture; skinned: number[][] }> | undefined;

function load() {
  template ??= Promise.all([loadModel("fps_arms"), new TextureLoader().loadAsync("/assets/models/fps_arms_skin.webp")]).then(([gltf, skin]) => {
    skin.colorSpace = SRGBColorSpace;
    let skinned: number[][] = [];
    gltf.scene.traverse((child) => {
      const mesh = child as SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      markHands(gltf.scene, mesh);
      skinned = verticesByBone(mesh);
    });
    return { scene: gltf.scene, skin, skinned };
  });
  return template;
}

/**
 * Stores for every vertex how far it lies on the hand's side of the line where a sleeve or a glove ends, a little
 * above the wrist. The material draws that line per pixel, so it runs straight across the triangles.
 */
function markHands(scene: Object3D, mesh: SkinnedMesh) {
  scene.updateMatrixWorld(true);
  mesh.skeleton.update();
  const at = (name: string) => scene.getObjectByName(name)!.getWorldPosition(new Vector3());
  const [left, right] = (["L", "R"] as const).map((side) => {
    const wrist = at(`hand${side}`);
    return { wrist, towardsHand: wrist.clone().sub(at(`forearm${side}`)).normalize() };
  }) as [{ wrist: Vector3; towardsHand: Vector3 }, { wrist: Vector3; towardsHand: Vector3 }];
  const count = mesh.geometry.getAttribute("position").count;
  const cut = new Float32Array(count);
  const vertex = new Vector3();
  for (let i = 0; i < count; i++) {
    // The stored positions are quantized and only make sense through the bones, so the skinned position is used.
    mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
    // Each vertex belongs to the arm whose wrist is nearer.
    const arm = vertex.distanceToSquared(left.wrist) < vertex.distanceToSquared(right.wrist) ? left : right;
    cut[i] = vertex.sub(arm.wrist).dot(arm.towardsHand) + CUFF_ABOVE_WRIST;
  }
  mesh.geometry.setAttribute("cut", new Float32BufferAttribute(cut, 1));
}

/** For every bone of the skeleton, the vertices that follow it more than any other bone. */
function verticesByBone(mesh: SkinnedMesh): number[][] {
  const bones = mesh.geometry.getAttribute("skinIndex");
  const weights = mesh.geometry.getAttribute("skinWeight");
  const byBone: number[][] = mesh.skeleton.bones.map(() => []);
  for (let i = 0; i < bones.count; i++) {
    let strongest = 0;
    for (let slot = 1; slot < 4; slot++) if (weights.getComponent(i, slot) > weights.getComponent(i, strongest)) strongest = slot;
    byBone[bones.getComponent(i, strongest)]?.push(i);
  }
  return byBone;
}

/** Right-handed set of the directions of fingers, knuckles and palm; a left hand is its mirror image. */
function handBasis(side: Side, palm: Vector3, knuckles: Vector3, at: Vector3): Matrix4 {
  const k = knuckles.clone().addScaledVector(palm, -knuckles.dot(palm)).normalize();
  const fingers = side === "R" ? k.clone().cross(palm) : palm.clone().cross(k);
  return new Matrix4().makeBasis(fingers, k, palm).setPosition(at);
}

/** A pair of first-person arms whose hands close around a weapon. */
export class Arms {
  readonly object: Object3D;
  private readonly clothing = {
    handColor: { value: new Color() },
    sleeveColor: { value: new Color() },
    handCovered: { value: 0 },
    sleeveCovered: { value: 0 },
  };
  private readonly mesh: SkinnedMesh;
  private readonly body: Matrix4;
  private readonly bodyInverse: Matrix4;
  private readonly bones: Record<Side, ArmBones>;
  /** How far the fingers, and after them the thumb, closed around each grip the hands have taken. */
  private readonly closed = new WeakMap<GripPose, number[][]>();
  private readonly vertex = new Vector3();
  private readonly inSolid = new Vector3();

  private constructor(
    scene: Object3D,
    skin: Texture,
    private readonly skinned: number[][],
    private readonly solids: Solid[],
  ) {
    this.object = cloneSkinned(scene);
    const material = new MeshStandardMaterial({ map: skin, roughness: 0.75 });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.clothing);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float cut;\nvarying float vCut;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCut = cut;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>${CLOTHING_PARS}`)
        .replace("#include <map_fragment>", `#include <map_fragment>${CLOTHING}`);
    };
    let mesh!: SkinnedMesh;
    this.object.traverse((child) => {
      if ((child as SkinnedMesh).isSkinnedMesh) mesh = child as SkinnedMesh;
    });
    mesh.material = material;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.mesh = mesh;

    this.object.updateMatrixWorld(true);
    this.body = mesh.matrixWorld.clone();
    this.bodyInverse = this.body.clone().invert();
    this.bones = { L: this.findBones("L"), R: this.findBones("R") };
  }

  /** Arms for a weapon made of the given parts. */
  static async create(solids: Solid[]): Promise<Arms> {
    const { scene, skin, skinned } = await load();
    return new Arms(scene, skin, skinned, solids);
  }

  private findBones(side: Side): ArmBones {
    const bone = (name: string) => this.object.getObjectByName(name) as Bone;
    const position = (name: string) => bone(name).getWorldPosition(new Vector3());
    const wrist = position(`hand${side}`);
    const knuckles = position(`f_pinky01${side}`).sub(position(`f_index01${side}`)).normalize();
    const fingers = position(`f_middle01${side}`).sub(wrist).normalize();
    // The palm faces the way that makes fingers, knuckles and palm a right-handed set on a right hand.
    const palm = side === "R" ? fingers.clone().cross(knuckles).normalize() : knuckles.clone().cross(fingers).normalize();
    const roots = [bone(`clavicle${side}`), bone(`hand${side}control`)];
    const chains = [...FINGERS.map((finger) => [1, 2, 3].map((n) => bone(`f_${finger}0${n}${side}`))), [1, 2, 3].map((n) => bone(`thumb0${n}${side}`))];
    const rest = new Map<Bone, Quaternion>();
    for (const joint of chains.flat()) rest.set(joint, joint.quaternion.clone());
    const bind = handBasis(side, palm, knuckles, wrist);
    const along = new Vector3().setFromMatrixColumn(bind, 0);
    const across = new Vector3().setFromMatrixColumn(bind, 1);
    const digits = chains.slice(0, FINGERS.length);
    return {
      roots,
      rootBind: roots.map((root) => root.matrix.clone()),
      bind,
      knuckles: across,
      wrist,
      forearm: wrist.clone().sub(position(`forearm${side}`)).normalize(),
      fingers: digits,
      splay: digits.map((chain) => {
        const first = position(chain[1]!.name).sub(position(chain[0]!.name));
        return Math.atan2(first.dot(across), first.dot(along));
      }),
      thumb: chains[FINGERS.length]!,
      rest,
    };
  }

  /** Bare parts show the skin; sleeves and gloves take the color of the player's skin. */
  setSkin(skin: SkinDef) {
    this.clothing.handCovered.value = skin.hand === null ? 0 : 1;
    this.clothing.sleeveCovered.value = skin.forearm === null ? 0 : 1;
    if (skin.hand !== null) this.clothing.handColor.value.set(skin.hand);
    if (skin.forearm !== null) this.clothing.sleeveColor.value.set(skin.forearm);
  }

  /** Takes an arm that holds nothing out of the picture. */
  hide(side: Side) {
    for (const root of this.bones[side].roots) root.scale.setScalar(0);
  }

  /** Closes one hand around a part of the weapon; its arm follows, running out of view. `offset` takes the hand off it. */
  pose(side: Side, grip: GripPose, offset?: Vector3) {
    const arm = this.bones[side];
    const target = handBasis(side, grip.palm.clone().normalize(), grip.knuckles, new Vector3());
    const fingers = new Vector3().setFromMatrixColumn(target, 0);
    const palm = new Vector3().setFromMatrixColumn(target, 2);
    const wrist = grip.at.clone().addScaledVector(fingers, -PALM_REACH).addScaledVector(palm, -PALM_DEPTH);
    const turn = new Quaternion().setFromRotationMatrix(target.clone().multiply(arm.bind.clone().invert()));

    // Fingers come side by side, turning about the palm's direction, and bend about the line of the knuckles, towards
    // the palm. The thumb swings over the palm about the direction of the fingers, and its outer joints then bend
    // like a finger's, towards them.
    const mirror = side === "R" ? 1 : -1;
    const axis = arm.knuckles.clone().applyQuaternion(turn).multiplyScalar(-mirror);
    const [over, flex] = grip.thumb;
    const closing: Closing[] = [
      ...arm.fingers.map((joints, n) => ({ joints, axis, limit: grip.curl, gather: new Quaternion().setFromAxisAngle(palm, -arm.splay[n]! * mirror) })),
      { joints: arm.thumb.slice(1), axis: axis.clone().negate(), limit: [flex, flex * 0.6] },
    ];
    const swing = () => this.bend(arm, arm.thumb[0]!, fingers.clone().multiplyScalar(-mirror), over);

    // How far everything closes is found once, with the hand where it grips.
    let closed = this.closed.get(grip);
    if (!closed) {
      this.place(arm, grip, target, wrist);
      swing();
      closed = closing.map((chain) => this.close(arm, chain));
      this.closed.set(grip, closed);
    }
    this.place(arm, grip, target, offset ? wrist.add(offset) : wrist);
    swing();
    closing.forEach((chain, n) => chain.joints.forEach((joint, i) => this.bend(arm, joint, chain.axis, closed[n]![i]!, i === 0 ? chain.gather : undefined)));
  }

  /** Moves an arm so that its hand has the given directions and its wrist is at the given place. */
  private place(arm: ArmBones, grip: GripPose, directions: Matrix4, wrist: Vector3) {
    // The same move takes the arm and the hand, which are separate bone chains, from the bind pose to the grip.
    const move = directions.clone().setPosition(wrist).multiply(arm.bind.clone().invert());
    const moves = [move, move];
    if (grip.forearm) {
      // A bent wrist: before the move, the arm is turned about the wrist to where the forearm has to come from.
      const turn = new Quaternion().setFromRotationMatrix(move);
      const from = grip.forearm.clone().normalize().applyQuaternion(turn.invert());
      const bent = new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(arm.forearm, from));
      const aboutWrist = new Matrix4().makeTranslation(arm.wrist).multiply(bent).multiply(new Matrix4().makeTranslation(arm.wrist.clone().negate()));
      moves[0] = move.clone().multiply(aboutWrist);
    }
    arm.roots.forEach((root, i) => {
      root.matrix.copy(this.bodyInverse).multiply(moves[i]!).multiply(this.body).multiply(arm.rootBind[i]!);
      root.matrix.decompose(root.position, root.quaternion, root.scale);
      root.updateMatrixWorld(true);
    });
  }

  /** Bends the joints of a finger one after the other, each until what lies beyond it touches the weapon or it cannot bend further. */
  private close(arm: ArmBones, { joints, axis, limit, gather }: Closing): number[] {
    const set = (i: number, angle: number) => this.bend(arm, joints[i]!, axis, angle, i === 0 ? gather : undefined);
    joints.forEach((_, i) => set(i, -OPENED));
    return joints.map((_, i) => {
      const touches = (angle: number) => {
        set(i, angle);
        return this.touching(joints, i);
      };
      const most = limit[i]!;
      let free = -OPENED;
      let blocked = -OPENED;
      while (!touches(blocked) && blocked < most) {
        free = blocked;
        blocked = Math.min(most, blocked + CLOSE_STEP);
      }
      if (!this.touching(joints, i)) return most;
      for (let n = 0; n < 5; n++) {
        const between = (free + blocked) / 2;
        if (touches(between)) blocked = between;
        else free = between;
      }
      set(i, free);
      return free;
    });
  }

  /** Whether the part of a finger beyond one of its joints reaches into the weapon. */
  private touching(chain: Bone[], from: number): boolean {
    const pivot = this.object.worldToLocal(chain[from]!.getWorldPosition(new Vector3()));
    for (let i = from; i < chain.length; i++) {
      for (const index of this.skinned[this.mesh.skeleton.bones.indexOf(chain[i]!)] ?? []) {
        const vertex = this.mesh.getVertexPosition(index, this.vertex).applyMatrix4(this.body);
        if (i === from && vertex.distanceToSquared(pivot) < CREASE * CREASE) continue;
        for (const solid of this.solids) {
          const p = this.inSolid.copy(vertex).applyMatrix4(solid.inverse);
          const inside =
            p.x > solid.min.x + SQUEEZE && p.x < solid.max.x - SQUEEZE &&
            p.y > solid.min.y + SQUEEZE && p.y < solid.max.y - SQUEEZE &&
            p.z > solid.min.z + SQUEEZE && p.z < solid.max.z - SQUEEZE;
          if (inside) return true;
        }
      }
    }
    return false;
  }

  /** Turns a joint from its rest pose by `angle` about an axis given in the weapon's space, after an optional first turn. */
  private bend(arm: ArmBones, joint: Bone, axis: Vector3, angle: number, first?: Quaternion) {
    // The arms move with the weapon and the camera, so the joint's parent is taken relative to the arms themselves.
    const parent = this.object.getWorldQuaternion(new Quaternion()).invert().multiply(joint.parent!.getWorldQuaternion(new Quaternion()));
    const delta = new Quaternion().setFromAxisAngle(axis, angle);
    if (first) delta.multiply(first);
    joint.quaternion.copy(parent.clone().invert().multiply(delta).multiply(parent).multiply(arm.rest.get(joint)!));
    joint.updateMatrixWorld(true);
  }
}
