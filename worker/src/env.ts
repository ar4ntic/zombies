import type { GameSession } from "./GameSession.ts";

export interface Env {
  ASSETS: Fetcher;
  GAME: DurableObjectNamespace<GameSession>;
  DB: D1Database;
  /** Secret. Without it no mails are sent. */
  RESEND_API_KEY?: string;
  /** Sender of account mails, an address on a domain verified at Resend. */
  MAIL_FROM?: string;
}
