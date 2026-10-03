import type { DifficultyId } from "./difficulty.ts";
import type { WeaponId } from "./weapons.ts";

export interface JoinOptions {
  name: string;
  /** Persistent anonymous id for personal bests and the leaderboard. */
  playerId?: string;
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

/** Host-only, in the lobby of a team session. Missing fields keep their current value. */
export interface SettingsMessage {
  difficulty?: DifficultyId;
  minutes?: number;
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

export interface WelcomeEvent {
  sessionId: string;
  /** Lets the client reconnect to its player within the grace period. */
  token: string;
  code: string;
}

export interface PersonalBestEvent {
  isBest: boolean;
  previousBest: number | null;
}

export interface ServerErrorEvent {
  message: string;
}

export interface ClientMessages {
  move: MoveMessage;
  shoot: ShootMessage;
  weapon: SwitchWeaponMessage;
  pause: PauseMessage;
  settings: SettingsMessage;
  start: Record<string, never>;
  /** Back to the lobby in team sessions, a new round in solo. */
  restart: Record<string, never>;
}

export interface ServerEvents {
  welcome: WelcomeEvent;
  shot: ShotEvent;
  zombieHit: ZombieHitEvent;
  kill: KillEvent;
  playerHurt: PlayerHurtEvent;
  ammo: AmmoRefillEvent;
  personalBest: PersonalBestEvent;
  error: ServerErrorEvent;
}

/** JSON text frame in either direction. */
export interface Envelope<T extends string = string, D = unknown> {
  type: T;
  data: D;
}

/** First byte of binary server frames, followed by @colyseus/schema bytes. */
export const StateFrame = {
  Full: 0,
  Patch: 1,
} as const;

export interface CreateSessionResponse {
  code: string;
  solo: boolean;
  difficulty: string;
  duration: number;
}

export interface SessionInfo {
  exists: boolean;
  full: boolean;
  solo: boolean;
  difficulty: string;
  minutes: number;
  duration: number;
  players: number;
  phase: string;
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  kills: number;
  headshots: number;
  deaths: number;
  endedAt: string;
  /** Set when the request named this player. */
  me?: boolean;
}

export interface LeaderboardResponse {
  level: string;
  difficulty: string;
  durationMinutes: number;
  entries: LeaderboardEntry[];
}
