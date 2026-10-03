import "./styles.css";
import type { Quality } from "./engine/Renderer.ts";
import { Game } from "./game/Game.ts";
import { showMenu, showMessage } from "./ui/Menu.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ui = document.querySelector<HTMLElement>("#ui")!;

const inviteCode = location.pathname.match(/^\/join\/([A-Za-z0-9]+)/)?.[1]?.toUpperCase() ?? null;

const params = new URLSearchParams(location.search);
const debug = import.meta.env.DEV || params.has("debug");
const testDuration = debug ? Number(params.get("duration")) || undefined : undefined;

const QUALITIES: Quality[] = ["low", "medium", "high", "ultra"];
const requestedQuality = params.get("quality") as Quality | null;
const quality = requestedQuality && QUALITIES.includes(requestedQuality) ? requestedQuality : "high";

const game = new Game(canvas, ui, quality);
if (debug) Object.assign(window, { game });
const loading = showMessage(ui, "Loading...");
const loaded = game.load().finally(() => loading.remove());

game.onLeave = () => {
  history.replaceState(null, "", `/${location.search}`);
  void play(null);
};

async function play(invite: string | null, error?: string) {
  const { name, choice, settings } = await showMenu(ui, invite, error);
  game.sound.unlock();
  await loaded;
  try {
    await game.connect(name, choice, settings, testDuration);
    if (choice.mode !== "solo") history.replaceState(null, "", `/join/${game.network.sessionCode}${location.search}`);
    game.input.lock();
  } catch (err) {
    console.error(err);
    void play(
      choice.mode === "join" ? choice.code : null,
      choice.mode === "join" ? "Session not found or full." : "Could not reach the game server.",
    );
  }
}

void play(inviteCode);
