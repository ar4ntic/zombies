import {
  DEFAULT_DIFFICULTY,
  DEFAULT_ENERGY_MODE,
  DEFAULT_ROUND_MINUTES,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  ENERGY_MODES,
  ENERGY_MODE_IDS,
  NICKNAME_MAX_LENGTH,
  ROUND_MINUTES,
  SESSION_CODE_LENGTH,
  isDifficulty,
  isEnergyMode,
  isRoundMinutes,
  skinDef,
  type AccountInfo,
  type DifficultyId,
  type EnergyMode,
} from "@zombies/shared";
import type { SessionChoice } from "../game/Game.ts";
import { accountApi, checkNickname } from "../net/account.ts";
import { accountView } from "./Account.ts";
import { characterPicker, loadSkinChoice, saveSkinChoice, skinAvatar } from "./CharacterPicker.ts";
import { Leaderboard } from "./Leaderboard.ts";
import { segmented, selectSegment } from "./segmented.ts";
import { settingsControls, type SettingsTarget } from "./Settings.ts";

const NAME_KEY = "zombies.nickname";
const DIFFICULTY_KEY = "zombies.difficulty";
const MINUTES_KEY = "zombies.minutes";
const ENERGY_KEY = "zombies.energy";

export interface GameSettings {
  difficulty: DifficultyId;
  minutes: number;
  energy: EnergyMode;
}

export interface MenuResult {
  name: string;
  choice: SessionChoice;
  settings: GameSettings;
  skin: string;
}

function loadSettings(): GameSettings {
  const difficulty = localStorage.getItem(DIFFICULTY_KEY);
  const minutes = Number(localStorage.getItem(MINUTES_KEY));
  const energy = localStorage.getItem(ENERGY_KEY);
  return {
    difficulty: isDifficulty(difficulty) ? difficulty : DEFAULT_DIFFICULTY,
    minutes: isRoundMinutes(minutes) ? minutes : DEFAULT_ROUND_MINUTES,
    energy: isEnergyMode(energy) ? energy : DEFAULT_ENERGY_MODE,
  };
}

export function saveSettings(settings: GameSettings) {
  localStorage.setItem(DIFFICULTY_KEY, settings.difficulty);
  localStorage.setItem(MINUTES_KEY, String(settings.minutes));
  localStorage.setItem(ENERGY_KEY, settings.energy);
}

/** The round setting a click on one of the segmented controls of `settingsSelectors` stands for. */
export function settingChange(setting: string | undefined, value: string): Partial<GameSettings> | undefined {
  switch (setting) {
    case "difficulty":
      return isDifficulty(value) ? { difficulty: value } : undefined;
    case "minutes":
      return isRoundMinutes(Number(value)) ? { minutes: Number(value) } : undefined;
    case "energy":
      return isEnergyMode(value) ? { energy: value } : undefined;
  }
  return undefined;
}

/** The selected value of each segmented control of `settingsSelectors`. */
export function settingValue(setting: string | undefined, settings: GameSettings): string {
  return setting === "difficulty" ? settings.difficulty : setting === "energy" ? settings.energy : String(settings.minutes);
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
    </div>
    <div class="setting">
      <span class="setting-label">Rifle energy</span>
      ${segmented("energy", ENERGY_MODE_IDS.map((id) => [id, ENERGY_MODES[id].label]), settings.energy)}
      <span class="setting-hint">Limited: collect the energy capsules lying around the arena.</span>
    </div>`;
}

/** What the menu opens with after following a link from an account mail. */
export interface MenuStart {
  /** Shown above the buttons, e.g. the outcome of confirming an email address. */
  notice?: string;
  /** Token of a password reset link; opens the account view to choose a new password. */
  resetToken?: string;
}

export function showMenu(
  root: HTMLElement,
  device: SettingsTarget,
  inviteCode: string | null,
  errorMessage?: string,
  start: MenuStart = {},
): Promise<MenuResult> {
  const settings = loadSettings();
  let skin = loadSkinChoice();
  const panel = document.createElement("div");
  panel.className = "menu";
  panel.innerHTML = `
    <div class="menu-main" data-view="main">
      <h1>Zombie Breakout</h1>
      <p class="tagline">Clear the streets. Save the town.</p>
      <label>Your nickname
        <input name="nickname" maxlength="${NICKNAME_MAX_LENGTH}" autocomplete="off" placeholder="e.g. ShadowFox" />
      </label>
      <button type="button" class="link account-link" data-action="account"></button>
      <button type="button" class="character" data-action="character"></button>
      ${settingsSelectors(settings)}
      <div class="buttons">
        <button data-action="solo" class="primary">Single player</button>
        <button data-action="create">Create team session</button>
      </div>
      <div class="join">
        <input name="code" maxlength="${SESSION_CODE_LENGTH}" autocomplete="off" placeholder="Session code" />
        <button data-action="join">Join</button>
      </div>
      <p class="join-hint">Joining players use the host's round settings.</p>
      <button type="button" data-action="settings">Settings</button>
      <p class="notice" hidden></p>
      <p class="error" hidden></p>
    </div>
    <div class="menu-main" data-view="settings" hidden>
      <h1>Settings</h1>
      <p class="tagline">Saved on this device.</p>
      <button type="button" class="primary" data-action="back">Back</button>
    </div>
    <div class="menu-main" data-view="character" hidden>
      <h1>Character</h1>
      <p class="tagline">How your team sees you.</p>
      <button type="button" class="primary" data-action="back">Done</button>
    </div>
    <div class="menu-main" data-view="account" hidden>
      <h1>Account</h1>
      <p class="tagline">Protect your nickname.</p>
      <button type="button" data-action="back">Back</button>
    </div>
  `;
  const main = panel.querySelector<HTMLElement>('[data-view="main"]')!;
  const settingsView = panel.querySelector<HTMLElement>('[data-view="settings"]')!;
  settingsView.querySelector(".tagline")!.after(settingsControls(device));
  const characterView = panel.querySelector<HTMLElement>('[data-view="character"]')!;
  const characterButton = panel.querySelector<HTMLButtonElement>('[data-action="character"]')!;
  const showCharacter = () => {
    characterButton.innerHTML = `${skinAvatar(skin)}<span class="label">${skinDef(skin).label}</span><span class="change">Change character</span>`;
  };
  showCharacter();
  characterView.querySelector(".tagline")!.after(
    characterPicker(skin, (picked) => {
      skin = picked;
      saveSkinChoice(skin);
      showCharacter();
    }),
  );
  const nameInput = panel.querySelector<HTMLInputElement>('input[name="nickname"]')!;
  const codeInput = panel.querySelector<HTMLInputElement>('input[name="code"]')!;
  const error = panel.querySelector<HTMLParagraphElement>('[data-view="main"] .error')!;
  const notice = panel.querySelector<HTMLParagraphElement>('[data-view="main"] .notice')!;
  // The nickname typed for playing without an account, kept while an account's nickname is shown instead.
  let typedName = localStorage.getItem(NAME_KEY) ?? "";
  nameInput.addEventListener("input", () => {
    if (!nameInput.readOnly) typedName = nameInput.value;
  });

  const board = new Leaderboard("Top survivors");
  const showBoard = () => void board.show(settings.difficulty, settings.minutes, settings.energy, nameInput.value.trim());

  // A logged-in account plays under its own nickname; everybody else types one.
  const accountPanel = panel.querySelector<HTMLElement>('[data-view="account"]')!;
  const accountButton = panel.querySelector<HTMLButtonElement>('[data-action="account"]')!;
  let account: AccountInfo | null = null;
  const showAccount = (next: AccountInfo | null) => {
    account = next;
    const fixed = account?.nickname ?? null;
    nameInput.readOnly = fixed !== null;
    nameInput.value = fixed ?? typedName;
    accountButton.textContent = !account
      ? "Log in or register to protect your nickname"
      : !account.nickname
        ? "Logged in · choose your protected nickname"
        : account.verified
          ? "✓ Protected nickname · Account"
          : "Confirm your email to protect this nickname · Account";
    showBoard();
  };
  const accountForms = accountView((next) => showAccount(next));
  accountPanel.querySelector(".tagline")!.after(accountForms.el);

  panel.append(board.el);
  showAccount(null);
  nameInput.addEventListener("change", showBoard);
  root.append(panel);
  void accountApi.me().then(({ account: current }) => {
    if (!current) return;
    accountForms.setAccount(current);
    showAccount(current);
  });

  if (inviteCode) codeInput.value = inviteCode;
  if (errorMessage) showError(errorMessage);
  if (start.notice) {
    notice.textContent = start.notice;
    notice.hidden = false;
  }
  const startButton = panel.querySelector<HTMLButtonElement>(`[data-action="${inviteCode ? "join" : "solo"}"]`)!;
  (nameInput.value ? startButton : nameInput).focus();

  /** Shows one of the other views, or the main view again when called with nothing. */
  const showView = (view?: HTMLElement, returnTo = "settings") => {
    main.hidden = view !== undefined;
    for (const other of [settingsView, characterView, accountPanel]) other.hidden = view !== other;
    (view ?? main).querySelector<HTMLButtonElement>(`[data-action="${view ? "back" : returnTo}"]`)!.focus();
  };
  settingsView.querySelector('[data-action="back"]')!.addEventListener("click", () => showView());
  characterView.querySelector('[data-action="back"]')!.addEventListener("click", () => showView(undefined, "character"));
  accountPanel.querySelector('[data-action="back"]')!.addEventListener("click", () => showView(undefined, "account"));
  if (start.resetToken) {
    accountForms.startReset(start.resetToken);
    showView(accountPanel);
  }

  let starting = false;
  return new Promise((resolve) => {
    main.addEventListener("click", async (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
      const group = button?.closest<HTMLElement>(".segmented");
      if (button && group) {
        const value = button.dataset.value!;
        selectSegment(group, value);
        Object.assign(settings, settingChange(group.dataset.setting, value));
        saveSettings(settings);
        showBoard();
        return;
      }

      const action = button?.dataset.action;
      if (!action) return;
      if (action === "settings") return showView(settingsView);
      if (action === "character") return showView(characterView);
      if (action === "account") return showView(accountPanel);
      const name = nameInput.value.trim();
      if (!name) return showError("Please enter a nickname.");
      if (!account?.nickname) localStorage.setItem(NAME_KEY, name);

      let choice: SessionChoice;
      if (action === "join") {
        const code = codeInput.value.trim().toUpperCase();
        if (code.length !== SESSION_CODE_LENGTH) return showError("Session codes have 6 characters.");
        choice = { mode: "join", code };
      } else {
        choice = { mode: action as "solo" | "create" };
      }
      if (starting) return;
      starting = true;
      const owned = account?.nickname ? undefined : await checkNickname(name);
      starting = false;
      if (owned?.protected && !owned.mine) return showError("This nickname is protected. Log in to use it, or pick another one.");
      panel.remove();
      resolve({ name, choice, settings, skin });
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
