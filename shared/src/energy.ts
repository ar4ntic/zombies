/** Whether the rifle's spare energy is unlimited or has to be collected from capsules in the arena. */
export type EnergyMode = "infinite" | "limited";

export const ENERGY_MODES: Record<EnergyMode, { id: EnergyMode; label: string }> = {
  limited: { id: "limited", label: "Limited" },
  infinite: { id: "infinite", label: "Infinite" },
};

export const ENERGY_MODE_IDS = Object.keys(ENERGY_MODES) as EnergyMode[];
export const DEFAULT_ENERGY_MODE: EnergyMode = "limited";

export function isEnergyMode(value: unknown): value is EnergyMode {
  return typeof value === "string" && Object.hasOwn(ENERGY_MODES, value);
}
