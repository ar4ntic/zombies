import { Room, type Client } from "@colyseus/core";
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_ROUND_MINUTES,
  DIFFICULTIES,
  GameState,
  LEVELS,
  MAX_PLAYERS,
  NICKNAME_MAX_LENGTH,
  PARKING_LOT,
  PlayerState,
  TICK_MS,
  WEAPONS,
  isDifficulty,
  isRoundMinutes,
  type JoinOptions,
  type MoveMessage,
  type PauseMessage,
  type ShootMessage,
  type ShotEvent,
  type SwitchWeaponMessage,
} from "@zombies/shared";
import { Simulation } from "../game/Simulation.ts";
import { generateSessionCode } from "./sessionCode.ts";

const MIN_TEST_DURATION = 20;
const MAX_TEST_DURATION = 600;

export class GameRoom extends Room {
  override maxClients = MAX_PLAYERS;
  override state = new GameState();
  private sim!: Simulation;

  override messages = {
    move: (client: Client, msg: MoveMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !allFinite([msg?.x, msg?.y, msg?.z, msg?.yaw, msg?.pitch])) return;
      this.sim.move(player, msg.x, msg.y, msg.z, msg.yaw, msg.pitch);
    },
    shoot: (client: Client, msg: ShootMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !msg || !(msg.weapon in WEAPONS)) return;
      if (!isVec3(msg.origin) || !isVec3(msg.end)) return;
      const hit = msg.hit && typeof msg.hit.zombie === "string" ? { zombie: msg.hit.zombie, head: !!msg.hit.head } : undefined;
      if (!this.sim.shoot(client.sessionId, player, { weapon: msg.weapon, origin: msg.origin, end: msg.end, hit })) return;
      const shot: ShotEvent = { by: client.sessionId, weapon: msg.weapon, origin: msg.origin, end: msg.end };
      this.broadcast("shot", shot, { except: client });
    },
    weapon: (client: Client, msg: SwitchWeaponMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (player && msg?.weapon in WEAPONS) player.weapon = msg.weapon;
    },
    pause: (_client: Client, msg: PauseMessage) => {
      if (this.state.solo) this.state.paused = !!msg?.paused;
    },
    restart: (client: Client) => {
      if (this.state.phase === "ended" && client.sessionId === this.state.hostId) this.sim.reset();
    },
  };

  override async onCreate(options: JoinOptions & { level?: string }) {
    this.roomId = await generateSessionCode();
    this.patchRate = TICK_MS;
    this.state.solo = !!options?.solo;
    if (this.state.solo) this.maxClients = 1;

    const level = LEVELS[options?.level ?? ""] ?? PARKING_LOT;
    const difficulty = DIFFICULTIES[isDifficulty(options?.difficulty) ? options.difficulty : DEFAULT_DIFFICULTY];
    const minutes = isRoundMinutes(options?.minutes) ? options.minutes : DEFAULT_ROUND_MINUTES;
    const testDuration = Number(options?.duration);
    const duration =
      this.state.solo && Number.isFinite(testDuration)
        ? Math.round(Math.max(MIN_TEST_DURATION, Math.min(MAX_TEST_DURATION, testDuration)))
        : minutes * 60;
    this.sim = new Simulation(
      this.state,
      level,
      {
        zombieHit: (e) => this.broadcast("zombieHit", e),
        kill: (e) => this.broadcast("kill", e),
        playerHurt: (e) => this.broadcast("playerHurt", e),
        ammoRefill: (weapon, amount) => this.broadcast("ammo", { weapon, amount }),
      },
      { difficulty, duration },
    );
    this.setSimulationInterval((deltaMs) => this.sim.tick(deltaMs / 1000), TICK_MS);
  }

  override onJoin(client: Client, options: JoinOptions) {
    const name = String(options?.name ?? "").trim().slice(0, NICKNAME_MAX_LENGTH) || "Survivor";
    const player = new PlayerState({ name });
    this.state.players.set(client.sessionId, player);
    this.sim.addPlayer(client.sessionId, player);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.sim.removePlayer(client.sessionId);
    if (this.state.hostId === client.sessionId) {
      this.state.hostId = this.state.players.keys().next().value ?? "";
    }  }
}

function allFinite(values: unknown[]): boolean {
  return values.every((v) => typeof v === "number" && Number.isFinite(v));
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && allFinite(v);
}
