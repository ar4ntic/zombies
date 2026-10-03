import {
  DEFAULT_DIFFICULTY,
  DEFAULT_ROUND_MINUTES,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  NICKNAME_MAX_LENGTH,
  ROUND_MINUTES,
  SESSION_CODE_LENGTH,
  isDifficulty,
  isRoundMinutes,
  type DifficultyId,
} from "@zombies/shared";
import type { SessionChoice } from "../game/Game.ts";

const NAME_KEY = "zombies.nickname";
const DIFFICULTY_KEY = "zombies.difficulty";
const MINUTES_KEY = "zombies.minutes";

export interface GameSettings {
  difficulty: DifficultyId;
  minutes: number;
}

export interface MenuResult {
  name: string;
  choice: SessionChoice;
  settings: GameSettings;
}

function loadSettings(): GameSettings {
  const difficulty = localStorage.getItem(DIFFICULTY_KEY);
  const minutes = Number(localStorage.getItem(MINUTES_KEY));
  return {
    difficulty: isDifficulty(difficulty) ? difficulty : DEFAULT_DIFFICULTY,
    minutes: isRoundMinutes(minutes) ? minutes : DEFAULT_ROUND_MINUTES,
  };
}

function segmented(name: string, options: Array<[string, string]>, selected: string): string {
  return (
    `<div class="segmented" role="radiogroup" data-setting="${name}">` +
    options
      .map(([value, label]) => `<button type="button" role="radio" data-value="${value}" aria-checked="${value === selected}">${label}</button>`)
      .join("") +
    `</div>`
  );
}

export function showMenu(root: HTMLElement, inviteCode: string | null, errorMessage?: string): Promise<MenuResult> {
  const settings = loadSettings();
  const panel = document.createElement("div");
  panel.className = "menu";
  panel.innerHTML = `
    <h1>Zombie Breakout</h1>
    <p class="tagline">Clear the streets. Save the town.</p>
    <label>Your nickname
      <input name="nickname" maxlength="${NICKNAME_MAX_LENGTH}" autocomplete="off" placeholder="e.g. ShadowFox" />
    </label>
    <div class="setting">
      <span class="setting-label">Difficulty</span>
      ${segmented("difficulty", DIFFICULTY_IDS.map((id) => [id, DIFFICULTIES[id].label]), settings.difficulty)}
    </div>
    <div class="setting">
      <span class="setting-label">Round length</span>
      ${segmented("minutes", ROUND_MINUTES.map((m) => [String(m), `${m} min`]), String(settings.minutes))}
    </div>
    <div class="buttons">
      <button data-action="solo" class="primary">Single player</button>
      <button data-action="create">Create team session</button>
    </div>
    <div class="join">
      <input name="code" maxlength="${SESSION_CODE_LENGTH}" autocomplete="off" placeholder="Session code" />
      <button data-action="join">Join</button>
    </div>
    <p class="join-hint">Joining players use the host's difficulty and round length.</p>
    <p class="error" hidden></p>
  `;
  root.append(panel);

  const nameInput = panel.querySelector<HTMLInputElement>('input[name="nickname"]')!;
  const codeInput = panel.querySelector<HTMLInputElement>('input[name="code"]')!;
  const error = panel.querySelector<HTMLParagraphElement>(".error")!;
  nameInput.value = localStorage.getItem(NAME_KEY) ?? "";
  if (inviteCode) codeInput.value = inviteCode;
  if (errorMessage) showError(errorMessage);
  (nameInput.value ? (inviteCode ? panel.querySelector<HTMLButtonElement>('[data-action="join"]')! : panel.querySelector<HTMLButtonElement>('[data-action="solo"]')!) : nameInput).focus();

  return new Promise((resolve) => {
    panel.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
      const group = button?.closest<HTMLElement>(".segmented");
      if (button && group) {
        for (const option of group.querySelectorAll("button")) option.setAttribute("aria-checked", String(option === button));
        const value = button.dataset.value!;
        if (group.dataset.setting === "difficulty") {
          settings.difficulty = value as DifficultyId;
          localStorage.setItem(DIFFICULTY_KEY, value);
        } else {
          settings.minutes = Number(value);
          localStorage.setItem(MINUTES_KEY, value);
        }
        return;
      }

      const action = button?.dataset.action;
      if (!action) return;
      const name = nameInput.value.trim();
      if (!name) return showError("Please enter a nickname.");
      localStorage.setItem(NAME_KEY, name);

      let choice: SessionChoice;
      if (action === "join") {
        const code = codeInput.value.trim().toUpperCase();
        if (code.length !== SESSION_CODE_LENGTH) return showError("Session codes have 6 characters.");
        choice = { mode: "join", code };
      } else {
        choice = { mode: action as "solo" | "create" };
      }
      panel.remove();
      resolve({ name, choice, settings });
    });
  });

  function showError(message: string) {
    error.textContent = message;
    error.hidden = false;
  }
}

export function showMessage(root: HTMLElement, message: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "overlay-message";
  el.textContent = message;
  root.append(el);
  return el;
}
