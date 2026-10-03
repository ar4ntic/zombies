import { settingsLabel } from "@zombies/shared";
import { getLeaderboard } from "../net/api.ts";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Best score per player for one difficulty and round length. */
export class Leaderboard {
  readonly el = document.createElement("aside");
  private readonly sub: HTMLElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private request = 0;

  constructor(title = "Leaderboard") {
    this.el.className = "leaderboard";
    this.el.innerHTML = `<h3>${title}</h3><p class="board-sub"></p><ol class="board-list"></ol><p class="board-status"></p>`;
    this.sub = this.el.querySelector(".board-sub")!;
    this.list = this.el.querySelector(".board-list")!;
    this.status = this.el.querySelector(".board-status")!;
  }

  async show(difficulty: string, minutes: number) {
    const request = ++this.request;
    this.sub.textContent = settingsLabel(difficulty, minutes * 60);
    this.setStatus("Loading...");
    const board = await getLeaderboard(difficulty, minutes);
    if (request !== this.request) return;
    if (!board) {
      this.list.innerHTML = "";
      return this.setStatus("Leaderboard unavailable right now.");
    }
    this.list.innerHTML = board.entries
      .map(
        (e) =>
          `<li class="${e.me ? "me" : ""}"><span class="rank">${e.rank}</span><span class="name">${escapeHtml(e.nickname)}</span>` +
          `<span class="pts">${e.score.toLocaleString()}</span></li>`,
      )
      .join("");
    this.setStatus(board.entries.length ? "" : "No scores yet. Be the first!");
  }

  private setStatus(text: string) {
    this.status.textContent = text;
    this.status.hidden = !text;
  }
}
