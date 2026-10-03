import type { StructurePlacement } from "./types.ts";

/** Brick walls around a square arena with a gate in the middle of each side. */
export function perimeterWalls(
  halfSize: number,
  gateWidth: number,
  height: number,
  thickness = 0.6,
): StructurePlacement[] {
  const segment = halfSize - gateWidth / 2 + thickness / 2;
  const offset = halfSize + thickness / 2;
  const center = (gateWidth / 2 + halfSize + thickness) / 2;
  const walls: StructurePlacement[] = [];
  for (const sign of [-1, 1]) {
    for (const along of [-1, 1]) {
      walls.push({ texture: "red_brick_03", x: along * center, z: sign * offset, width: segment, depth: thickness, height, tile: 2.5 });
      walls.push({ texture: "red_brick_03", x: sign * offset, z: along * center, width: thickness, depth: segment, height, tile: 2.5 });
    }
  }
  return walls;
}
