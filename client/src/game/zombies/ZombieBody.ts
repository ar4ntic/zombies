import type { Object3D, Vector3 } from "three";
import type { ZombieType } from "@zombies/shared";

/** What the zombie manager needs from the drawn body of one zombie, whatever it is made of. */
export interface ZombieBody {
  readonly root: Object3D;
  readonly position: Vector3;
  readonly scale: number;
  readonly type: ZombieType;
  dying: boolean;
  dead: boolean;
  /** 0 until the body has fallen, then rises to 1 while it dissolves. */
  dissolve: number;
  /** True while running bent forward, which moves the head hitbox ahead of the body. */
  readonly leaning: boolean;
  readonly facing: number;
  readonly level: number;
  readonly castsShadow: boolean;
  pushSnapshot(): void;
  hit(from: Vector3, head: boolean): void;
  die(): void;
  /** @param animStep seconds between skeleton updates; 0 animates every frame. */
  update(dt: number, animStep?: number): void;
  setLevel(level: number): void;
  setShadows(enabled: boolean): void;
  dispose(): void;
}
