import { Color, Vector3, type PerspectiveCamera } from "three";
import {
  ADS_SPREAD_FACTOR,
  WEAPONS,
  WEAPON_ORDER,
  raycastBoxes,
  type Box,
  type ShootMessage,
  type WeaponId,
} from "@zombies/shared";
import type { Input } from "../Input.ts";
import type { PlayerController } from "../PlayerController.ts";
import type { Particles } from "../fx/Particles.ts";
import type { Sound } from "../fx/Sound.ts";
import type { Tracers } from "../fx/Tracers.ts";
import type { ZombieManager } from "../zombies/ZombieManager.ts";
import type { ViewModel } from "./ViewModel.ts";

export const TRACER_COLORS: Record<WeaponId, string> = { pistol: "#7ffff0", rifle: "#ffc46b" };
const ZOMBIE_IMPACT = new Color("#9dff7a");
const WORLD_IMPACT = new Color("#ffd08a");
/** A click this many seconds before the weapon is ready still fires. */
const FIRE_BUFFER = 0.15;

interface Ammo {
  magazine: number;
  reserve: number;
}

export interface WeaponDeps {
  camera: PerspectiveCamera;
  input: Input;
  player: PlayerController;
  viewModel: ViewModel;
  zombies: ZombieManager;
  colliders: Box[];
  particles: Particles;
  tracers: Tracers;
  sound: Sound;
  onShoot(msg: ShootMessage): void;
  onSwitch(weapon: WeaponId): void;
  onHit(head: boolean): void;
}

export class WeaponSystem {
  current: WeaponId = "pistol";
  private readonly ammo = new Map<WeaponId, Ammo>();
  private cooldown = 0;
  private reloadTimer = -1;
  private bloom = 0;
  private fireBuffer = 0;
  private readonly origin = new Vector3();
  private readonly dir = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly muzzle = new Vector3();
  private readonly end = new Vector3();

  constructor(private readonly d: WeaponDeps) {
    this.reset();
  }

  reset() {
    for (const id of WEAPON_ORDER) {
      const def = WEAPONS[id];
      this.ammo.set(id, { magazine: def.magazine, reserve: def.startReserve });
    }
    this.cooldown = 0;
    this.reloadTimer = -1;
    this.bloom = 0;
    this.switchTo("pistol");
  }

  get magazine(): number {
    return this.ammo.get(this.current)!.magazine;
  }

  get reserve(): number {
    return this.ammo.get(this.current)!.reserve;
  }

  get reloading(): boolean {
    return this.reloadTimer >= 0;
  }

  /** 0..1 while reloading, otherwise -1. */
  get reloadProgress(): number {
    return this.reloadTimer < 0 ? -1 : 1 - this.reloadTimer / WEAPONS[this.current].reloadTime;
  }

  /** Current cone half-angle in radians, used by the crosshair too. */
  get spread(): number {
    const def = WEAPONS[this.current];
    const base = Math.min(def.maxSpread, def.spread + this.bloom);
    const moving = Math.min(1, this.d.player.horizontalSpeed / 5) * 0.012 + (this.d.player.grounded ? 0 : 0.03);
    const aim = 1 - (1 - ADS_SPREAD_FACTOR) * this.d.viewModel.aimProgress;
    return (base + moving) * aim;
  }

  refillMagazine(weapon: WeaponId) {
    this.ammo.get(weapon)!.magazine = WEAPONS[weapon].magazine;
    if (weapon === this.current) this.reloadTimer = -1;
  }

  addReserve(weapon: WeaponId, amount: number) {
    const ammo = this.ammo.get(weapon);
    if (!ammo) return;
    ammo.reserve = Math.min(WEAPONS[weapon].maxReserve, ammo.reserve + amount);
  }

  private switchTo(id: WeaponId) {
    if (id === this.current) {
      this.d.viewModel.equip(id);
      return;
    }
    this.current = id;
    this.reloadTimer = -1;
    this.cooldown = Math.max(this.cooldown, 0.3);
    this.d.viewModel.equip(id);
    this.d.onSwitch(id);
  }

  private startReload() {
    const def = WEAPONS[this.current];
    const ammo = this.ammo.get(this.current)!;
    if (this.reloading || ammo.magazine >= def.magazine || ammo.reserve <= 0) return;
    this.reloadTimer = def.reloadTime;
    this.d.sound.reload();
  }

  update(dt: number, active: boolean) {
    const { input, player } = this.d;
    const def = WEAPONS[this.current];
    this.cooldown -= dt;
    this.bloom = Math.max(0, this.bloom - dt * (def.maxSpread * 3));

    if (this.reloadTimer >= 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer < 0) {
        const ammo = this.ammo.get(this.current)!;
        const moved = Math.min(def.magazine - ammo.magazine, ammo.reserve);
        ammo.magazine += moved;
        if (Number.isFinite(ammo.reserve)) ammo.reserve -= moved;
      }
    }

    player.aiming = active && !player.dead && input.isDown("aim");
    if (!active || player.dead) {
      this.fireBuffer = 0;
      return;
    }

    if (input.pressed("weapon1")) this.switchTo("pistol");
    if (input.pressed("weapon2")) this.switchTo("rifle");
    const wheel = input.consumeWheel();
    if (wheel !== 0) {
      const index = WEAPON_ORDER.indexOf(this.current);
      const next = WEAPON_ORDER[(index + (wheel > 0 ? 1 : WEAPON_ORDER.length - 1)) % WEAPON_ORDER.length]!;
      this.switchTo(next);
    }
    if (input.pressed("reload")) this.startReload();

    if (input.pressed("fire")) this.fireBuffer = FIRE_BUFFER;
    else this.fireBuffer -= dt;
    const wantsFire = this.fireBuffer > 0 || (WEAPONS[this.current].automatic && input.isDown("fire"));
    if (!wantsFire || this.cooldown > 0 || this.reloading || player.sprinting) return;
    this.fireBuffer = 0;

    const ammo = this.ammo.get(this.current)!;
    if (ammo.magazine <= 0) {
      this.startReload();
      return;
    }
    ammo.magazine--;
    this.cooldown = WEAPONS[this.current].fireInterval;
    this.fire();
    if (ammo.magazine === 0) this.startReload();
  }

  private fire() {
    const { camera, player, viewModel, zombies, colliders, particles, tracers, sound } = this.d;
    const def = WEAPONS[this.current];

    camera.updateMatrixWorld();
    camera.getWorldPosition(this.origin);
    camera.getWorldDirection(this.dir);
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(camera.matrixWorld, 1);
    const spread = this.spread;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * spread;
    this.dir
      .addScaledVector(this.right, Math.cos(angle) * radius)
      .addScaledVector(this.up, Math.sin(angle) * radius)
      .normalize();
    this.bloom += def.spreadPerShot;

    const worldDist = raycastBoxes(
      this.origin.x, this.origin.y, this.origin.z,
      this.dir.x, this.dir.y, this.dir.z,
      def.range, colliders,
    );
    const hit = zombies.raycast(this.origin, this.dir, Math.min(def.range, worldDist));
    const distance = hit ? hit.distance : Math.min(def.range, worldDist);
    this.end.copy(this.origin).addScaledVector(this.dir, distance);

    viewModel.fire();
    viewModel.muzzleWorld(this.muzzle);
    tracers.spawn(this.muzzle, this.end, TRACER_COLORS[this.current], this.current === "rifle" ? 0.01 : 0.008);
    sound.shot(this.current);
    player.addRecoil(def.recoil * (1 - 0.4 * viewModel.aimProgress), (Math.random() - 0.5) * def.recoil * 0.5);

    const back = this.dir.clone().negate();
    if (hit) {
      zombies.hit(hit.id, this.origin, hit.head);
      particles.burst(this.end, { count: hit.head ? 22 : 12, color: ZOMBIE_IMPACT, speed: 3, life: 0.45, size: 0.035, direction: back, spread: 0.9, gravity: 4 });
      sound.hit(hit.head);
      this.d.onHit(hit.head);
    } else if (worldDist <= def.range) {
      particles.burst(this.end, { count: 8, color: WORLD_IMPACT, speed: 2.5, life: 0.3, size: 0.025, direction: back, spread: 0.8, gravity: 9 });
    }

    // Other players see the shot from roughly where this player holds the gun.
    const gunOrigin = this.origin.clone().addScaledVector(this.right, 0.15).addScaledVector(this.up, -0.12).addScaledVector(camera.getWorldDirection(new Vector3()), 0.5);
    this.d.onShoot({
      weapon: this.current,
      origin: [gunOrigin.x, gunOrigin.y, gunOrigin.z],
      end: [this.end.x, this.end.y, this.end.z],
      hit: hit ? { zombie: hit.id, head: hit.head } : undefined,
    });
  }
}
