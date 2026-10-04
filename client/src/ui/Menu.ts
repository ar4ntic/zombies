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
import { Leaderboard } from "./Leaderboard.ts";
import { segmented, selectSegment } from "./segmented.ts";
import { settingsControls, type SettingsTarget } from "./Settings.ts";

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

export function saveSettings(settings: GameSettings) {
  localStorage.setItem(DIFFICULTY_KEY, settings.difficulty);
  localStorage.setItem(MINUTES_KEY, String(settings.minutes));
}

export function settingsSelectors(settings: GameSettings): string {
  return `
    <div class="setting">
      <span class="setting-label">Difficulty</span>
      ${segmented("difficulty", DIFFICULTY_IDS.map((id) => [id, DIFFICULTIES[id].label]), settings.difficulty)}
    </div>
    <div class="setting">
      <span class="setting-label">Round length</span>
      ${segmented("minutes", ROUND_MINUTES.map((m) => [String(m), `${m} min`]), String(settings.minutes))}
    </div>`;
}

export function showMenu(root: HTMLElement, device: SettingsTarget, inviteCode: string | null, errorMessage?: string): Promise<MenuResult> {
  const settings = loadSettings();
  const panel = document.createElement("div");
  panel.className = "menu";
  panel.innerHTML = `
    <div class="menu-main" data-view="main">
      <h1>Zombie Breakout</h1>
      <p class="tagline">Clear the streets. Save the town.</p>
      <label>Your nickname
        <input name="nickname" maxlength="${NICKNAME_MAX_LENGTH}" autocomplete="off" placeholder="e.g. ShadowFox" />
      </label>
      ${settingsSelectors(settings)}
      <div class="buttons">
        <button data-action="solo" class="primary">Single player</button>
        <button data-action="create">Create team session</button>
      </div>
      <div class="join">
        <input name="code" maxlength="${SESSION_CODE_LENGTH}" autocomplete="off" placeholder="Session code" />
        <button data-action="join">Join</button>
      </div>
      <p class="join-hint">Joining players use the host's difficulty and round length.</p>
      <button type="button" data-action="settings">Settings</button>
      <p class="error" hidden></p>
    </div>
    <div class="menu-main" data-view="settings" hidden>
      <h1>Settings</h1>
      <p class="tagline">Saved on this device.</p>
      <button type="button" class="primary" data-action="back">Back</button>
    </div>
  `;
  const main = panel.querySelector<HTMLElement>('[data-view="main"]')!;
  const settingsView = panel.querySelector<HTMLElement>('[data-view="settings"]')!;
  settingsView.querySelector(".tagline")!.after(settingsControls(device));
  const nameInput = panel.querySelector<HTMLInputElement>('input[name="nickname"]')!;
  const codeInput = panel.querySelector<HTMLInputElement>('input[name="code"]')!;
  const error = panel.querySelector<HTMLParagraphElement>(".error")!;
  nameInput.value = localStorage.getItem(NAME_KEY) ?? "";

  const board = new Leaderboard("Top survivors");
  const showBoard = () => void board.show(settings.difficulty, settings.minutes, nameInput.value.trim());
  panel.append(board.el);
  showBoard();
  nameInput.addEventListener("change", showBoard);
  root.append(panel);

  if (inviteCode) codeInput.value = inviteCode;
  if (errorMessage) showError(errorMessage);
  const startButton = panel.querySelector<HTMLButtonElement>(`[data-action="${inviteCode ? "join" : "solo"}"]`)!;
  (nameInput.value ? startButton : nameInput).focus();

  const showSettings = (show: boolean) => {
    main.hidden = show;
    settingsView.hidden = !show;
    panel.querySelector<HTMLButtonElement>(`[data-action="${show ? "back" : "settings"}"]`)!.focus();
  };
  settingsView.querySelector('[data-action="back"]')!.addEventListener("click", () => showSettings(false));

  return new Promise((resolve) => {
    main.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
      const group = button?.closest<HTMLElement>(".segmented");
      if (button && group) {
        const value = button.dataset.value!;
        selectSegment(group, value);
        if (group.dataset.setting === "difficulty") settings.difficulty = value as DifficultyId;
        else settings.minutes = Number(value);
        saveSettings(settings);
        showBoard();
        return;
      }

      const action = button?.dataset.action;
      if (!action) return;
      if (action === "settings") return showSettings(true);
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
