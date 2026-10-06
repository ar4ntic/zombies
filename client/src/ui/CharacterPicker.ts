import { DEFAULT_SKIN, SKINS, isSkin, skinDef } from "@zombies/shared";

const SKIN_KEY = "zombies.skin";

export function loadSkinChoice(): string {
  const stored = localStorage.getItem(SKIN_KEY);
  return isSkin(stored) ? stored : DEFAULT_SKIN;
}

export function saveSkinChoice(skin: string) {
  localStorage.setItem(SKIN_KEY, skin);
}

/** Portrait of a skin. Its outfit color shows through while the picture loads or when it is missing. */
export function skinAvatar(skin: string): string {
  const def = skinDef(skin);
  return `<span class="avatar" style="background-color:${def.color}"><img src="/assets/characters/thumbs/${def.id}.webp" alt="" loading="lazy" onerror="this.remove()" /></span>`;
}

/** Grid of all skins as radio buttons; `onPick` runs when another one is chosen. Skins without a portrait are not offered. */
export function characterPicker(selected: string, onPick: (skin: string) => void): HTMLElement {
  const el = document.createElement("div");
  el.className = "character-picker";
  el.setAttribute("role", "radiogroup");
  el.setAttribute("aria-label", "Character");
  el.innerHTML = SKINS.map(
    (skin) =>
      `<button type="button" role="radio" data-skin="${skin.id}" aria-checked="${skin.id === selected}">${skinAvatar(skin.id)}<span class="label">${skin.label}</span></button>`,
  ).join("");
  for (const image of el.querySelectorAll<HTMLImageElement>("img")) {
    image.removeAttribute("onerror");
    image.addEventListener("error", () => image.closest("button")?.remove());
  }
  el.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-skin]");
    if (!button) return;
    for (const option of el.querySelectorAll<HTMLElement>("button")) option.setAttribute("aria-checked", String(option === button));
    onPick(button.dataset.skin!);
  });
  return el;
}
