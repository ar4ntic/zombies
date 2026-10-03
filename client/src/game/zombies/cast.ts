import {
  AdditiveAnimationBlendMode,
  AnimationMixer,
  AnimationUtils,
  Sphere,
  Vector3,
  type AnimationClip,
  type Group,
  type Object3D,
  type SkinnedMesh,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ZombieType } from "@zombies/shared";
import { loadCharacter } from "../../engine/assets.ts";

export type ClipKey = "walk" | "walk2" | "run" | "attack" | "hit" | "hitHead" | "death" | "death2" | "scream" | "dance";
export type LocomotionKey = "walk" | "walk2" | "run";
export type DeathKey = "death" | "death2";

interface Manifest {
  clips: Record<ClipKey, string>;
  characters: Record<ZombieType, string[]>;
}

export interface CharacterTemplate {
  name: string;
  scene: Group;
  clips: Record<ClipKey, AnimationClip>;
  /** Ground speed in m/s at which each locomotion clip plays without foot sliding. */
  groundSpeed: Record<LocomotionKey, number>;
  /** Seconds into each death clip at which the body reaches the ground. */
  fallTime: Record<DeathKey, number>;
  /** Culling spheres in each skinned mesh's local space, in traversal order. */
  cullSpheres: Sphere[];
}

const ADDITIVE: ClipKey[] = ["hit", "hitHead"];
/** World-space culling sphere around a scale-1 zombie; large enough for the lying death poses. */
const CULL_CENTER = new Vector3(0, 0.9, 0);
const CULL_RADIUS = 2;

let manifest: Promise<Manifest> | undefined;
const templates = new Map<string, Promise<CharacterTemplate>>();

function loadManifest(): Promise<Manifest> {
  manifest ??= fetch("/assets/characters/manifest.json").then((r) => r.json() as Promise<Manifest>);
  return manifest;
}

export async function characterPool(type: ZombieType): Promise<string[]> {
  return (await loadManifest()).characters[type];
}

export function loadTemplate(name: string): Promise<CharacterTemplate> {
  let t = templates.get(name);
  if (!t) {
    t = Promise.all([loadManifest(), loadCharacter(name)]).then(([m, gltf]) => buildTemplate(name, m, gltf.scene, gltf.animations));
    templates.set(name, t);
  }
  return t;
}

export async function preloadCast(): Promise<void> {
  const m = await loadManifest();
  const names = new Set(Object.values(m.characters).flat());
  await Promise.all([...names].map(loadTemplate));
}

function buildTemplate(name: string, m: Manifest, scene: Group, animations: AnimationClip[]): CharacterTemplate {
  const clips = {} as Record<ClipKey, AnimationClip>;
  for (const [key, clipName] of Object.entries(m.clips) as Array<[ClipKey, string]>) {
    const clip = animations.find((c) => c.name === clipName);
    if (!clip) throw new Error(`${name}: missing clip ${clipName}`);
    if (ADDITIVE.includes(key)) {
      const additive = AnimationUtils.makeClipAdditive(clip.clone(), 0);
      additive.blendMode = AdditiveAnimationBlendMode;
      clips[key] = additive;
    } else {
      clips[key] = clip;
    }
  }

  scene.updateMatrixWorld(true);
  const cullSpheres: Sphere[] = [];
  scene.traverse((child) => {
    const mesh = child as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const inverse = mesh.matrixWorld.clone().invert();
    cullSpheres.push(new Sphere(CULL_CENTER.clone().applyMatrix4(inverse), CULL_RADIUS / mesh.matrixWorld.getMaxScaleOnAxis()));
  });

  const probe = cloneSkinned(scene);
  const groundSpeed = {
    walk: measureGroundSpeed(probe, clips.walk),
    walk2: measureGroundSpeed(probe, clips.walk2),
    run: measureGroundSpeed(probe, clips.run),
  };
  const fallTime = { death: measureFallTime(probe, clips.death), death2: measureFallTime(probe, clips.death2) };
  return { name, scene, clips, groundSpeed, fallTime, cullSpheres };
}

function sample(root: Object3D, clip: AnimationClip, steps: number, visit: (t: number) => void) {
  const mixer = new AnimationMixer(root);
  mixer.clipAction(clip).play();
  for (let i = 0; i <= steps; i++) {
    const t = (clip.duration * i) / steps;
    mixer.setTime(t);
    root.updateMatrixWorld(true);
    visit(t);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
}

/** Average backward speed of whichever foot is planted, which equals the intended ground speed. */
function measureGroundSpeed(root: Object3D, clip: AnimationClip): number {
  const left = root.getObjectByName("LeftFoot");
  const right = root.getObjectByName("RightFoot");
  if (!left || !right) return 1;
  const steps = Math.max(30, Math.round(clip.duration * 90));
  const dt = clip.duration / steps;
  const a = new Vector3();
  const b = new Vector3();
  let prevFoot = -1;
  let prevZ = 0;
  let total = 0;
  let count = 0;
  sample(root, clip, steps, () => {
    left.getWorldPosition(a);
    right.getWorldPosition(b);
    const foot = a.y < b.y ? 0 : 1;
    const z = foot === 0 ? a.z : b.z;
    if (foot === prevFoot) {
      total += (prevZ - z) / dt;
      count++;
    }
    prevFoot = foot;
    prevZ = z;
  });
  return Math.max(0.2, count ? total / count : 1);
}

function measureFallTime(root: Object3D, clip: AnimationClip): number {
  const head = root.getObjectByName("Head");
  if (!head) return clip.duration * 0.7;
  const p = new Vector3();
  let startY = -1;
  let fall = clip.duration * 0.7;
  let found = false;
  sample(root, clip, 60, (t) => {
    const y = head.getWorldPosition(p).y;
    if (startY < 0) startY = y;
    if (!found && y < startY * 0.3) {
      fall = t;
      found = true;
    }
  });
  return fall;
}
