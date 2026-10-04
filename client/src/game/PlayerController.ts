import { MathUtils, Vector3, type PerspectiveCamera } from "three";
import { PLAYER_RADIUS, resolveCircle, type Box } from "@zombies/shared";
import type { Input } from "./Input.ts";

const WALK_SPEED = 5;
const SPRINT_SPEED = 8;
const CROUCH_SPEED = 2.5;
const AIM_SPEED = 3;
const ACCELERATION = 60;
const FRICTION = 10;
const GRAVITY = 24;
const JUMP_SPEED = 7.5;
const EYE_HEIGHT = 1.7;
const CROUCH_EYE_HEIGHT = 1.1;
const DEAD_EYE_HEIGHT = 0.3;
/** Radians of camera rotation per pixel of mouse travel. */
const MOUSE_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.01;
const BASE_FOV = 75;
const AIM_FOV = 52;
const RECOIL_RECOVERY = 7;

export class PlayerController {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  yaw = 0;
  pitch = 0;
  /** Player-chosen multiplier on the default look speed. */
  sensitivityScale = 1;
  dead = false;
  aiming = false;

  private onGround = true;
  private eyeHeight = EYE_HEIGHT;
  private roll = 0;
  private recoilPitch = 0;
  private readonly wishDir = new Vector3();
  private bobPhase = 0;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly input: Input,
    private readonly colliders: Box[],
    private readonly arenaHalfSize: number,
  ) {}

  spawn(x: number, z: number, yaw: number) {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
  }

  get sprinting(): boolean {
    return this.input.isDown("sprint") && !this.aiming && !this.dead && this.horizontalSpeed > 1;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get grounded(): boolean {
    return this.onGround;
  }

  /** Walk-cycle phase for weapon bob. */
  get bob(): number {
    return this.bobPhase;
  }

  addRecoil(pitch: number, yaw: number) {
    this.recoilPitch += pitch;
    this.yaw += yaw;
  }

  update(dt: number, controlsActive: boolean, lookActive = controlsActive) {
    if (lookActive) {
      const { dx, dy } = this.input.consumeMouse();
      const sens = MOUSE_SENSITIVITY * this.sensitivityScale * (this.aiming ? 0.65 : 1);
      this.yaw -= dx * sens;
      this.pitch = MathUtils.clamp(this.pitch - dy * sens, -MAX_PITCH, MAX_PITCH);
    }

    const recovered = this.recoilPitch * Math.min(1, RECOIL_RECOVERY * dt);
    this.recoilPitch -= recovered;
    const totalPitch = MathUtils.clamp(this.pitch + this.recoilPitch, -MAX_PITCH, MAX_PITCH);

    const crouching = controlsActive && this.input.isDown("crouch");
    let speed = WALK_SPEED;
    if (this.aiming) speed = AIM_SPEED;
    else if (crouching) speed = CROUCH_SPEED;
    else if (controlsActive && this.input.isDown("sprint")) speed = SPRINT_SPEED;

    let forward = 0;
    let strafe = 0;
    if (controlsActive && !this.dead) {
      forward = Number(this.input.isDown("forward")) - Number(this.input.isDown("back"));
      strafe = Number(this.input.isDown("right")) - Number(this.input.isDown("left"));
    }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.wishDir.set(strafe * cos - forward * sin, 0, -strafe * sin - forward * cos);
    if (this.wishDir.lengthSq() > 1) this.wishDir.normalize();

    const control = this.onGround ? 1 : 0.3;
    const blend = Math.min(1, (ACCELERATION * control * dt) / speed);
    this.velocity.x += (this.wishDir.x * speed - this.velocity.x) * blend;
    this.velocity.z += (this.wishDir.z * speed - this.velocity.z) * blend;
    if (this.onGround && this.wishDir.lengthSq() === 0) {
      this.velocity.x *= Math.max(0, 1 - FRICTION * dt);
      this.velocity.z *= Math.max(0, 1 - FRICTION * dt);
    }

    if (controlsActive && this.onGround && this.input.pressed("jump") && !crouching && !this.dead) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
    }
    this.velocity.y -= GRAVITY * dt;

    this.position.addScaledVector(this.velocity, dt);
    if (this.position.y <= 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.onGround = true;
    }
    const pos2 = { x: this.position.x, z: this.position.z };
    resolveCircle(pos2, PLAYER_RADIUS, this.colliders);
    const limit = this.arenaHalfSize - PLAYER_RADIUS;
    this.position.x = MathUtils.clamp(pos2.x, -limit, limit);
    this.position.z = MathUtils.clamp(pos2.z, -limit, limit);

    if (this.onGround) this.bobPhase += this.horizontalSpeed * dt * 1.6;

    const targetEye = this.dead ? DEAD_EYE_HEIGHT : crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    this.eyeHeight = MathUtils.damp(this.eyeHeight, targetEye, this.dead ? 4 : 14, dt);

    const targetFov = this.aiming ? AIM_FOV : BASE_FOV + (this.sprinting ? 6 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = MathUtils.damp(this.camera.fov, targetFov, 12, dt);
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
    this.roll = MathUtils.damp(this.roll, this.dead ? 0.6 : 0, 5, dt);
    this.camera.rotation.set(totalPitch, this.yaw, this.roll, "YXZ");
  }
}
