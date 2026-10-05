import { settingsLabel, type LeaderboardKind } from "@zombies/shared";
import { getLeaderboard } from "../net/api.ts";
import { segmented, selectSegment } from "./segmented.ts";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const EMPTY: Record<LeaderboardKind, string> = {
  public: "No scores yet. Be the first!",
  members: "No member scores yet. Log in with a confirmed account to be the first!",
};

interface Query {
  difficulty: string;
  minutes: number;
  energy: string;
  nickname: string;
}

/**
 * Best scores for one difficulty, round length and energy mode, on two boards: players without an account
 * and members (confirmed accounts).
 */
export class Leaderboard {
  readonly el = document.createElement("aside");
  private readonly tabs: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private board: LeaderboardKind = "public";
  private query?: Query;
  private request = 0;

  constructor(title = "Leaderboard") {
    this.el.className = "leaderboard";
    this.el.innerHTML =
      `<h3>${title}</h3>${segmented("board", [["public", "Public"], ["members", "Members"]], this.board)}` +
      `<p class="board-sub"></p><ol class="board-list"></ol><p class="board-status"></p>`;
    this.tabs = this.el.querySelector(".segmented")!;
    this.sub = this.el.querySelector(".board-sub")!;
    this.list = this.el.querySelector(".board-list")!;
    this.status = this.el.querySelector(".board-status")!;
    this.tabs.addEventListener("click", (event) => {
      const value = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.value;
      if (value === "public" || value === "members") this.setBoard(value);
    });
  }

  /** Switches between the public and the members board and reloads the shown scores. */
  setBoard(board: LeaderboardKind) {
    if (board === this.board) return;
    this.board = board;
    selectSegment(this.tabs, board);
    if (this.query) void this.load(this.query);
  }

  show(difficulty: string, minutes: number, energy: string, nickname = ""): Promise<void> {
    this.query = { difficulty, minutes, energy, nickname };
    return this.load(this.query);
  }

  private async load({ difficulty, minutes, energy, nickname }: Query) {
    const request = ++this.request;
    const board = this.board;
    this.sub.textContent = settingsLabel(difficulty, minutes * 60, energy);
    this.setStatus("Loading...");
    const scores = await getLeaderboard(difficulty, minutes, energy, board, nickname);
    if (request !== this.request) return;
    if (!scores) {
      this.list.innerHTML = "";
      return this.setStatus("Leaderboard unavailable right now.");
    }
    this.list.innerHTML = scores.entries
      .map(
        (e) =>
          `<li class="${e.me ? "me" : ""}"><span class="rank">${e.rank}</span><span class="name">${escapeHtml(e.nickname)}</span>` +
          `<span class="pts">${e.score.toLocaleString()}</span></li>`,
      )
      .join("");
    this.setStatus(scores.entries.length ? "" : EMPTY[board]);
  }

  private setStatus(text: string) {
    this.status.textContent = text;
    this.status.hidden = !text;
  }
}
