import type { GameSession } from "./GameSession.ts";

export interface Env {
  ASSETS: Fetcher;
  GAME: DurableObjectNamespace<GameSession>;
  DB: D1Database;
}
