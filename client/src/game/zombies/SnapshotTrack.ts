import { MathUtils } from "three";
import type { ZombieState } from "@zombies/shared";

/** Zombies are drawn this many seconds in the past, between two server updates. */
const INTERP_DELAY = 0.1;
const KEPT = 10;

interface Snapshot {
  t: number;
  x: number;
  z: number;
  rot: number;
}

export interface Pose {
  x: number;
  z: number;
  rot: number;
}

/** The recent server positions of one zombie, sampled slightly in the past for smooth movement. */
export class SnapshotTrack {
  private readonly snapshots: Snapshot[] = [];

  push(state: ZombieState) {
    this.snapshots.push({ t: performance.now() / 1000, x: state.x, z: state.z, rot: state.rot });
    if (this.snapshots.length > KEPT) this.snapshots.shift();
  }

  /** Writes the interpolated pose to `out`; falls back to the current state without enough history. */
  sample(state: ZombieState, out: Pose) {
    const renderTime = performance.now() / 1000 - INTERP_DELAY;
    const snaps = this.snapshots;
    out.x = state.x;
    out.z = state.z;
    out.rot = state.rot;
    for (let i = snaps.length - 1; i > 0; i--) {
      const a = snaps[i - 1]!;
      const b = snaps[i]!;
      if (a.t > renderTime) continue;
      const k = b.t > a.t ? MathUtils.clamp((renderTime - a.t) / (b.t - a.t), 0, 1) : 1;
      out.x = a.x + (b.x - a.x) * k;
      out.z = a.z + (b.z - a.z) * k;
      out.rot = a.rot + Math.atan2(Math.sin(b.rot - a.rot), Math.cos(b.rot - a.rot)) * k;
      return;
    }
  }
}
