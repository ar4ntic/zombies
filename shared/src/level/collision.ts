import { PROP_BOUNDS, PROP_PARTS } from "./props.ts";
import type { Box, LevelDef, Vec2 } from "./types.ts";

export function buildColliders(level: LevelDef): Box[] {
  const boxes: Box[] = [];
  for (const s of level.structures) {
    boxes.push({ x: s.x, z: s.z, hx: s.width / 2, hz: s.depth / 2, rot: s.rotation ?? 0, height: s.height });
  }
  for (const p of level.props) {
    const bounds = PROP_BOUNDS[p.model];
    const rot = p.rotation ?? 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    for (const b of PROP_PARTS[p.model] ?? (bounds ? [bounds] : [])) {
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      boxes.push({
        x: p.x + cx * cos + cz * sin,
        z: p.z - cx * sin + cz * cos,
        hx: (b.maxX - b.minX) / 2,
        hz: (b.maxZ - b.minZ) / 2,
        rot,
        height: b.height,
      });
    }
  }
  for (const l of level.lamps) {
    const b = PROP_BOUNDS.street_lamp_01!;
    boxes.push({ x: l.x, z: l.z, hx: b.maxX, hz: b.maxZ, rot: 0, height: b.height });
  }
  return boxes;
}

/** World XZ offset to box-local coordinates (inverse of a rotation about Y). */
function toLocal(box: Box, x: number, z: number): [number, number] {
  const dx = x - box.x;
  const dz = z - box.z;
  const cos = Math.cos(box.rot);
  const sin = Math.sin(box.rot);
  return [dx * cos - dz * sin, dx * sin + dz * cos];
}

function toWorldDir(box: Box, lx: number, lz: number): [number, number] {
  const cos = Math.cos(box.rot);
  const sin = Math.sin(box.rot);
  return [lx * cos + lz * sin, -lx * sin + lz * cos];
}

/**
 * Pushes a circle out of every box it overlaps. Mutates `pos`. Returns true on contact.
 * Boxes no taller than `above` are skipped, so something standing at that height can move over them.
 */
export function resolveCircle(pos: Vec2, radius: number, boxes: Box[], above = -Infinity): boolean {
  let hit = false;
  for (const box of boxes) {
    if (box.height <= above) continue;
    const [lx, lz] = toLocal(box, pos.x, pos.z);
    if (Math.abs(lx) > box.hx + radius || Math.abs(lz) > box.hz + radius) continue;
    const cx = Math.max(-box.hx, Math.min(box.hx, lx));
    const cz = Math.max(-box.hz, Math.min(box.hz, lz));
    let nx = lx - cx;
    let nz = lz - cz;
    const distSq = nx * nx + nz * nz;
    let push: number;
    if (distSq > 1e-8) {
      const dist = Math.sqrt(distSq);
      if (dist >= radius) continue;
      nx /= dist;
      nz /= dist;
      push = radius - dist;
    } else {
      const px = box.hx - Math.abs(lx);
      const pz = box.hz - Math.abs(lz);
      if (px < pz) {
        nx = Math.sign(lx) || 1;
        nz = 0;
        push = px + radius;
      } else {
        nx = 0;
        nz = Math.sign(lz) || 1;
        push = pz + radius;
      }
    }
    const [wx, wz] = toWorldDir(box, nx * push, nz * push);
    pos.x += wx;
    pos.z += wz;
    hit = true;
  }
  return hit;
}

export function pointInBox(box: Box, x: number, z: number, inflate = 0): boolean {
  const [lx, lz] = toLocal(box, x, z);
  return Math.abs(lx) <= box.hx + inflate && Math.abs(lz) <= box.hz + inflate;
}

/** Top of the highest box under a point that is no higher than `maxHeight`, or 0 for the ground. */
export function surfaceHeight(x: number, z: number, boxes: Box[], maxHeight = Infinity, inflate = 0): number {
  let top = 0;
  for (const box of boxes) {
    if (box.height > top && box.height <= maxHeight && pointInBox(box, x, z, inflate)) top = box.height;
  }
  return top;
}

/**
 * Distance along a 3D ray to the first box it enters, or Infinity.
 * `dir` must be normalized.
 */
export function raycastBoxes(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  boxes: Box[],
): number {
  let best = maxDist;
  if (dy < 0) {
    const tGround = -oy / dy;
    if (tGround < best) best = tGround;
  }
  for (const box of boxes) {
    const [lox, loz] = toLocal(box, ox, oz);
    const cos = Math.cos(box.rot);
    const sin = Math.sin(box.rot);
    const ldx = dx * cos - dz * sin;
    const ldz = dx * sin + dz * cos;
    const t = slab(lox, oy, loz, ldx, dy, ldz, -box.hx, 0, -box.hz, box.hx, box.height, box.hz);
    if (t >= 0 && t < best) best = t;
  }
  return best === maxDist ? Infinity : best;
}

function slab(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): number {
  let tmin = -Infinity;
  let tmax = Infinity;
  const axes: Array<[number, number, number, number]> = [
    [ox, dx, minX, maxX],
    [oy, dy, minY, maxY],
    [oz, dz, minZ, maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}
