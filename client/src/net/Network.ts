import { Callbacks, Client, type Room } from "@colyseus/sdk";
import {
  GAME_ROOM,
  type AmmoRefillEvent,
  type GameState,
  type JoinOptions,
  type KillEvent,
  type MoveMessage,
  type PlayerHurtEvent,
  type PlayerState,
  type ShootMessage,
  type ShotEvent,
  type WeaponId,
  type ZombieHitEvent,
  type ZombieState,
} from "@zombies/shared";

function serverUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV) return `${location.protocol}//${location.hostname}:2567`;
  return location.origin;
}

export interface NetworkEvents {
  playerAdded(id: string, player: PlayerState): void;
  playerRemoved(id: string): void;
  zombieAdded(id: string, zombie: ZombieState): void;
  zombieChanged(id: string): void;
  zombieRemoved(id: string): void;
  shot(e: ShotEvent): void;
  zombieHit(e: ZombieHitEvent): void;
  kill(e: KillEvent): void;
  playerHurt(e: PlayerHurtEvent): void;
  ammo(e: AmmoRefillEvent): void;
  disconnected(): void;
}

export class Network {
  private readonly client = new Client(serverUrl());
  private room?: Room<any, GameState>;

  get sessionId(): string {
    return this.room?.sessionId ?? "";
  }

  get sessionCode(): string {
    return this.room?.roomId ?? "";
  }

  get state(): GameState | undefined {
    return this.room?.state;
  }

  async createSession(options: JoinOptions, events: NetworkEvents) {
    this.attach(await this.client.create<GameState>(GAME_ROOM, options), events);
  }

  async joinSession(code: string, options: JoinOptions, events: NetworkEvents) {
    this.attach(await this.client.joinById<GameState>(code.toUpperCase(), options), events);
  }

  private attach(room: Room<any, GameState>, events: NetworkEvents) {
    this.room = room;
    const callbacks = Callbacks.get(room);
    callbacks.onAdd("players", (player, id) => events.playerAdded(id, player));
    callbacks.onRemove("players", (_player, id) => events.playerRemoved(id));
    callbacks.onAdd("zombies", (zombie, id) => {
      events.zombieAdded(id, zombie);
      callbacks.onChange(zombie, () => events.zombieChanged(id));
    });
    callbacks.onRemove("zombies", (_zombie, id) => events.zombieRemoved(id));
    room.onMessage("shot", events.shot);
    room.onMessage("zombieHit", events.zombieHit);
    room.onMessage("kill", events.kill);
    room.onMessage("playerHurt", events.playerHurt);
    room.onMessage("ammo", events.ammo);
    room.onLeave(() => {
      if (this.room === room) events.disconnected();
    });
  }

  sendMove(move: MoveMessage) {
    this.room?.send("move", move);
  }

  sendShoot(msg: ShootMessage) {
    this.room?.send("shoot", msg);
  }

  sendWeapon(weapon: WeaponId) {
    this.room?.send("weapon", { weapon });
  }

  sendPause(paused: boolean) {
    this.room?.send("pause", { paused });
  }

  sendRestart() {
    this.room?.send("restart", {});
  }

  leave() {
    const room = this.room;
    this.room = undefined;
    void room?.leave();
  }
}
