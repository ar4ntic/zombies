import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  MathUtils,
  PointLight,
  Sprite,
  SpriteMaterial,
  Vector3,
  type PerspectiveCamera,
} from "three";
import { WEAPON_ORDER, type WeaponId } from "@zombies/shared";
import { buildGun, type GunModel } from "./gunModels.ts";

/**
 * The weapon is modeled at real size but drawn scaled down close to the camera, which
 * looks identical on screen and keeps it from poking into walls.
 */
const VIEW_SCALE = 0.35;
const FLASH_TIME = 0.05;

export interface ViewModelPose {
  aiming: boolean;
  sprinting: boolean;
  speed: number;
  bob: number;
  grounded: boolean;
  lookDX: number;
  lookDY: number;
  /** 0..1 while reloading, otherwise -1. */
  reload: number;
  dead: boolean;
}

export class ViewModel {
  private readonly root = new Group();
  private readonly guns = new Map<WeaponId, GunModel>();
  private current: WeaponId = "pistol";
  private readonly flash: Sprite;
  private readonly flashLight = new PointLight("#ffd28a", 0, 6, 2);
  private flashTimer = 0;
  private kick = 0;
  private aimT = 0;
  private sprintT = 0;
  private raise = 1;
  private downT = 0;
  private swayX = 0;
  private swayY = 0;
  private readonly offset = new Vector3();

  constructor(camera: PerspectiveCamera) {
    this.root.scale.setScalar(VIEW_SCALE);
    camera.add(this.root);
    for (const id of WEAPON_ORDER) {
      const gun = buildGun(id);
      gun.group.visible = id === this.current;
      this.root.add(gun.group);
      this.guns.set(id, gun);
    }

    this.flash = new Sprite(
      new SpriteMaterial({ map: flashTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true, color: "#ffd9a0" }),
    );
    this.flash.visible = false;
    this.root.add(this.flash);
    this.root.add(this.flashLight);
  }

  get aimProgress(): number {
    return this.aimT;
  }

  equip(id: WeaponId) {
    if (id === this.current) return;
    this.guns.get(this.current)!.group.visible = false;
    this.current = id;
    this.guns.get(id)!.group.visible = true;
    this.raise = 0;
  }

  fire() {
    this.kick = Math.min(1.5, this.kick + 1);
    this.flashTimer = FLASH_TIME;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(0.09 + Math.random() * 0.05);
  }

  /** World-space muzzle position (on screen it matches the drawn gun). */
  muzzleWorld(target: Vector3): Vector3 {
    const gun = this.guns.get(this.current)!;
    return target.copy(gun.muzzle).applyMatrix4(gun.group.matrixWorld);
  }

  update(dt: number, pose: ViewModelPose) {
    const gun = this.guns.get(this.current)!;
    this.aimT = MathUtils.damp(this.aimT, pose.aiming && pose.reload < 0 ? 1 : 0, 14, dt);
    this.sprintT = MathUtils.damp(this.sprintT, pose.sprinting && pose.reload < 0 ? 1 : 0, 10, dt);
    this.raise = Math.min(1, this.raise + dt * 3.5);
    this.downT = MathUtils.damp(this.downT, pose.dead ? 1 : 0, 6, dt);
    this.kick *= Math.exp(-16 * dt);
    this.swayX = MathUtils.damp(this.swayX, MathUtils.clamp(-pose.lookDX * 0.0009, -0.03, 0.03), 10, dt);
    this.swayY = MathUtils.damp(this.swayY, MathUtils.clamp(pose.lookDY * 0.0009, -0.03, 0.03), 10, dt);

    const moveFactor = pose.grounded ? Math.min(1, pose.speed / 5) : 0;
    const bobAmount = (1 - this.aimT * 0.85) * moveFactor;
    const bobX = Math.sin(pose.bob) * 0.009 * bobAmount;
    const bobY = -Math.abs(Math.cos(pose.bob)) * 0.011 * bobAmount;
    const reloadDip = pose.reload >= 0 ? Math.sin(Math.PI * pose.reload) : 0;

    this.offset.lerpVectors(gun.hip, gun.ads, this.aimT);
    gun.group.position.set(
      this.offset.x + bobX + this.swayX * (1 - this.aimT) + this.sprintT * 0.03,
      this.offset.y + bobY + this.swayY * (1 - this.aimT) - this.sprintT * 0.05 - reloadDip * 0.07 - (1 - this.raise) * 0.25 - this.downT * 0.3,
      this.offset.z + this.kick * 0.045 * (1 - this.aimT * 0.5),
    );
    gun.group.rotation.set(
      this.kick * 0.12 * (1 - this.aimT * 0.6) - this.sprintT * 0.4 - reloadDip * 0.8 + this.swayY * 2,
      this.sprintT * 0.6 + this.swayX * 2,
      this.sprintT * 0.25 + reloadDip * 0.45,
    );

    this.flashTimer -= dt;
    const flashing = this.flashTimer > 0;
    this.flash.visible = flashing;
    this.flashLight.intensity = flashing ? 3 : 0;
    if (flashing) {
      this.flash.position.copy(gun.muzzle).applyEuler(gun.group.rotation).add(gun.group.position);
      this.flashLight.position.copy(this.flash.position);
    }
  }
}

function flashTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, "rgba(255,255,240,1)");
  gradient.addColorStop(0.25, "rgba(255,210,120,0.9)");
  gradient.addColorStop(1, "rgba(255,120,20,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const r = i % 2 === 0 ? c : c * 0.35;
    ctx.lineTo(c + Math.cos(angle) * r, c + Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.fill();
  return new CanvasTexture(canvas);
}
