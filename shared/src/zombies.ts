export type ZombieType = "walker" | "runner" | "brute";

/** Hit volumes for a scale-1 zombie in meters, measured from the locomotion poses. */
export interface ZombieHitbox {
  bodyRadius: number;
  bodyHeight: number;
  /** How far the body leans forward along the facing direction. */
  bodyForward: number;
  headY: number;
  headForward: number;
  headRadius: number;
}

export interface ZombieDef {
  hp: number;
  speed: number;
  damage: number;
  attackRange: number;
  attackCooldown: number;
  /** Highest surface a player can stand on and still be hit. */
  reach: number;
  points: number;
  radius: number;
  /** Visual scale relative to a 1.8 m tall human. */
  scale: number;
  hitbox: ZombieHitbox;
  /** Chance to stop and scream right after spawning. */
  screamChance: number;
}

const UPRIGHT: ZombieHitbox = { bodyRadius: 0.36, bodyHeight: 1.32, bodyForward: 0.04, headY: 1.5, headForward: 0.1, headRadius: 0.21 };
const LEANING: ZombieHitbox = { bodyRadius: 0.36, bodyHeight: 1.15, bodyForward: 0.2, headY: 1.32, headForward: 0.45, headRadius: 0.21 };

export const ZOMBIES: Record<ZombieType, ZombieDef> = {
  walker: {
    hp: 100,
    speed: 1.3,
    damage: 12,
    attackRange: 1.4,
    attackCooldown: 1.4,
    reach: 1,
    points: 100,
    radius: 0.4,
    scale: 1,
    hitbox: UPRIGHT,
    screamChance: 0.3,
  },
  runner: {
    hp: 70,
    speed: 4.2,
    damage: 8,
    attackRange: 1.3,
    attackCooldown: 1.0,
    reach: 1,
    points: 150,
    radius: 0.35,
    scale: 0.95,
    hitbox: LEANING,
    screamChance: 0.5,
  },
  brute: {
    hp: 350,
    speed: 1.1,
    damage: 30,
    attackRange: 1.9,
    attackCooldown: 1.8,
    reach: 2,
    points: 400,
    radius: 0.55,
    scale: 1.3,
    hitbox: UPRIGHT,
    screamChance: 1,
  },
};

export const ZOMBIE_TYPES = Object.keys(ZOMBIES) as ZombieType[];

export const ZombieAnim = {
  Move: 0,
  Attack: 1,
  Scream: 2,
  Dance: 3,
} as const;
export type ZombieAnim = (typeof ZombieAnim)[keyof typeof ZombieAnim];

/** Stable per-zombie pseudo-random value in [0, 1), identical on every client. */
export function zombieHash(id: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
