export interface SkinDef {
  id: string;
  label: string;
  /** Color of the outfit, which marks the player on the map and on their name tag. */
  color: string;
  /** What the first-person arms wear, as on the skin's model: the color of a sleeve or glove, or null for bare skin. */
  forearm: string | null;
  hand: string | null;
}

export const SKINS: SkinDef[] = [
  { id: "player_ranger", label: "Ranger", color: "#4f8a3c", forearm: "#4f8a3c", hand: null },
  { id: "player_mechanic", label: "Mechanic", color: "#2f5d8c", forearm: null, hand: "#26262a" },
  { id: "player_astronaut", label: "Astronaut", color: "#e8e8ec", forearm: "#e8e8ec", hand: "#e07b2c" },
  { id: "player_skater", label: "Skater", color: "#d9538a", forearm: "#d9538a", hand: null },
  { id: "player_firefighter", label: "Firefighter", color: "#e0b020", forearm: "#e0b020", hand: "#2a2a2e" },
  { id: "player_pilot", label: "Pilot", color: "#8a5632", forearm: "#8a5632", hand: "#3a2c1f" },
  { id: "player_explorer", label: "Explorer", color: "#b89a63", forearm: null, hand: null },
  { id: "player_medic", label: "Medic", color: "#2fa39a", forearm: null, hand: "#f1f4f7" },
  { id: "player_engineer", label: "Engineer", color: "#e8792b", forearm: null, hand: "#55585e" },
  { id: "player_scientist", label: "Scientist", color: "#7d5bc4", forearm: "#f2f2f5", hand: "#7d5bc4" },
];

export const DEFAULT_SKIN = SKINS[0]!.id;

export function isSkin(value: unknown): value is string {
  return typeof value === "string" && SKINS.some((skin) => skin.id === value);
}

export function skinDef(id: string): SkinDef {
  return SKINS.find((skin) => skin.id === id) ?? SKINS[0]!;
}
