import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  MathUtils,
  Vector3,
  type AnimationAction,
  type Material,
  type Mesh,
  type Object3D,
  type Scene,
  type SkinnedMesh,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ZOMBIES, ZombieAnim, zombieHash, type ZombieState, type ZombieType } from "@zombies/shared";
import { applyDissolve, isStandardMaterial, type DissolveUniforms } from "../fx/dissolve.ts";
import { characterPool, loadTemplate, type CharacterTemplate, type DeathKey, type LocomotionKey } from "./cast.ts";
import { SnapshotTrack, type Pose } from "./SnapshotTrack.ts";
import type { ZombieBody } from "./ZombieBody.ts";

const DISSOLVE_TIME = 1.1;
const HIT_HOLD = 0.35;
const FADE = 0.25;

type Mode = "move" | "attack" | "scream" | "dance" | "dying";

export class ZombieView implements ZombieBody {
  readonly root: Object3D;
  readonly position = new Vector3();
  readonly scale: number;
  dying = false;
  dead = false;
  /** 0 until the body has fallen, then rises to 1 while it dissolves. */
  dissolve = 0;

  private readonly mixer: AnimationMixer;
  private readonly locomotion: AnimationAction;
  private readonly locomotionSpeed: number;
  private readonly attack: AnimationAction;
  private readonly scream: AnimationAction;
  private readonly dance: AnimationAction;
  private readonly hitBody: AnimationAction;
  private readonly hitHead: AnimationAction;
  private readonly death: AnimationAction;
  private readonly fallTime: number;
  private readonly variation: number;
  private mode: Mode = "move";
  private current?: AnimationAction;
  private activeHit?: AnimationAction;
  private hitTimer = 0;
  private animAccum = 0;
  private readonly uniforms: DissolveUniforms[] = [];
  private readonly track = new SnapshotTrack();
  private readonly pose: Pose = { x: 0, z: 0, rot: 0 };
  private rot = 0;
  private speed = 0;
  private flash = 0;
  private readonly knock = new Vector3();
  private readonly lastPos = new Vector3();
  /** Meshes per level of detail; 0 is the full mesh. */
  private readonly lods: Mesh[][] = [];
  private lod = 0;

  private constructor(
    private readonly scene: Scene,
    readonly id: string,
    readonly type: ZombieType,
    template: CharacterTemplate,
    private readonly state: ZombieState,
  ) {
    this.scale = ZOMBIES[type].scale;
    this.variation = 0.92 + zombieHash(id, 4) * 0.16;
    this.root = cloneSkinned(template.scene);
    this.root.scale.setScalar(this.scale);

    let sphereIndex = 0;
    const materials = new Map<Material, Material>();
    this.root.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if ((mesh as SkinnedMesh).isSkinnedMesh) {
        const sphere = template.cullSpheres[sphereIndex++];
        if (sphere) (mesh as SkinnedMesh).boundingSphere = sphere.clone();
      }
      const source = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
      let material = materials.get(source);
      if (!material) {
        material = source.clone();
        if (isStandardMaterial(material)) this.uniforms.push(applyDissolve(material));
        materials.set(source, material);
      }
      mesh.material = material;
      const lod = Number(mesh.name.match(/_LOD(\d)$/)?.[1] ?? 0);
      (this.lods[lod] ??= []).push(mesh);
      mesh.visible = lod === 0;
    });

    this.mixer = new AnimationMixer(this.root);
    const clips = template.clips;
    const locomotionKey: LocomotionKey = type === "runner" ? "run" : zombieHash(id, 2) < 0.5 ? "walk" : "walk2";
    const deathKey: DeathKey = zombieHash(id, 3) < 0.5 ? "death" : "death2";
    this.locomotion = this.mixer.clipAction(clips[locomotionKey]);
    this.locomotionSpeed = template.groundSpeed[locomotionKey] * this.scale;
    this.attack = this.mixer.clipAction(clips.attack);
    this.scream = this.mixer.clipAction(clips.scream);
    this.dance = this.mixer.clipAction(clips.dance);
    this.hitBody = this.mixer.clipAction(clips.hit);
    this.hitHead = this.mixer.clipAction(clips.hitHead);
    this.death = this.mixer.clipAction(clips[deathKey]);
    this.fallTime = template.fallTime[deathKey];
    this.death.setLoop(LoopOnce, 1);
    this.death.clampWhenFinished = true;
    for (const hit of [this.hitBody, this.hitHead]) {
      hit.setLoop(LoopOnce, 1);
      hit.clampWhenFinished = true;
    }

    this.rot = state.rot;
    this.position.set(state.x, 0, state.z);
    this.lastPos.copy(this.position);
    this.pushSnapshot();
    this.applyMode(this.modeFromState(), 0);
    this.locomotion.time = zombieHash(id, 5) * this.locomotion.getClip().duration;
    this.mixer.update(0);
    this.syncTransform();
    scene.add(this.root);
  }

  static async create(scene: Scene, id: string, state: ZombieState): Promise<ZombieView> {
    const type = state.type as ZombieType;
    const pool = await characterPool(type);
    const name = pool[Math.floor(zombieHash(id, 1) * pool.length)]!;
    return new ZombieView(scene, id, type, await loadTemplate(name), state);
  }

  /** True while running bent forward, which moves the head hitbox ahead of the body. */
  get leaning(): boolean {
    return this.type === "runner" && this.mode === "move";
  }

  get facing(): number {
    return this.root.rotation.y;
  }

  pushSnapshot() {
    this.track.push(this.state);
  }

  hit(from: Vector3, head: boolean) {
    if (this.dying) return;
    this.flash = head ? 1.6 : 1;
    this.knock.subVectors(this.position, from).setY(0).normalize().multiplyScalar((head ? 0.2 : 0.12) / this.scale);
    if (this.mode === "dance") return;
    const action = head ? this.hitHead : this.hitBody;
    if (this.activeHit && this.activeHit !== action) this.activeHit.fadeOut(0.1);
    action.reset().setEffectiveTimeScale(1.5).setEffectiveWeight(this.type === "brute" ? 0.6 : 1).fadeIn(0.05).play();
    this.activeHit = action;
    this.hitTimer = HIT_HOLD;
  }

  die() {
    if (this.dying) return;
    this.dying = true;
    this.flash = 1.4;
    this.activeHit?.fadeOut(0.1);
    this.activeHit = undefined;
    this.applyMode("dying", 0.15);
  }

  private modeFromState(): Mode {
    switch (this.state.anim) {
      case ZombieAnim.Attack:
        return "attack";
      case ZombieAnim.Scream:
        return "scream";
      case ZombieAnim.Dance:
        return "dance";
      default:
        return "move";
    }
  }

  private applyMode(mode: Mode, fade = FADE) {
    if (mode === this.mode && this.current) return;
    this.mode = mode;
    const next = {
      move: this.locomotion,
      attack: this.attack,
      scream: this.scream,
      dance: this.dance,
      dying: this.death,
    }[mode];
    next.reset().setEffectiveWeight(1);
    if (mode === "dying") next.setLoop(LoopOnce, 1);
    else next.setLoop(LoopRepeat, Infinity);
    next.setEffectiveTimeScale(mode === "attack" ? 1.6 * this.variation : mode === "scream" ? 1.15 * this.variation : 1);
    if (mode === "dance") next.time = (performance.now() / 1000) % next.getClip().duration;
    next.fadeIn(fade).play();
    if (this.current && this.current !== next) this.current.fadeOut(fade);
    this.current = next;
  }

  /**
   * @param animStep seconds between skeleton updates; 0 animates every frame.
   */
  update(dt: number, animStep = 0) {
    if (this.dying) {
      if (this.death.time >= this.fallTime || !this.death.isRunning()) {
        if (this.dissolve === 0) this.root.traverse((c) => (c.castShadow = false));
        this.dissolve = Math.min(1, this.dissolve + dt / DISSOLVE_TIME);
        this.root.position.y = -0.15 * this.dissolve * this.scale;
        if (this.dissolve >= 1) this.dead = true;
      }
      animStep = 0;
    } else {
      this.interpolate(dt);
      this.applyMode(this.modeFromState());
      if (this.mode === "move") {
        this.locomotion.setEffectiveTimeScale(MathUtils.clamp(this.speed / this.locomotionSpeed, 0.3, 2.4));
      }
      if (this.activeHit && (this.hitTimer -= dt) <= 0) {
        this.activeHit.fadeOut(0.3);
        this.activeHit = undefined;
      }
    }

    this.animAccum += dt;
    if (this.animAccum >= animStep) {
      this.mixer.update(this.animAccum);
      this.animAccum = 0;
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

  get level(): number {
    return this.lod;
  }

  get castsShadow(): boolean {
    return this.root.userData.shadows !== false && this.dissolve === 0;
  }

  setLevel(level: number) {
    level = Math.min(level, this.lods.length - 1);
    if (level === this.lod) return;
    for (const mesh of this.lods[this.lod]!) mesh.visible = false;
    for (const mesh of this.lods[level]!) mesh.visible = true;
    this.lod = level;
  }

  setShadows(enabled: boolean) {
    if (this.dissolve > 0) enabled = false;
    if (this.root.userData.shadows === enabled) return;
    this.root.userData.shadows = enabled;
    this.root.traverse((c) => (c.castShadow = enabled));
  }

  private interpolate(dt: number) {
    this.track.sample(this.state, this.pose);
    const { x, z, rot } = this.pose;
    const frameSpeed = Math.hypot(x - this.lastPos.x, z - this.lastPos.z) / Math.max(1e-3, dt);
    this.speed = MathUtils.damp(this.speed, frameSpeed, 8, dt);
    this.lastPos.set(x, 0, z);
    this.position.set(x, 0, z);
    this.rot = rot;
  }

  private syncTransform() {
    this.root.position.x = this.position.x + this.knock.x;
    this.root.position.z = this.position.z + this.knock.z;
    this.root.rotation.y = this.rot;
  }

  dispose() {
    this.scene.remove(this.root);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) (mesh.material as Material).dispose();
    });
  }
}
