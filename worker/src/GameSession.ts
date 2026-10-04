import { DurableObject } from "cloudflare:workers";
import type { SessionInfo } from "@zombies/shared";
import type { Env } from "./env.ts";
import { GameRoom, parseRoomOptions } from "./GameRoom.ts";

/** One game session per session code; lives in memory only while players are connected or reconnecting. */
export class GameSession extends DurableObject<Env> {
  private room?: GameRoom;

  /** Returns undefined when the code is already in use. */
  init(code: string, options: unknown): SessionInfo | undefined {
    if (this.room) return undefined;
    const room = new GameRoom(code, parseRoomOptions(options), this.env.DB, () => {
      if (this.room === room) this.room = undefined;
    });
    this.room = room;
    return room.info();
  }

  info(): SessionInfo | undefined {
    return this.room?.info();
  }

  override async fetch(request: Request): Promise<Response> {
    const room = this.room;
    if (!room) return new Response("Session not found", { status: 404 });
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const params = new URL(request.url).searchParams;
    const token = params.get("token");
    if (token && !room.canReconnect(token)) return new Response("Reconnect window expired", { status: 410 });
    if (!token && room.full) return new Response("Session is full", { status: 409 });

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    if (token) room.reconnect(server, token);
    else room.join(server, params.get("name"), params.get("playerId"), params.get("skin"), params.get("account"));
    return new Response(null, { status: 101, webSocket: client });
  }
}
