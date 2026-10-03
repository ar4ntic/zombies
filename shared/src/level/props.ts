/** Ground-plane bounds of prop models (from their glTF bounding boxes) that block movement. */
export const PROP_BOUNDS: Record<string, { minX: number; maxX: number; minZ: number; maxZ: number; height: number }> = {
  barrel_03: { minX: -0.32, maxX: 0.32, minZ: -0.32, maxZ: 0.32, height: 0.93 },
  concrete_road_barrier: { minX: -0.77, maxX: 0.77, minZ: -0.29, maxZ: 0.34, height: 0.82 },
  covered_car: { minX: -0.85, maxX: 0.94, minZ: -2.17, maxZ: 2.21, height: 1.41 },
  fire_hydrant: { minX: -0.2, maxX: 0.2, minZ: -0.13, maxZ: 0.19, height: 0.8 },
  metal_trash_can: { minX: -0.3, maxX: 0.3, minZ: -0.28, maxZ: 0.28, height: 0.91 },
  old_military_crate: { minX: -0.91, maxX: 0.9, minZ: -0.67, maxZ: 0.31, height: 0.3 },
  portable_generator: { minX: -0.41, maxX: 0.4, minZ: -0.28, maxZ: 0.28, height: 0.58 },
  street_lamp_01: { minX: -0.15, maxX: 0.15, minZ: -0.15, maxZ: 0.15, height: 3.87 },
  utility_box_01: { minX: -0.26, maxX: 0.26, minZ: -0.21, maxZ: 0.22, height: 1.12 },
  wooden_crate_02: { minX: -0.26, maxX: 0.26, minZ: -0.58, maxZ: 0.58, height: 0.45 },
  wooden_picnic_table: { minX: -1.12, maxX: 1.12, minZ: -1.5, maxZ: 1.52, height: 0.75 },
};
