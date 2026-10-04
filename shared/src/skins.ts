export interface SkinDef {
  id: string;
  label: string;
  /** Sleeve and glove colors of the first-person arms. */
  sleeve: string;
  glove: string;
}

export const SKINS: SkinDef[] = [
  { id: "player_ranger", label: "Ranger", sleeve: "#4f6b3a", glove: "#3a2c1f" },
  { id: "player_mechanic", label: "Mechanic", sleeve: "#2f5d8c", glove: "#2a2a2e" },
  { id: "player_astronaut", label: "Astronaut", sleeve: "#e8e8ec", glove: "#e07b2c" },
  { id: "player_skater", label: "Skater", sleeve: "#c94f7c", glove: "#f1c9a5" },
  { id: "player_firefighter", label: "Firefighter", sleeve: "#d9a520", glove: "#2a2a2e" },
  { id: "player_pilot", label: "Pilot", sleeve: "#6b4a2f", glove: "#3a2c1f" },
  { id: "player_explorer", label: "Explorer", sleeve: "#b89a63", glove: "#8d5a3b" },
  { id: "player_medic", label: "Medic", sleeve: "#2fa39a", glove: "#dfe9f0" },
  { id: "player_engineer", label: "Engineer", sleeve: "#e8792b", glove: "#c9c9cf" },
  { id: "player_scientist", label: "Scientist", sleeve: "#f2f2f5", glove: "#7d5bc4" },
];

export const DEFAULT_SKIN = SKINS[0]!.id;

export function isSkin(value: unknown): value is string {
  return typeof value === "string" && SKINS.some((skin) => skin.id === value);
}

export function skinDef(id: string): SkinDef {
  return SKINS.find((skin) => skin.id === id) ?? SKINS[0]!;
}
