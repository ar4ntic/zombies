import type { Vector3 } from "three";

/** Distance along a normalized ray to a sphere, or -1. */
export function raySphere(o: Vector3, d: Vector3, cx: number, cy: number, cz: number, r: number): number {
  const ox = o.x - cx;
  const oy = o.y - cy;
  const oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

/** Distance along a normalized ray to the side of an upright cylinder standing on `baseY`, or -1. */
export function rayCylinder(o: Vector3, d: Vector3, cx: number, cz: number, r: number, h: number, baseY = 0): number {
  const ox = o.x - cx;
  const oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return -1;
  const b = ox * d.x + oz * d.z;
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0) return -1;
  const y = o.y + d.y * t - baseY;
  return y >= 0 && y <= h ? t : -1;
}
