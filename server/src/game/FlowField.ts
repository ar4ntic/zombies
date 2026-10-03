import { pointInBox, type Box, type Vec2 } from "@zombies/shared";

const CELL = 0.5;
const DIAGONAL = Math.SQRT2;
const NEIGHBORS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, DIAGONAL],
  [1, -1, DIAGONAL],
  [-1, 1, DIAGONAL],
  [-1, -1, DIAGONAL],
];

/**
 * Grid of walking distances to the nearest target. Zombies walk "downhill" on it, which
 * routes every zombie around obstacles towards its closest player with one search.
 */
export class FlowField {
  private readonly size: number;
  private readonly min: number;
  private readonly blocked: Uint8Array;
  private readonly dist: Float64Array;
  private readonly heap = new MinHeap();

  constructor(extent: number, boxes: Box[], clearance: number) {
    this.min = -extent;
    this.size = Math.ceil((extent * 2) / CELL);
    this.blocked = new Uint8Array(this.size * this.size);
    this.dist = new Float64Array(this.size * this.size).fill(Infinity);
    for (let iz = 0; iz < this.size; iz++) {
      for (let ix = 0; ix < this.size; ix++) {
        const x = this.min + (ix + 0.5) * CELL;
        const z = this.min + (iz + 0.5) * CELL;
        if (boxes.some((b) => pointInBox(b, x, z, clearance))) this.blocked[iz * this.size + ix] = 1;
      }
    }
  }

  private cellOf(x: number, z: number): [number, number] {
    return [Math.floor((x - this.min) / CELL), Math.floor((z - this.min) / CELL)];
  }

  private inside(ix: number, iz: number): boolean {
    return ix >= 0 && iz >= 0 && ix < this.size && iz < this.size;
  }

  compute(targets: Vec2[]) {
    this.dist.fill(Infinity);
    this.heap.clear();
    for (const t of targets) {
      const [ix, iz] = this.cellOf(t.x, t.z);
      if (!this.inside(ix, iz)) continue;
      const i = iz * this.size + ix;
      this.dist[i] = 0;
      this.heap.push(i, 0);
    }
    while (this.heap.length > 0) {
      const [i, d] = this.heap.pop();
      if (d > this.dist[i]!) continue;
      const ix = i % this.size;
      const iz = (i - ix) / this.size;
      for (const [ox, oz, cost] of NEIGHBORS) {
        const nx = ix + ox;
        const nz = iz + oz;
        if (!this.inside(nx, nz)) continue;
        const n = nz * this.size + nx;
        if (this.blocked[n]) continue;
        if (ox !== 0 && oz !== 0 && (this.blocked[iz * this.size + nx] || this.blocked[nz * this.size + ix])) continue;
        const nd = d + cost;
        if (nd < this.dist[n]!) {
          this.dist[n] = nd;
          this.heap.push(n, nd);
        }
      }
    }
  }

  /** Point to steer towards from (x, z), or null when no path exists. */
  nextWaypoint(x: number, z: number): Vec2 | null {
    const [ix, iz] = this.cellOf(x, z);
    if (!this.inside(ix, iz)) return null;
    let best = this.dist[iz * this.size + ix]!;
    let bx = -1;
    let bz = -1;
    for (const [ox, oz] of NEIGHBORS) {
      const nx = ix + ox;
      const nz = iz + oz;
      if (!this.inside(nx, nz)) continue;
      const d = this.dist[nz * this.size + nx]!;
      if (d < best) {
        best = d;
        bx = nx;
        bz = nz;
      }
    }
    if (bx < 0) return null;
    return { x: this.min + (bx + 0.5) * CELL, z: this.min + (bz + 0.5) * CELL };
  }
}

class MinHeap {
  private readonly items: number[] = [];
  private readonly prio: number[] = [];

  get length(): number {
    return this.items.length;
  }

  clear() {
    this.items.length = 0;
    this.prio.length = 0;
  }

  push(item: number, priority: number) {
    this.items.push(item);
    this.prio.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent]! <= priority) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.items[0]!, this.prio[0]!];
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l]! < this.prio[m]!) m = l;
        if (r < this.items.length && this.prio[r]! < this.prio[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.prio[a], this.prio[b]] = [this.prio[b]!, this.prio[a]!];
  }
}
