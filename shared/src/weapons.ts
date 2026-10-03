export type WeaponId = "pistol" | "rifle";

export interface WeaponDef {
  name: string;
  damage: number;
  headshotMultiplier: number;
  /** Seconds between shots. */
  fireInterval: number;
  automatic: boolean;
  magazine: number;
  /** Spare ammo at the start of a level. Infinity means unlimited. */
  startReserve: number;
  maxReserve: number;
  reloadTime: number;
  range: number;
  /** Base spread in radians while hip firing. */
  spread: number;
  /** Extra spread added per shot, recovering over time. */
  spreadPerShot: number;
  maxSpread: number;
  /** Camera pitch kick per shot in radians. */
  recoil: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    name: "Pulse Pistol",
    damage: 34,
    headshotMultiplier: 2.5,
    fireInterval: 0.2,
    automatic: false,
    magazine: 12,
    startReserve: Infinity,
    maxReserve: Infinity,
    reloadTime: 1.2,
    range: 60,
    spread: 0.006,
    spreadPerShot: 0.01,
    maxSpread: 0.04,
    recoil: 0.018,
  },
  rifle: {
    name: "Storm Rifle",
    damage: 24,
    headshotMultiplier: 2.2,
    fireInterval: 0.095,
    automatic: true,
    magazine: 30,
    startReserve: 120,
    maxReserve: 240,
    reloadTime: 2.0,
    range: 90,
    spread: 0.01,
    spreadPerShot: 0.006,
    maxSpread: 0.06,
    recoil: 0.009,
  },
};

export const WEAPON_ORDER: WeaponId[] = ["pistol", "rifle"];

/** Fraction of spread kept while aiming down sights. */
export const ADS_SPREAD_FACTOR = 0.35;
