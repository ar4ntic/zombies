import { MAX_PLAYERS, settingsLabel, type DifficultyId, type EnergyMode, type GameState } from "@zombies/shared";
import type { Game } from "../game/Game.ts";
import { characterPicker, loadSkinChoice, saveSkinChoice, skinAvatar } from "./CharacterPicker.ts";
import { copyText } from "./clipboard.ts";
import { saveSettings, settingChange, settingValue, settingsSelectors, type GameSettings } from "./Menu.ts";
import { selectSegment } from "./segmented.ts";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function roundSettings(state: GameState): GameSettings {
  return { difficulty: state.difficulty as DifficultyId, minutes: state.duration / 60, energy: state.energy as EnergyMode };
}

/** Team session waiting room: invite friends, pick settings, host starts the round. */
export class Lobby {
  readonly el = document.createElement("div");
  private readonly $: Record<string, HTMLElement> = {};
  private readonly cache = new Map<HTMLElement, string>();

  constructor(private readonly game: Game) {
    const code = game.network.sessionCode ?? "";
    const link = `${location.origin}/join/${code}`;
    const state = game.state!;
    this.el.className = "menu lobby";
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="menu-main">
        <h1>Team lobby</h1>
        <div class="lobby-code">
          <span class="setting-label">Session code</span>
          <div class="lobby-copy">
            <strong>${escapeHtml(code)}</strong>
            <button type="button" data-action="copyCode">Copy code</button>
          </div>
        </div>
        <div class="lobby-copy">
          <input readonly value="${escapeHtml(link)}" aria-label="Invite link" />
          <button type="button" data-action="copyLink">Copy link</button>
        </div>
        <button type="button" data-action="share" ${"share" in navigator ? "" : "hidden"}>Share invite</button>
        <div data-ref="hostSettings">${settingsSelectors(roundSettings(state))}</div>
        <p class="settings-tag" data-ref="settings"></p>
        <div data-ref="picker" hidden></div>
        <p class="hint" data-ref="hint"></p>
        <div class="buttons">
          <button type="button" class="primary" data-ref="start" data-action="start">Start game</button>
          <button type="button" data-ref="character" data-action="character">Change character</button>
          <button type="button" data-action="leave">Leave</button>
        </div>
      </div>
      <aside class="lobby-players">
        <h3>Players <span data-ref="count"></span></h3>
        <ul data-ref="players"></ul>
      </aside>
    `;
    for (const node of this.el.querySelectorAll<HTMLElement>("[data-ref]")) this.$[node.dataset.ref!] = node;
    this.$.picker!.append(
      characterPicker(loadSkinChoice(), (skin) => {
        saveSkinChoice(skin);
        game.changeSkin(skin);
      }),
    );
    this.el.addEventListener("click", (event) => this.click(event, code, link));
  }

  private click(event: MouseEvent, code: string, link: string) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    const group = button.closest<HTMLElement>(".segmented");
    if (group) {
      const change = settingChange(group.dataset.setting, button.dataset.value!);
      if (change) this.game.changeSettings(change);
      return;
    }
    switch (button.dataset.action) {
      case "copyLink":
        return void copyText(button, link);
      case "copyCode":
        return void copyText(button, code);
      case "share":
        return void navigator.share({ title: "Zombie Breakout", text: `Join my Zombie Breakout team! Code ${code}`, url: link }).catch(() => {});
      case "character": {
        const picker = this.$.picker!;
        picker.hidden = !picker.hidden;
        button.textContent = picker.hidden ? "Change character" : "Done";
        return;
      }
      case "start":
        return this.game.startRound();
      case "leave":
        return this.game.leave();
    }
  }

  update() {
    const { game } = this;
    const state = game.state!;
    const me = game.network.sessionId;
    const isHost = state.hostId === me;
    const count = state.players.size;

    this.$.hostSettings!.hidden = !isHost;
    this.$.start!.hidden = !isHost;
    const settings = roundSettings(state);
    for (const group of this.el.querySelectorAll<HTMLElement>(".segmented")) selectSegment(group, settingValue(group.dataset.setting, settings));
    this.$.settings!.hidden = isHost;
    const label = settingsLabel(state.difficulty, state.duration, state.energy);
    if (isHost && this.cache.get(this.$.settings!) !== label) saveSettings(settings);
    this.set("settings", label);
    this.set(
      "hint",
      !isHost ? "Waiting for the host to start..." : count < 2 ? "Waiting for friends? Share the link above." : "Everyone here? Start the game!",
    );
    this.set("count", `${count} / ${MAX_PLAYERS}`);
    this.set(
      "players",
      [...state.players.entries()]
        .map(
          ([id, p]) =>
            `<li class="${id === me ? "me" : ""}">${skinAvatar(p.skin)}<span class="name">${escapeHtml(p.name)}</span>` +
            `${id === state.hostId ? `<span class="tag host">Host</span>` : ""}${id === me ? `<span class="tag">you</span>` : ""}</li>`,
        )
        .join(""),
      true,
    );
  }

  private set(key: string, text: string, html = false) {
    const el = this.$[key]!;
    if (this.cache.get(el) === text) return;
    this.cache.set(el, text);
    if (html) el.innerHTML = text;
    else el.textContent = text;
  }
}
