export type DifficultyId = "easy" | "normal" | "hard" | "nightmare";

export interface DifficultyDef {
  id: DifficultyId;
  label: string;
  zombieHp: number;
  zombieDamage: number;
  zombieSpeed: number;
  /** Multiplier on the time between spawns. */
  spawnInterval: number;
  maxAlive: number;
  /** Multiplier on the number of brutes per wave. */
  brutes: number;
  points: number;
  respawnSeconds: number;
  /** Multiplier on the per-minute star score, matching how many points good play earns at this difficulty. */
  starScale: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyDef> = {
  easy: {
    id: "easy",
    label: "Easy",
    zombieHp: 0.7,
    zombieDamage: 0.45,
    zombieSpeed: 0.8,
    spawnInterval: 1.4,
    maxAlive: 18,
    brutes: 0.5,
    points: 0.75,
    respawnSeconds: 3,
    starScale: 0.6,
  },
  normal: {
    id: "normal",
    label: "Normal",
    zombieHp: 1,
    zombieDamage: 1,
    zombieSpeed: 1,
    spawnInterval: 1,
    maxAlive: 30,
    brutes: 1,
    points: 1,
    respawnSeconds: 5,
    starScale: 1,
  },
  hard: {
    id: "hard",
    label: "Hard",
    zombieHp: 1.3,
    zombieDamage: 1.4,
    zombieSpeed: 1.12,
    spawnInterval: 0.8,
    maxAlive: 36,
    brutes: 1.6,
    points: 1.5,
    respawnSeconds: 6,
    starScale: 1.3,
  },
  nightmare: {
    id: "nightmare",
    label: "Nightmare",
    zombieHp: 1.6,
    zombieDamage: 1.8,
    zombieSpeed: 1.25,
    spawnInterval: 0.65,
    maxAlive: 40,
    brutes: 2.5,
    points: 2,
    respawnSeconds: 7,
    starScale: 1.5,
  },
};

export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES) as DifficultyId[];
export const DEFAULT_DIFFICULTY: DifficultyId = "normal";

export const ROUND_MINUTES = [1, 3, 5, 7, 10] as const;
export const DEFAULT_ROUND_MINUTES = 5;

export function isDifficulty(value: unknown): value is DifficultyId {
  return typeof value === "string" && value in DIFFICULTIES;
}

export function isRoundMinutes(value: unknown): value is number {
  return ROUND_MINUTES.includes(value as (typeof ROUND_MINUTES)[number]);
}

export function formatRoundLength(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
}

export function settingsLabel(difficulty: string, seconds: number): string {
  return `${DIFFICULTIES[difficulty as DifficultyId]?.label ?? difficulty} · ${formatRoundLength(seconds)}`;
}

/** Team score needed for the second star. */
export function starScore(perMinute: number, difficulty: DifficultyDef, seconds: number): number {
  return Math.round((perMinute * difficulty.starScale * seconds) / 60 / 500) * 500;
}

/** Seconds between scheduled wave starts; longer rounds get longer waves but still climb to high intensity. */
export function waveLength(seconds: number): number {
  return Math.min(45, Math.max(15, 12 + (3 * seconds) / 60));
}
