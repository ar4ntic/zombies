import { Color, Vector3, type PerspectiveCamera } from "three";
import {
  ADS_SPREAD_FACTOR,
  WEAPONS,
  WEAPON_ORDER,
  raycastBoxes,
  type Box,
  type EnergyMode,
  type ShootMessage,
  type WeaponId,
} from "@zombies/shared";
import type { Input } from "../Input.ts";
import type { PlayerController } from "../PlayerController.ts";
import type { Bolts } from "../fx/Bolts.ts";
import type { Particles } from "../fx/Particles.ts";
import type { Scorches } from "../fx/Scorches.ts";
import type { Sound } from "../fx/Sound.ts";
import type { ZombieManager } from "../zombies/ZombieManager.ts";
import type { ViewModel } from "./ViewModel.ts";

/** Color, width and length in meters of each weapon's laser bolt. */
export const BOLTS: Record<WeaponId, { color: string; width: number; length: number; scorch: number }> = {
  pistol: { color: "#7ffff0", width: 0.014, length: 0.9, scorch: 0.24 },
  rifle: { color: "#ffc46b", width: 0.017, length: 1.5, scorch: 0.32 },
};
/** How far before and behind the collider a shot hit the visible surface is looked for, in meters. */
export const SURFACE_SEARCH = { before: 1.5, behind: 0.6 };
const ZOMBIE_IMPACT = new Color("#9dff7a");
const WORLD_IMPACT = new Color("#ffd08a");
const MATE_IMPACT = new Color("#ffae3d");
/** A click this many seconds before the weapon is ready still fires. */
const FIRE_BUFFER = 0.15;
/** A reload key press is kept this long, so one made just before the weapon can reload still counts. */
const RELOAD_BUFFER = 0.4;
/** Scrolling has to pause this long before the wheel switches weapons again, so one swipe is one switch. */
const WHEEL_PAUSE = 0.25;
const EMPTY_SOUND_INTERVAL = 0.3;

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
  bolts: Bolts;
  scorches: Scorches;
  sound: Sound;
  /** Where a ray meets the visible world; see `World.surfaceHit`. */
  surface(origin: Vector3, dir: Vector3, near: number, far: number, point: Vector3, normal: Vector3): boolean;
  /** The nearest teammate a ray hits. */
  mates(origin: Vector3, dir: Vector3, maxDistance: number): { id: string; distance: number } | null;
  friendlyFire(): boolean;
  onShoot(msg: ShootMessage): void;
  onSwitch(weapon: WeaponId): void;
  onHit(head: boolean): void;
  onHitMate(id: string): void;
}

export class WeaponSystem {
  current: WeaponId = "pistol";
  private readonly ammo = new Map<WeaponId, Ammo>();
  private cooldown = 0;
  private reloadTimer = -1;
  private bloom = 0;
  private fireBuffer = 0;
  private reloadBuffer = 0;
  private wheelPause = 0;
  private mode: EnergyMode = "limited";
  private readonly origin = new Vector3();
  private readonly dir = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly muzzle = new Vector3();
  private readonly end = new Vector3();
  private readonly normal = new Vector3();

  constructor(private readonly d: WeaponDeps) {
    this.reset();
  }

  /** Full capsules for a new round; with infinite energy the spare capsules never run out. */
  reset(mode = this.mode) {
    this.mode = mode;
    for (const id of WEAPON_ORDER) {
      const def = WEAPONS[id];
      this.ammo.set(id, { magazine: def.magazine, reserve: mode === "infinite" ? Infinity : def.startReserve });
    }
    this.cooldown = 0;
    this.reloadTimer = -1;
    this.reloadBuffer = 0;
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

  /** Share of the current energy capsule left, 0..1. */
  get charge(): number {
    return this.magazine / WEAPONS[this.current].magazine;
  }

  /** The capsule is empty and there is no spare one to swap in. */
  get outOfEnergy(): boolean {
    const ammo = this.ammo.get(this.current)!;
    return ammo.magazine === 0 && ammo.reserve <= 0;
  }

  /** Whether collecting more spare energy for this weapon would add anything. */
  canTake(weapon: WeaponId): boolean {
    return this.ammo.get(weapon)!.reserve < WEAPONS[weapon].maxReserve;
  }

  refillMagazine(weapon: WeaponId) {
    this.ammo.get(weapon)!.magazine = WEAPONS[weapon].magazine;
    if (weapon === this.current) this.reloadTimer = -1;
  }

  addReserve(weapon: WeaponId, amount: number) {
    const ammo = this.ammo.get(weapon);
    if (!ammo) return;
    ammo.reserve = Math.min(WEAPONS[weapon].maxReserve, ammo.reserve + amount);
    if (weapon === this.current && ammo.magazine === 0) this.startReload();
  }

  /** Switching away abandons a reload in progress; a weapon drawn with an empty capsule reloads by itself. */
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
    if (this.magazine === 0) this.startReload();
  }

  private startReload(): boolean {
    const def = WEAPONS[this.current];
    const ammo = this.ammo.get(this.current)!;
    if (this.reloading || ammo.magazine >= def.magazine || ammo.reserve <= 0) return false;
    this.reloadTimer = def.reloadTime;
    this.d.sound.reload();
    return true;
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
        this.d.sound.reloadDone();
      }
    }

    if (input.pressed("reload")) this.reloadBuffer = RELOAD_BUFFER;
    else this.reloadBuffer -= dt;
    const wheel = input.consumeWheel();
    const wheelReady = this.wheelPause <= 0;
    this.wheelPause = wheel !== 0 ? WHEEL_PAUSE : this.wheelPause - dt;

    player.aiming = active && !player.dead && input.isDown("aim");
    if (!active || player.dead) {
      this.fireBuffer = 0;
      return;
    }

    if (input.pressed("weapon1")) this.switchTo("pistol");
    if (input.pressed("weapon2")) this.switchTo("rifle");
    if (wheel !== 0 && wheelReady) {
      const index = WEAPON_ORDER.indexOf(this.current);
      const next = WEAPON_ORDER[(index + (wheel > 0 ? 1 : WEAPON_ORDER.length - 1)) % WEAPON_ORDER.length]!;
      this.switchTo(next);
    }
    if (this.reloadBuffer > 0 && this.startReload()) this.reloadBuffer = 0;

    if (input.pressed("fire")) this.fireBuffer = FIRE_BUFFER;
    else this.fireBuffer -= dt;
    const wantsFire = this.fireBuffer > 0 || (WEAPONS[this.current].automatic && input.isDown("fire"));
    if (!wantsFire || this.cooldown > 0 || this.reloading || player.sprinting) return;
    this.fireBuffer = 0;

    const ammo = this.ammo.get(this.current)!;
    if (ammo.magazine <= 0) {
      if (!this.startReload()) {
        this.cooldown = EMPTY_SOUND_INTERVAL;
        this.d.sound.empty();
      }
      return;
    }
    ammo.magazine--;
    this.cooldown = WEAPONS[this.current].fireInterval;
    this.fire();
    if (ammo.magazine === 0) this.startReload();
  }

  private fire() {
    const { camera, player, viewModel, zombies, colliders, particles, bolts, sound } = this.d;
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
    const zombie = zombies.raycast(this.origin, this.dir, Math.min(def.range, worldDist));
    let distance = zombie ? zombie.distance : Math.min(def.range, worldDist);
    // With friendly fire a teammate in the line of fire takes the shot; otherwise it passes through them.
    const mate = this.d.friendlyFire() ? this.d.mates(this.origin, this.dir, distance) : null;
    if (mate) distance = mate.distance;
    const hit = mate ? null : zombie;
    this.end.copy(this.origin).addScaledVector(this.dir, distance);
    // The colliders are boxes around the props; the bolt ends, and leaves its mark, on what is actually drawn.
    const hitsWorld = !hit && !mate && worldDist <= def.range;
    const marks = hitsWorld && this.d.surface(this.origin, this.dir, distance - SURFACE_SEARCH.before, distance + SURFACE_SEARCH.behind, this.end, this.normal);

    viewModel.fire();
    viewModel.muzzleWorld(this.muzzle);
    sound.shot(this.current);
    player.addRecoil(def.recoil * (1 - 0.4 * viewModel.aimProgress), (Math.random() - 0.5) * def.recoil * 0.5);

    // The shot hits at once; the bolt is drawn flying there and its sparks appear when it arrives.
    const bolt = BOLTS[this.current];
    const back = this.dir.clone().negate();
    const impact = this.end.clone();
    let sparks: (() => void) | undefined;
    if (hit) {
      zombies.hit(hit.id, this.origin, hit.head);
      sound.hit(hit.head);
      this.d.onHit(hit.head);
      const count = hit.head ? 22 : 12;
      sparks = () => particles.burst(impact, { count, color: ZOMBIE_IMPACT, speed: 3, life: 0.45, size: 0.035, direction: back, spread: 0.9, gravity: 4 });
    } else if (mate) {
      this.d.onHitMate(mate.id);
      sparks = () => particles.burst(impact, { count: 10, color: MATE_IMPACT, speed: 2.5, life: 0.35, size: 0.03, direction: back, spread: 0.9, gravity: 5 });
    } else if (hitsWorld) {
      const normal = marks ? this.normal.clone() : undefined;
      const { scorches } = this.d;
      sparks = () => {
        particles.burst(impact, { count: 8, color: WORLD_IMPACT, speed: 2.5, life: 0.3, size: 0.025, direction: normal ?? back, spread: 0.8, gravity: 9 });
        if (normal) scorches.add(impact, normal, bolt.color, bolt.scorch);
      };
    }
    bolts.spawn(this.muzzle, this.end, bolt.color, bolt.width, bolt.length, sparks);

    // Other players see the bolt leave from roughly where this player holds the gun.
    const gunOrigin = this.origin.clone().addScaledVector(this.right, 0.15).addScaledVector(this.up, -0.12).addScaledVector(camera.getWorldDirection(new Vector3()), 0.5);
    this.d.onShoot({
      weapon: this.current,
      origin: [gunOrigin.x, gunOrigin.y, gunOrigin.z],
      end: [this.end.x, this.end.y, this.end.z],
      hit: hit ? { zombie: hit.id, head: hit.head } : undefined,
      hitPlayer: mate?.id,
    });
  }
}
