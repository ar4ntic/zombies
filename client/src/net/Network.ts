import { Callbacks, Decoder } from "@colyseus/schema";
import {
  GameState,
  RECONNECT_GRACE_SECONDS,
  StateFrame,
  type ClientMessages,
  type Envelope,
  type JoinOptions,
  type KillEvent,
  type MoveMessage,
  type PersonalBestEvent,
  type PickupEvent,
  type PickupState,
  type PlayerHurtEvent,
  type PlayerState,
  type ServerEvents,
  type SettingsMessage,
  type ShootMessage,
  type ShotEvent,
  type WeaponId,
  type ZombieHitEvent,
  type ZombieState,
} from "@zombies/shared";
import { accountApi } from "./account.ts";
import { UserError, createSession, getSession, playerId } from "./api.ts";

const RECONNECT_DELAY_MS = 1000;
const LEAVE_CLOSE_CODE = 1000;

function socketUrl(code: string, params: URLSearchParams): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws/${encodeURIComponent(code)}?${params}`;
}

export interface NetworkEvents {
  playerAdded(id: string, player: PlayerState): void;
  playerRemoved(id: string): void;
  zombieAdded(id: string, zombie: ZombieState): void;
  zombieChanged(id: string): void;
  zombieRemoved(id: string): void;
  pickupAdded(id: string, pickup: PickupState): void;
  pickupRemoved(id: string): void;
  shot(e: ShotEvent): void;
  zombieHit(e: ZombieHitEvent): void;
  kill(e: KillEvent): void;
  playerHurt(e: PlayerHurtEvent): void;
  pickup(e: PickupEvent): void;
  personalBest(e: PersonalBestEvent): void;
  disconnected(): void;
}

interface Connection {
  code: string;
  decoder: Decoder<GameState>;
  events: NetworkEvents;
  sessionId: string;
  token: string;
  socket?: WebSocket;
}

export class Network {
  private connection?: Connection;

  get sessionId(): string {
    return this.connection?.sessionId ?? "";
  }

  get sessionCode(): string {
    return this.connection?.code ?? "";
  }

  get state(): GameState | undefined {
    return this.connection?.decoder.state;
  }

  async createSession(options: JoinOptions, events: NetworkEvents) {
    const { code } = await createSession(options);
    await this.open(code, options, events);
  }

  async joinSession(code: string, options: JoinOptions, events: NetworkEvents) {
    code = code.toUpperCase();
    const info = await getSession(code);
    if (!info?.exists || info.full) throw new UserError("Session not found or full.");
    if (info.private) {
      const { account } = await accountApi.me();
      if (!account?.verified || !account.nickname) {
        throw new UserError("This is a private session. Log in with a confirmed account that has a nickname to join.");
      }
    }
    await this.open(code, options, events);
  }

  private async open(code: string, options: JoinOptions, events: NetworkEvents) {
    const decoder = new Decoder(new GameState());
    const connection: Connection = { code, decoder, events, sessionId: "", token: "" };
    const callbacks = Callbacks.get(decoder);
    callbacks.onAdd("players", (player, id) => events.playerAdded(id, player));
    callbacks.onRemove("players", (_player, id) => events.playerRemoved(id));
    callbacks.onAdd("zombies", (zombie, id) => {
      events.zombieAdded(id, zombie);
      callbacks.onChange(zombie, () => events.zombieChanged(id));
    });
    callbacks.onRemove("zombies", (_zombie, id) => events.zombieRemoved(id));
    callbacks.onAdd("pickups", (pickup, id) => events.pickupAdded(id, pickup));
    callbacks.onRemove("pickups", (_pickup, id) => events.pickupRemoved(id));
    this.connection = connection;
    const params = new URLSearchParams({ name: options.name, playerId: playerId() });
    if (options.skin) params.set("skin", options.skin);
    await this.connect(connection, params);
  }

  /** Resolves once the full state has arrived; rejects if the socket closes before that. */
  private connect(connection: Connection, params: URLSearchParams): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(socketUrl(connection.code, params));
      socket.binaryType = "arraybuffer";
      connection.socket = socket;
      let synced = false;
      socket.addEventListener("message", (event) => {
        if (connection.socket !== socket) return;
        if (typeof event.data === "string") return this.handleEvent(connection, JSON.parse(event.data));
        const bytes = new Uint8Array(event.data as ArrayBuffer);
        const { decoder } = connection;
        if (bytes[0] === StateFrame.Full) {
          if (decoder.root.refs.size > 1) decoder.decodeResync(bytes, { offset: 1 });
          else decoder.decode(bytes, { offset: 1 });
          if (!synced) resolve();
          synced = true;
        } else if (synced) {
          decoder.decode(bytes, { offset: 1 });
        }
      });
      socket.addEventListener("close", () => {
        if (connection.socket !== socket) return;
        connection.socket = undefined;
        if (synced) void this.reconnect(connection);
        else reject(new Error("Could not connect to the session"));
      });
    });
  }

  private async reconnect(connection: Connection) {
    const deadline = Date.now() + RECONNECT_GRACE_SECONDS * 1000;
    while (this.connection === connection && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
      if (this.connection !== connection) return;
      try {
        await this.connect(connection, new URLSearchParams({ token: connection.token }));
        return;
      } catch {}
    }
    if (this.connection === connection) connection.events.disconnected();
  }

  private handleEvent(connection: Connection, message: Envelope) {
    const { events } = connection;
    const type = message.type as keyof ServerEvents;
    const data = message.data as any;
    switch (type) {
      case "welcome":
        connection.sessionId = data.sessionId;
        connection.token = data.token;
        break;
      case "shot":
      case "zombieHit":
      case "kill":
      case "playerHurt":
      case "pickup":
      case "personalBest":
        events[type](data);
        break;
      case "error":
        console.warn("Server error:", data?.message);
        break;
    }
  }

  private send<K extends keyof ClientMessages>(type: K, data: ClientMessages[K]) {
    const socket = this.connection?.socket;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, data }));
  }

  sendMove(move: MoveMessage) {
    this.send("move", move);
  }

  sendShoot(msg: ShootMessage) {
    this.send("shoot", msg);
  }

  sendWeapon(weapon: WeaponId) {
    this.send("weapon", { weapon });
  }

  sendPause(paused: boolean) {
    this.send("pause", { paused });
  }

  sendSettings(settings: SettingsMessage) {
    this.send("settings", settings);
  }

  sendCollect(id: string) {
    this.send("collect", { id });
  }

  sendSkin(skin: string) {
    this.send("skin", { skin });
  }

  sendStart() {
    this.send("start", {});
  }

  sendRestart() {
    this.send("restart", {});
  }

  leave() {
    const connection = this.connection;
    this.connection = undefined;
    const socket = connection?.socket;
    if (connection) connection.socket = undefined;
    socket?.close(LEAVE_CLOSE_CODE, "Left the game");
  }
}
