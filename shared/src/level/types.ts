import type { ZombieType } from "../zombies.ts";

export interface Vec2 {
  x: number;
  z: number;
}

/** Oriented box on the ground plane, extruded up to `height`. */
export interface Box {
  x: number;
  z: number;
  hx: number;
  hz: number;
  rot: number;
  height: number;
}

export interface PropPlacement {
  model: string;
  x: number;
  z: number;
  rotation?: number;
}

export interface StructurePlacement {
  texture: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotation?: number;
  /** Texture tile size in meters. */
  tile?: number;
}

export interface LampPlacement {
  x: number;
  z: number;
  rotation: number;
}

export interface WaveDef {
  zombies: Partial<Record<ZombieType, number>>;
  /** Seconds between spawns. */
  spawnInterval: number;
}

export interface LevelDef {
  id: string;
  name: string;
  halfSize: number;
  hdri: string;
  groundTexture: string;
  outsideTexture: string;
  playerSpawns: Vec2[];
  zombieSpawns: Vec2[];
  structures: StructurePlacement[];
  props: PropPlacement[];
  lamps: LampPlacement[];
  /** Escalating waves, each started once the previous one is cleared; after the last one it repeats with growing intensity. */
  waves: WaveDef[];
  /** Team score per minute of round needed for the second star at Normal. */
  scoreStarPerMinute: number;
}
