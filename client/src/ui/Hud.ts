import { MathUtils } from "three";
import { DEATH_PENALTY, PLAYER_MAX_HP, WEAPONS, formatRoundLength, settingsLabel, type PlayerState } from "@zombies/shared";
import type { Game } from "../game/Game.ts";

const HURT_FADE = 1.6;

const URGENT_SECONDS = 30;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Player with the highest key, or undefined if nobody qualifies. */
function best(players: PlayerState[], key: (p: PlayerState) => number, qualifies: (p: PlayerState) => boolean = () => true) {
  let winner: PlayerState | undefined;
  for (const p of players) {
    if (qualifies(p) && (!winner || key(p) > key(winner))) winner = p;
  }
  return winner;
}

export class Hud {
  private readonly el: HTMLElement;
  private readonly $: Record<string, HTMLElement> = {};
  private readonly cache = new Map<HTMLElement, string>();
  private hurt = 0;
  private ghostHp = 100;
  private hitTimer = 0;
  private bannerTimer = 0;
  private noticeTimer = 0;
  private started = false;
  private lost = false;

  constructor(
    root: HTMLElement,
    private readonly game: Game,
  ) {
    this.el = document.createElement("div");
    this.el.className = "hud";
    this.el.innerHTML = `
      <div class="hurt" data-ref="hurt"></div>
      <div class="lowhp" data-ref="lowhp"></div>
      <div class="damage-dirs" data-ref="dirs"></div>
      <div class="crosshair" data-ref="crosshair"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="dot"></i></div>
      <div class="hitmarker" data-ref="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="popups" data-ref="popups"></div>

      <div class="wave-panel">
        <div class="round-timer" data-ref="timer"></div>
        <div class="wave-sub" data-ref="waveSub"></div>
      </div>

      <div class="knockout" data-ref="knockout">
        <h2>You were knocked out!</h2>
        <p class="penalty">-${DEATH_PENALTY} points</p>
        <p>Back in the fight in <strong data-ref="respawn"></strong></p>
      </div>
      <div class="protection" data-ref="protection">Spawn protection</div>

      <div class="score-panel">
        <div class="score-row"><span class="score" data-ref="score">0</span><span class="combo" data-ref="combo"></span></div>
        <div class="team-score" data-ref="teamScore"></div>
      </div>

      <div class="team-list" data-ref="team"></div>

      <div class="health-panel">
        <div class="health-icon">+</div>
        <div class="hp-bar"><div class="fill" data-ref="hpFill"></div><div class="ghost" data-ref="hpGhost"></div></div>
        <span class="hp-num" data-ref="hpNum">100</span>
      </div>

      <div class="ammo-panel">
        <div class="weapon-name" data-ref="weaponName"></div>
        <div class="ammo-count"><span class="mag" data-ref="mag"></span><span class="reserve" data-ref="reserve"></span></div>
        <div class="reload-bar" data-ref="reloadBar"><div class="fill" data-ref="reloadFill"></div></div>
        <div class="slots"><span data-ref="slot1">1 Pistol</span><span data-ref="slot2">2 Rifle</span></div>
      </div>

      <div class="prompt" data-ref="prompt">
        <div class="prompt-text" data-ref="promptText"></div>
      </div>

      <div class="banner" data-ref="banner"><h2 data-ref="bannerTitle"></h2><p data-ref="bannerSub"></p></div>
      <div class="notice" data-ref="notice"></div>
      <div class="info" data-ref="info"></div>

      <div class="pause" data-ref="pause">
        <div class="pause-card">
        <h2 data-ref="pauseTitle">Paused</h2>
        <p class="settings-tag" data-ref="pauseSettings"></p>
        <p class="hint" data-ref="pauseHint"></p>
        <div class="pause-buttons" data-ref="pauseButtons">
          <button class="primary" data-ref="resume">Resume</button>
          <button data-ref="leave">Leave game</button>
        </div>
        <div class="confirm" data-ref="confirm" hidden>
          <span>Leave game?</span>
          <button class="danger" data-ref="leaveYes">Yes</button>
          <button data-ref="leaveNo">Cancel</button>
        </div>
        <p class="invite" data-ref="invite"></p>
        <div class="controls">
          <span><kbd>W A S D</kbd> / <kbd>Arrows</kbd> move</span>
          <span><kbd>Mouse</kbd> look &amp; aim</span>
          <span><kbd>Left click</kbd> shoot</span>
          <span><kbd>Right click</kbd> aim down sights</span>
          <span><kbd>R</kbd> reload</span>
          <span><kbd>1</kbd> <kbd>2</kbd> / <kbd>Wheel</kbd> switch weapon</span>
          <span><kbd>Shift</kbd> sprint</span>
          <span><kbd>Space</kbd> jump</span>
          <span><kbd>C</kbd> crouch</span>
        </div>
        <p class="rules" data-ref="rules"></p>
        </div>
      </div>

      <div class="end" data-ref="end" hidden>
        <div class="end-card">
          <h1 data-ref="endTitle"></h1>
          <p class="settings-tag" data-ref="endSettings"></p>
          <div class="stars" data-ref="stars"></div>
          <div class="end-score" data-ref="endScore"></div>
          <table class="stats" data-ref="stats"></table>
          <div class="end-buttons">
            <button class="primary" data-ref="again">Play again</button>
            <button data-ref="menu">Back to menu</button>
          </div>
          <p class="hint" data-ref="endHint"></p>
        </div>
      </div>
    `;
    root.append(this.el);
    for (const node of this.el.querySelectorAll<HTMLElement>("[data-ref]")) this.$[node.dataset.ref!] = node;

    const code = game.network.sessionCode;
    if (!game.solo && code) {
      const link = `${location.origin}/join/${code}`;
      this.$.invite!.innerHTML = `Invite friends: code <strong>${code}</strong> &middot; <code>${escapeHtml(link)}</code> <button class="copy">Copy link</button>`;
      const copy = this.$.invite!.querySelector<HTMLButtonElement>(".copy")!;
      copy.addEventListener("click", (event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(link).then(() => (copy.textContent = "Copied!"));
      });
    }

    this.$.resume!.addEventListener("click", () => game.input.lock());
    this.$.leave!.addEventListener("click", () => this.confirmLeave(true));
    this.$.leaveNo!.addEventListener("click", () => this.confirmLeave(false));
    this.$.leaveYes!.addEventListener("click", () => game.leave());
    this.$.again!.addEventListener("click", () => game.restart());
    this.$.menu!.addEventListener("click", () => game.leave());
  }

  private confirmLeave(show: boolean) {
    this.$.confirm!.hidden = !show;
    this.$.pauseButtons!.hidden = show;
  }

  destroy() {
    this.el.remove();
  }

  private set(key: string, text: string, html = false) {
    const el = this.$[key]!;
    if (this.cache.get(el) === text) return;
    this.cache.set(el, text);
    if (html) el.innerHTML = text;
    else el.textContent = text;
  }

  hitmarker(head: boolean) {
    const el = this.$.hitmarker!;
    el.classList.toggle("head", head);
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    this.hitTimer = 0.25;
  }

  kill(points: number, combo: number, head: boolean) {
    const el = this.$.hitmarker!;
    el.classList.add("kill");
    setTimeout(() => el.classList.remove("kill"), 250);
    const popup = document.createElement("div");
    popup.className = "popup";
    const tags = [head ? `<span class="tag head">Headshot</span>` : "", combo > 1 ? `<span class="tag combo">x${combo} combo</span>` : ""];
    popup.innerHTML = `<span class="points">+${points}</span>${tags.join("")}`;
    popup.addEventListener("animationend", () => popup.remove());
    this.$.popups!.append(popup);
    while (this.$.popups!.childElementCount > 4) this.$.popups!.firstElementChild!.remove();
  }

  damage(screenAngle: number, amount: number) {
    this.hurt = Math.min(1, this.hurt + amount / 40 + 0.25);
    const arc = document.createElement("div");
    arc.className = "dir";
    arc.style.transform = `rotate(${screenAngle}rad)`;
    arc.addEventListener("animationend", () => arc.remove());
    this.$.dirs!.append(arc);
  }

  banner(title: string, subtitle: string) {
    this.$.bannerTitle!.textContent = title;
    this.$.bannerSub!.textContent = subtitle;
    this.$.banner!.classList.remove("show");
    void this.$.banner!.offsetWidth;
    this.$.banner!.classList.add("show");
    this.bannerTimer = 2.6;
  }

  notice(text: string) {
    this.$.notice!.textContent = text;
    this.$.notice!.classList.add("show");
    this.noticeTimer = 2.2;
  }

  disconnected() {
    this.lost = true;
    this.$.resume!.hidden = true;
    this.set("pauseTitle", "Connection lost");
    this.set("pauseHint", "Leave the game to start a new one.");
  }

  showEnd() {
    const state = this.game.state;
    if (!state) return;
    this.$.end!.hidden = false;
    this.$.endTitle!.textContent = "Time's up!";
    this.$.endSettings!.textContent = `${settingsLabel(state.difficulty, state.duration)} · 2 stars at ${state.scoreStar.toLocaleString()}`;
    this.$.stars!.innerHTML = [0, 1, 2].map((i) => `<span class="star ${i < state.stars ? "on" : ""}" style="animation-delay:${0.3 + i * 0.25}s">★</span>`).join("");
    this.$.endScore!.textContent = `${state.solo ? "Score" : "Team score"} ${state.teamScore.toLocaleString()}`;

    const rows = [...state.players.entries()].sort(([, a], [, b]) => b.score - a.score);
    const awards = new Map<PlayerState, string[]>();
    const give = (player: PlayerState | undefined, award: string) => {
      if (player) awards.set(player, [...(awards.get(player) ?? []), award]);
    };
    const players = rows.map(([, p]) => p);
    if (players.length > 1 || players[0]?.score) give(players[0], "MVP");
    give(best(players, (p) => p.headshots, (p) => p.headshots > 0), "Headshot King");
    if (players.length > 1) give(best(players, (p) => -p.deaths), "Survivor");

    this.$.stats!.innerHTML =
      `<tr><th>#</th><th>Player</th><th>Score</th><th>Kills</th><th>Headshots</th><th>Deaths</th><th></th></tr>` +
      rows
        .map(
          ([id, p], i) =>
            `<tr class="${id === this.game.network.sessionId ? "me" : ""}"><td>${i + 1}</td><td>${escapeHtml(p.name)}</td>` +
            `<td>${p.score.toLocaleString()}</td><td>${p.kills}</td><td>${p.headshots}</td><td>${p.deaths}</td>` +
            `<td class="awards">${(awards.get(p) ?? []).map((a) => `<span class="award">${a}</span>`).join("")}</td></tr>`,
        )
        .join("");

    const isHost = state.hostId === this.game.network.sessionId;
    this.$.again!.hidden = !isHost;
    this.$.endHint!.textContent = isHost ? "" : "Waiting for the host to start another round...";
  }

  hideEnd() {
    this.$.end!.hidden = true;
  }

  update(dt: number) {
    const { game } = this;
    const state = game.state;
    const me = game.me;
    if (!state || !me) return;

    this.updateTimer(state.phase, state.wave, state.timer, state.zombies.size);
    this.$.knockout!.classList.toggle("show", me.dead && !game.finished);
    if (me.dead) this.set("respawn", `${Math.max(1, Math.ceil(me.respawnIn))}`);
    this.$.protection!.classList.toggle("show", me.protection > 0 && !me.dead);
    this.set("score", me.score.toLocaleString());
    this.set("combo", me.combo > 1 ? `x${me.combo}` : "");
    this.set("teamScore", state.solo ? "" : `Team ${state.teamScore.toLocaleString()}`);
    this.updateTeam();
    this.updateHealth(me, dt);
    this.updateAmmo();
    this.updatePrompt(me);
    this.updateCrosshair();

    this.hurt = Math.max(0, this.hurt - dt / HURT_FADE);
    this.$.hurt!.style.opacity = String(this.hurt);
    this.$.lowhp!.classList.toggle("on", !me.dead && me.hp < 35);

    if ((this.hitTimer -= dt) <= 0) this.$.hitmarker!.classList.remove("show");
    if ((this.bannerTimer -= dt) <= 0) this.$.banner!.classList.remove("show");
    if ((this.noticeTimer -= dt) <= 0) this.$.notice!.classList.remove("show");

    if (game.input.locked) this.started = true;
    const showPause = (!game.input.locked && !game.finished) || this.lost;
    if (showPause && this.$.pause!.hidden) this.confirmLeave(false);
    this.$.pause!.hidden = !showPause;
    const settings = settingsLabel(state.difficulty, state.duration);
    if (showPause && !this.lost) {
      this.set("pauseTitle", this.started ? (state.solo ? "Paused" : "Game menu") : "Ready?");
      this.set("resume", this.started ? "Resume" : "Play");
      this.set("pauseHint", state.solo ? "" : "The game keeps running for your team while you are away!");
      this.set("pauseSettings", settings);
      this.set("rules", `Survive ${formatRoundLength(state.duration)}! Every knockout costs ${DEATH_PENALTY} points.`);
    }

    const parts = [settings, `${game.fps} fps`];
    if (!state.solo) parts.push(`Session ${game.network.sessionCode}`, `${game.playerCount} players`);
    this.set("info", parts.join("  ·  "));
  }

  private updateTimer(phase: string, wave: number, timer: number, alive: number) {
    const el = this.$.timer!;
    if (phase === "countdown") {
      this.set("timer", `Get ready ${Math.ceil(timer)}`);
      this.set("waveSub", "Survive until the timer runs out");
    } else {
      const seconds = Math.ceil(timer);
      this.set("timer", `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);
      this.set("waveSub", phase === "ended" ? "Round over" : `Wave ${wave} · ${alive} zombie${alive === 1 ? "" : "s"}`);
    }
    el.classList.toggle("urgent", phase === "playing" && timer <= URGENT_SECONDS);
  }

  private updateTeam() {
    const state = this.game.state!;
    if (state.solo) return this.set("team", "");
    const rows: string[] = [];
    for (const [id, p] of state.players) {
      if (id === this.game.network.sessionId) continue;
      const pct = Math.round((p.hp / PLAYER_MAX_HP) * 100);
      rows.push(
        `<div class="mate ${p.dead ? "dead" : ""}"><span class="name">${escapeHtml(p.name)}</span>` +
          `<span class="mini"><i style="width:${p.dead ? 0 : pct}%"></i></span>` +
          `${p.dead ? `<span class="status">knocked out (${Math.max(1, Math.ceil(p.respawnIn))})</span>` : ""}</div>`,
      );
    }
    this.set("team", rows.join(""), true);
  }

  private updateHealth(me: PlayerState, dt: number) {
    const pct = me.dead ? 0 : (me.hp / PLAYER_MAX_HP) * 100;
    this.$.hpFill!.style.width = `${pct}%`;
    this.$.hpFill!.classList.toggle("low", pct < 35);
    this.ghostHp = Math.max(pct, MathUtils.damp(this.ghostHp, pct, 3, dt));
    this.$.hpGhost!.style.width = `${this.ghostHp}%`;
    this.set("hpNum", me.dead ? "KO" : String(me.hp));
  }

  private updateAmmo() {
    const w = this.game.weapons;
    const def = WEAPONS[w.current];
    this.set("weaponName", def.name);
    this.set("mag", String(w.magazine));
    this.set("reserve", Number.isFinite(w.reserve) ? `/ ${w.reserve}` : "/ ∞");
    this.$.mag!.classList.toggle("empty", w.magazine === 0);
    this.$.mag!.classList.toggle("low", w.magazine > 0 && w.magazine <= Math.ceil(def.magazine / 4));
    const reload = w.reloadProgress;
    this.$.reloadBar!.classList.toggle("on", reload >= 0);
    if (reload >= 0) this.$.reloadFill!.style.width = `${reload * 100}%`;
    this.$.slot1!.classList.toggle("active", w.current === "pistol");
    this.$.slot2!.classList.toggle("active", w.current === "rifle");
  }

  private updatePrompt(me: PlayerState) {
    const { weapons } = this.game;
    const text = !me.dead && weapons.magazine === 0 && !weapons.reloading ? "Press <kbd>R</kbd> to reload" : "";
    this.set("promptText", text, true);
    this.$.prompt!.classList.toggle("show", text !== "");
  }

  private updateCrosshair() {
    const { game } = this;
    const hidden = game.aimProgress > 0.6 || game.player.sprinting || game.player.dead || game.finished;
    const el = this.$.crosshair!;
    el.classList.toggle("hidden", hidden);
    if (hidden) return;
    const halfFov = MathUtils.degToRad(game.fov / 2);
    const gap = 4 + (Math.tan(game.weapons.spread) / Math.tan(halfFov)) * (window.innerHeight / 2);
    el.style.setProperty("--gap", `${Math.min(60, gap).toFixed(1)}px`);
  }
}
