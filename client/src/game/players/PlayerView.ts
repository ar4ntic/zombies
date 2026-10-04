import { AnimationMixer, Group, LoopOnce, MathUtils, Quaternion, Vector3, type AnimationAction, type Mesh, type Object3D } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { WEAPON_ORDER, type WeaponId } from "@zombies/shared";
import { buildGun } from "../weapons/gunModels.ts";
import type { PlayerClip, SkinTemplate } from "./skins.ts";

const FADE = 0.2;
const WALK_FROM = 0.4;
const RUN_FROM = 5.5;
/** Seconds a player keeps the weapon raised after their last shot. */
const AIM_HOLD = 3;
/** Share of the look pitch the upper body leans with. */
const PITCH_LEAN = 0.5;
/** Where the weapon's origin sits relative to the wrist while aiming, in the player's frame. */
const GRIP_OFFSET = new Vector3(0, 0.04, -0.09);

export interface PlayerPose {
  /** Horizontal speed in m/s. */
  speed: number;
  pitch: number;
  dead: boolean;
  weapon: WeaponId;
  cheering: boolean;
}

/** An animated player skin holding the current weapon, as the other players see it. */
export class PlayerView {
  /** Faces -Z like the player it stands for; the skins themselves face +Z. */
  readonly root = new Group();
  private readonly mixer: AnimationMixer;
  private readonly actions: Record<PlayerClip, AnimationAction>;
  private readonly guns = new Map<WeaponId, Group>();
  private readonly spine?: Object3D;
  private clip: PlayerClip = "idle";
  private aimHold = 0;

  constructor(private readonly template: SkinTemplate) {
    const model = cloneSkinned(template.scene);
    model.rotation.y = Math.PI;
    model.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    });
    this.root.add(model);
    this.spine = model.getObjectByName("Spine02");

    this.mixer = new AnimationMixer(model);
    const action = (key: PlayerClip) => this.mixer.clipAction(template.clips[key]);
    this.actions = { idle: action("idle"), aim: action("aim"), walk: action("walk"), run: action("run"), knockedOut: action("knockedOut"), cheer: action("cheer") };
    this.actions.knockedOut.setLoop(LoopOnce, 1);
    this.actions.knockedOut.clampWhenFinished = true;

    // The weapon is fitted to the hand in the aiming pose, pointing where the player faces (-Z, like the gun models).
    this.actions.aim.play();
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const hand = model.getObjectByName("RightHand");
    if (hand) {
      const toHand = hand.getWorldQuaternion(new Quaternion()).invert();
      const handScale = hand.getWorldScale(new Vector3()).x;
      for (const id of WEAPON_ORDER) {
        const gun = buildGun(id).group;
        gun.traverse((c) => (c.castShadow = true));
        gun.quaternion.copy(toHand);
        gun.position.copy(GRIP_OFFSET).applyQuaternion(toHand).divideScalar(handScale);
        gun.scale.setScalar(1 / handScale);
        gun.visible = false;
        hand.add(gun);
        this.guns.set(id, gun);
      }
    }
    this.actions.aim.stop();
    this.actions.idle.play();
  }

  /** Raises the weapon for a moment. */
  shot() {
    this.aimHold = AIM_HOLD;
  }

  update(dt: number, pose: PlayerPose) {
    this.aimHold = Math.max(0, this.aimHold - dt);
    const moving: PlayerClip = pose.speed >= RUN_FROM ? "run" : "walk";
    const standing: PlayerClip = pose.cheering ? "cheer" : this.aimHold > 0 ? "aim" : "idle";
    const clip: PlayerClip = pose.dead ? "knockedOut" : pose.speed >= WALK_FROM ? moving : standing;
    if (clip !== this.clip) {
      this.actions[this.clip].fadeOut(FADE);
      this.actions[clip].reset().fadeIn(FADE).play();
      this.clip = clip;
    }
    if (clip === "walk" || clip === "run") {
      this.actions[clip].timeScale = MathUtils.clamp(pose.speed / this.template.groundSpeed[clip], 0.6, 1.8);
    }
    for (const [id, gun] of this.guns) gun.visible = id === pose.weapon;
    this.mixer.update(dt);
    if (this.spine && !pose.dead) this.spine.rotateX(-pose.pitch * PITCH_LEAN);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
