import "./styles.css";
import { isGraphicsSetting } from "./engine/Renderer.ts";
import { Game } from "./game/Game.ts";
import { accountApi } from "./net/account.ts";
import { showMenu, showMessage, type MenuStart } from "./ui/Menu.ts";
import { loadGraphics, loadSensitivity } from "./ui/Settings.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ui = document.querySelector<HTMLElement>("#ui")!;

const inviteCode = location.pathname.match(/^\/join\/([A-Za-z0-9]+)/)?.[1]?.toUpperCase() ?? null;

const params = new URLSearchParams(location.search);
const debug = import.meta.env.DEV || params.has("debug");
const testDuration = debug ? Number(params.get("duration")) || undefined : undefined;

const requestedQuality = params.get("quality");
const graphics = isGraphicsSetting(requestedQuality) ? requestedQuality : loadGraphics();

const game = new Game(canvas, ui, graphics, params.has("debug"));
game.setSensitivity(loadSensitivity());
if (debug) Object.assign(window, { game });
const loading = showMessage(ui, "Loading...");
const loaded = game.load().finally(() => loading.remove());

game.onLeave = () => {
  history.replaceState(null, "", `/${location.search}`);
  void play(null);
};

/** Links from account mails carry their token after the #, where it stays out of server logs. */
async function mailLink(): Promise<MenuStart> {
  const token = location.hash.slice(1);
  const page = location.pathname;
  if (!token || (page !== "/verify" && page !== "/reset")) return {};
  history.replaceState(null, "", "/");
  if (page === "/reset") return { resetToken: token };
  const { error } = await accountApi.verify(token);
  return { notice: error ?? "Your email address is confirmed. Your nickname is protected from now on." };
}

async function play(invite: string | null, error?: string, start: MenuStart = {}) {
  const { name, choice, settings, skin } = await showMenu(ui, game, invite, error, start);
  game.sound.unlock();
  await loaded;
  try {
    await game.connect(name, skin, choice, settings, testDuration);
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

void mailLink().then((start) => play(inviteCode, undefined, start));
