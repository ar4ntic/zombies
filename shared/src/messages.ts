import type { DifficultyId } from "./difficulty.ts";
import type { WeaponId } from "./weapons.ts";

export interface JoinOptions {
  name: string;
  solo?: boolean;
  /** Round settings, used when creating a session; joiners inherit the host's. */
  difficulty?: DifficultyId;
  minutes?: number;
  /** Overrides the round length of solo rounds for automated tests, in seconds. */
  duration?: number;
}

export interface MoveMessage {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface ShotHit {
  zombie: string;
  head: boolean;
}

export interface ShootMessage {
  weapon: WeaponId;
  /** Muzzle origin and normalized direction, for other players' tracers. */
  origin: [number, number, number];
  end: [number, number, number];
  hit?: ShotHit;
}

export interface SwitchWeaponMessage {
  weapon: WeaponId;
}

export interface PauseMessage {
  paused: boolean;
}

/** Server -> client broadcasts. */
export interface ShotEvent {
  by: string;
  weapon: WeaponId;
  origin: [number, number, number];
  end: [number, number, number];
}

export interface ZombieHitEvent {
  zombie: string;
  by: string;
  head: boolean;
  killed: boolean;
}

export interface KillEvent {
  zombie: string;
  by: string;
  head: boolean;
  points: number;
  combo: number;
}

export interface PlayerHurtEvent {
  player: string;
  damage: number;
  fromX: number;
  fromZ: number;
}

export interface AmmoRefillEvent {
  weapon: WeaponId;
  amount: number;
}
