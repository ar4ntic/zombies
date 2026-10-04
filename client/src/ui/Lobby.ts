import { MAX_PLAYERS, isDifficulty, settingsLabel, type DifficultyId } from "@zombies/shared";
import type { Game } from "../game/Game.ts";
import { copyText } from "./clipboard.ts";
import { saveSettings, settingsSelectors } from "./Menu.ts";
import { selectSegment } from "./segmented.ts";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
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
        <div data-ref="hostSettings">${settingsSelectors({ difficulty: state.difficulty as DifficultyId, minutes: state.duration / 60 })}</div>
        <p class="settings-tag" data-ref="settings"></p>
        <p class="hint" data-ref="hint"></p>
        <div class="buttons">
          <button type="button" class="primary" data-ref="start" data-action="start">Start game</button>
          <button type="button" data-action="leave">Leave</button>
        </div>
      </div>
      <aside class="lobby-players">
        <h3>Players <span data-ref="count"></span></h3>
        <ul data-ref="players"></ul>
      </aside>
    `;
    for (const node of this.el.querySelectorAll<HTMLElement>("[data-ref]")) this.$[node.dataset.ref!] = node;
    this.el.addEventListener("click", (event) => this.click(event, code, link));
  }

  private click(event: MouseEvent, code: string, link: string) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    const group = button.closest<HTMLElement>(".segmented");
    if (group) return this.changeSetting(group.dataset.setting!, button.dataset.value!);
    switch (button.dataset.action) {
      case "copyLink":
        return void copyText(button, link);
      case "copyCode":
        return void copyText(button, code);
      case "share":
        return void navigator.share({ title: "Zombie Breakout", text: `Join my Zombie Breakout team! Code ${code}`, url: link }).catch(() => {});
      case "start":
        return this.game.startRound();
      case "leave":
        return this.game.leave();
    }
  }

  private changeSetting(setting: string, value: string) {
    this.game.changeSettings(setting === "difficulty" && isDifficulty(value) ? { difficulty: value } : { minutes: Number(value) });
  }

  update() {
    const { game } = this;
    const state = game.state!;
    const me = game.network.sessionId;
    const isHost = state.hostId === me;
    const count = state.players.size;

    this.$.hostSettings!.hidden = !isHost;
    this.$.start!.hidden = !isHost;
    for (const group of this.el.querySelectorAll<HTMLElement>(".segmented")) {
      selectSegment(group, group.dataset.setting === "difficulty" ? state.difficulty : String(state.duration / 60));
    }
    this.$.settings!.hidden = isHost;
    const label = settingsLabel(state.difficulty, state.duration);
    if (isHost && this.cache.get(this.$.settings!) !== label) saveSettings({ difficulty: state.difficulty as DifficultyId, minutes: state.duration / 60 });
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
            `<li class="${id === me ? "me" : ""}"><span class="name">${escapeHtml(p.name)}</span>` +
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
