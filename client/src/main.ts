import "./styles.css";
import { isGraphicsSetting } from "./engine/Renderer.ts";
import { Game } from "./game/Game.ts";
import { loadGraphics, showMenu, showMessage } from "./ui/Menu.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ui = document.querySelector<HTMLElement>("#ui")!;

const inviteCode = location.pathname.match(/^\/join\/([A-Za-z0-9]+)/)?.[1]?.toUpperCase() ?? null;

const params = new URLSearchParams(location.search);
const debug = import.meta.env.DEV || params.has("debug");
const testDuration = debug ? Number(params.get("duration")) || undefined : undefined;

const requestedQuality = params.get("quality");
const graphics = isGraphicsSetting(requestedQuality) ? requestedQuality : loadGraphics();

const game = new Game(canvas, ui, graphics, params.has("debug"));
if (debug) Object.assign(window, { game });
const loading = showMessage(ui, "Loading...");
const loaded = game.load().finally(() => loading.remove());

game.onLeave = () => {
  history.replaceState(null, "", `/${location.search}`);
  void play(null);
};

async function play(invite: string | null, error?: string) {
  const { name, choice, settings } = await showMenu(ui, game, invite, error);
  game.sound.unlock();
  await loaded;
  try {
    await game.connect(name, choice, settings, testDuration);
    if (choice.mode !== "solo") history.replaceState(null, "", `/join/${game.network.sessionCode}${location.search}`);
    if (!game.inLobby) game.input.lock();
  } catch (err) {
    console.error(err);
    void play(
      choice.mode === "join" ? choice.code : null,
      choice.mode === "join" ? "Session not found or full." : "Could not reach the game server.",
    );
  }
}

void play(inviteCode);
