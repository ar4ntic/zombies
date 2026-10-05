import type { DifficultyId } from "./difficulty.ts";
import type { EnergyMode } from "./energy.ts";
import type { PickupKind } from "./schema.ts";
import type { WeaponId } from "./weapons.ts";

export interface JoinOptions {
  name: string;
  /** Persistent anonymous id for personal bests and the leaderboard. */
  playerId?: string;
  solo?: boolean;
  /** Round settings, used when creating a session; joiners inherit the host's. */
  difficulty?: DifficultyId;
  minutes?: number;
  energy?: EnergyMode;
  friendlyFire?: boolean;
  /** Team session that only confirmed accounts may join; needs a confirmed account to create. */
  private?: boolean;
  /** Character skin shown to the other players. */
  skin?: string;
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
  /** Muzzle position and impact point, for the bolt other players see. */
  origin: [number, number, number];
  end: [number, number, number];
  hit?: ShotHit;
  /** Session id of a teammate the shot hit instead, which only counts with friendly fire on. */
  hitPlayer?: string;
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
  energy?: EnergyMode;
  friendlyFire?: boolean;
}

/** Asks for the energy capsule the player is standing on. */
export interface CollectMessage {
  id: string;
}

export interface SkinMessage {
  skin: string;
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

export interface PickupEvent {
  player: string;
  kind: PickupKind;
  /** Rifle energy or health points granted. */
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
  collect: CollectMessage;
  skin: SkinMessage;
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
  pickup: PickupEvent;
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
  energy: string;
  duration: number;
  private: boolean;
}

export interface SessionInfo {
  exists: boolean;
  full: boolean;
  solo: boolean;
  difficulty: string;
  energy: string;
  friendlyFire: boolean;
  private: boolean;
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
  /** Set when the request named this player (and, if given, this nickname). */
  me?: boolean;
}

/** The public board ranks players without an account, the members board confirmed accounts. */
export type LeaderboardKind = "public" | "members";

export function isLeaderboardKind(value: unknown): value is LeaderboardKind {
  return value === "public" || value === "members";
}

export interface LeaderboardResponse {
  level: string;
  difficulty: string;
  durationMinutes: number;
  energy: string;
  board: LeaderboardKind;
  entries: LeaderboardEntry[];
}

export interface AccountInfo {
  email: string;
  /** The one nickname the account owns, once chosen. */
  nickname: string | null;
  /** Whether the email address is confirmed; only then is the nickname protected from others. */
  verified: boolean;
}

/** Answer of the account endpoints. */
export interface AccountResponse {
  account: AccountInfo | null;
  /** Set when a confirmation or reset mail was requested: whether it could be sent. */
  mailSent?: boolean;
  error?: string;
}

export interface NicknameCheck {
  /** The nickname belongs to an account with a confirmed email address. */
  protected: boolean;
  /** That account is the one this browser is logged in to. */
  mine: boolean;
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;
