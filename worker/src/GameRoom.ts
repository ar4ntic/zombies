import { Encoder } from "@colyseus/schema";
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_ENERGY_MODE,
  DEFAULT_ROUND_MINUTES,
  DEFAULT_SKIN,
  DIFFICULTIES,
  GameState,
  MAX_PLAYERS,
  PARKING_LOT,
  PlayerState,
  RECONNECT_GRACE_SECONDS,
  StateFrame,
  TICK_MS,
  cleanNickname,
  isDifficulty,
  isEnergyMode,
  isRoundMinutes,
  isSkin,
  isWeaponId,
  type ClientMessages,
  type DifficultyId,
  type EnergyMode,
  type ServerEvents,
  type SessionInfo,
  type ShotEvent,
} from "@zombies/shared";
import { Simulation } from "./game/Simulation.ts";
import { isPlayerId, recordRound } from "./scores.ts";
import { generateSessionCode } from "./sessionCode.ts";

const MIN_TEST_DURATION = 20;
const MAX_TEST_DURATION = 600;
const SESSION_ID_LENGTH = 9;
/** Frees a session nobody connects to after creating it. */
const UNUSED_SESSION_MS = 60_000;
const MAX_TICK_SECONDS = 0.25;
const LEAVE_CLOSE_CODE = 1000;

export interface RoomOptions {
  solo: boolean;
  difficulty: DifficultyId;
  /** Round length in seconds. */
  duration: number;
  energy: EnergyMode;
}

export function parseRoomOptions(input: unknown): RoomOptions {
  const options = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const solo = options.solo === true;
  const difficulty = isDifficulty(options.difficulty) ? options.difficulty : DEFAULT_DIFFICULTY;
  const minutes = isRoundMinutes(options.minutes) ? options.minutes : DEFAULT_ROUND_MINUTES;
  const energy = isEnergyMode(options.energy) ? options.energy : DEFAULT_ENERGY_MODE;
  const testDuration = Number(options.duration);
  const duration =
    solo && options.duration != null && Number.isFinite(testDuration)
      ? Math.round(Math.max(MIN_TEST_DURATION, Math.min(MAX_TEST_DURATION, testDuration)))
      : minutes * 60;
  return { solo, difficulty, duration, energy };
}

interface RoomClient {
  id: string;
  token: string;
  playerId: string;
  /** Set for players logged in to the account that owns their nickname. */
  accountId: string | null;
  socket?: WebSocket;
  /** Has received the full state and gets patches from now on. */
  synced: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

/** Authoritative game session: owns the state, the simulation and the players' sockets. */
export class GameRoom {
  private readonly state = new GameState();
  private readonly encoder = new Encoder(this.state);
  private readonly sim: Simulation;
  private readonly clients = new Map<string, RoomClient>();
  private readonly maxClients: number;
  private loop: ReturnType<typeof setInterval> | null = null;
  private unusedTimer: ReturnType<typeof setTimeout> | null;
  private lastTick = 0;
  private lastPhase = "";

  constructor(
    readonly code: string,
    options: RoomOptions,
    private readonly db: D1Database,
    private readonly onDispose: () => void,
  ) {
    this.state.solo = options.solo;
    this.maxClients = options.solo ? 1 : MAX_PLAYERS;
    this.sim = new Simulation(
      this.state,
      PARKING_LOT,
      {
        zombieHit: (e) => this.broadcast("zombieHit", e),
        kill: (e) => this.broadcast("kill", e),
        playerHurt: (e) => this.broadcast("playerHurt", e),
        pickup: (e) => this.broadcast("pickup", e),
      },
      { difficulty: DIFFICULTIES[options.difficulty], duration: options.duration, energy: options.energy },
      !options.solo,
    );
    this.unusedTimer = setTimeout(() => this.dispose(), UNUSED_SESSION_MS);
  }

  get full(): boolean {
    return this.clients.size >= this.maxClients;
  }

  info(): SessionInfo {
    return {
      exists: true,
      full: this.full,
      solo: this.state.solo,
      difficulty: this.state.difficulty,
      energy: this.state.energy,
      minutes: this.state.duration / 60,
      duration: this.state.duration,
      players: this.clients.size,
      phase: this.state.phase,
    };
  }

  join(socket: WebSocket, rawName: string | null, rawPlayerId: string | null, rawSkin: string | null, accountId: string | null) {
    const id = this.uniqueId();
    const taken = [...this.clients.values()].some((c) => c.playerId === rawPlayerId);
    const playerId = isPlayerId(rawPlayerId) && !taken ? rawPlayerId : crypto.randomUUID();
    const client: RoomClient = { id, token: crypto.randomUUID(), playerId, accountId, synced: false, graceTimer: null };
    this.clients.set(id, client);

    const name = cleanNickname(rawName ?? "") || "Survivor";
    const player = new PlayerState({ name, skin: isSkin(rawSkin) ? rawSkin : DEFAULT_SKIN });
    this.state.players.set(id, player);
    this.sim.addPlayer(id, player);
    if (!this.state.hostId) this.state.hostId = id;
    this.attach(client, socket);
    this.start();
  }

  canReconnect(token: string): boolean {
    return this.findByToken(token) !== undefined;
  }

  reconnect(socket: WebSocket, token: string) {
    const client = this.findByToken(token)!;
    clearTimeout(client.graceTimer);
    client.graceTimer = null;
    const previous = client.socket;
    client.socket = undefined;
    previous?.close(4001, "Replaced by a new connection");
    this.attach(client, socket);
  }

  private findByToken(token: string): RoomClient | undefined {
    for (const client of this.clients.values()) if (client.token === token) return client;
    return undefined;
  }

  private uniqueId(): string {
    for (;;) {
      const id = generateSessionCode(SESSION_ID_LENGTH);
      if (!this.clients.has(id)) return id;
    }
  }

  private attach(client: RoomClient, socket: WebSocket) {
    client.socket = socket;
    client.synced = false;
    socket.addEventListener("message", (event) => {
      if (client.socket === socket && typeof event.data === "string") this.handleMessage(client, event.data);
    });
    socket.addEventListener("close", (event) => {
      if (client.socket !== socket) return;
      if (event.code === LEAVE_CLOSE_CODE) this.leave(client);
      else this.drop(client);
    });
    socket.addEventListener("error", () => {
      if (client.socket === socket) this.drop(client);
    });
    this.send(socket, "welcome", { sessionId: client.id, token: client.token, code: this.code });
  }

  private drop(client: RoomClient) {
    client.socket = undefined;
    client.synced = false;
    clearTimeout(client.graceTimer);
    client.graceTimer = setTimeout(() => this.leave(client), RECONNECT_GRACE_SECONDS * 1000);
  }

  private leave(client: RoomClient) {
    if (this.clients.get(client.id) !== client) return;
    clearTimeout(client.graceTimer);
    this.clients.delete(client.id);
    this.state.players.delete(client.id);
    this.sim.removePlayer(client.id);
    if (this.state.hostId === client.id) {
      this.state.hostId = this.state.players.keys().next().value ?? "";
    }
    if (this.clients.size === 0) this.dispose();
  }

  private handleMessage(client: RoomClient, text: string) {
    let message: { type?: unknown; data?: any };
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    const player = this.state.players.get(client.id);
    if (!player || typeof message?.type !== "string") return;
    const msg = message.data;
    switch (message.type as keyof ClientMessages) {
      case "move":
        if (allFinite([msg?.x, msg?.y, msg?.z, msg?.yaw, msg?.pitch])) this.sim.move(player, msg.x, msg.y, msg.z, msg.yaw, msg.pitch);
        break;
      case "shoot": {
        if (!msg || !isWeaponId(msg.weapon) || !isVec3(msg.origin) || !isVec3(msg.end)) return;
        const hit = msg.hit && typeof msg.hit.zombie === "string" ? { zombie: msg.hit.zombie, head: !!msg.hit.head } : undefined;
        if (!this.sim.shoot(client.id, player, { weapon: msg.weapon, origin: msg.origin, end: msg.end, hit })) return;
        const shot: ShotEvent = { by: client.id, weapon: msg.weapon, origin: msg.origin, end: msg.end };
        this.broadcast("shot", shot, client);
        break;
      }
      case "weapon":
        if (isWeaponId(msg?.weapon)) player.weapon = msg.weapon;
        break;
      case "collect":
        if (typeof msg?.id === "string") this.sim.collect(client.id, player, msg.id);
        break;
      case "skin":
        if (isSkin(msg?.skin)) player.skin = msg.skin;
        break;
      case "pause":
        if (this.state.solo) this.state.paused = !!msg?.paused;
        break;
      case "settings": {
        if (!this.hostInLobby(client)) return this.reject(client, "Only the host can change the settings in the lobby");
        const difficulty: unknown = msg?.difficulty ?? this.state.difficulty;
        const minutes: unknown = msg?.minutes ?? this.state.duration / 60;
        const energy: unknown = msg?.energy ?? this.state.energy;
        if (!isDifficulty(difficulty) || !isRoundMinutes(minutes) || !isEnergyMode(energy)) return this.reject(client, "Unknown settings");
        this.sim.configure({ difficulty: DIFFICULTIES[difficulty], duration: minutes * 60, energy });
        break;
      }
      case "start":
        if (!this.hostInLobby(client)) return this.reject(client, "Only the host can start the game");
        this.sim.start();
        break;
      case "restart":
        if (this.state.phase === "ended" && client.id === this.state.hostId) this.sim.reset(!this.state.solo);
        break;
    }
  }

  private hostInLobby(client: RoomClient): boolean {
    return this.state.phase === "lobby" && client.id === this.state.hostId;
  }

  private reject(client: RoomClient, message: string) {
    if (client.socket) this.send(client.socket, "error", { message });
  }

  private start() {
    clearTimeout(this.unusedTimer);
    if (this.loop) return;
    this.lastTick = Date.now();
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    const now = Date.now();
    this.sim.tick(Math.min((now - this.lastTick) / 1000, MAX_TICK_SECONDS));
    this.lastTick = now;
    if (this.state.phase !== this.lastPhase) {
      if (this.state.phase === "ended") void this.recordResults();
      this.lastPhase = this.state.phase;
    }
    this.sendPatch();
    this.sendFullStates();
  }

  private sendPatch() {
    if (!this.encoder.hasChanges) return;
    this.encoder.sharedBuffer[0] = StateFrame.Patch;
    const bytes = this.encoder.encode({ offset: 1 }).slice();
    this.encoder.discardChanges();
    for (const client of this.clients.values()) {
      if (client.synced && client.socket) trySend(client.socket, bytes);
    }
  }

  private sendFullStates() {
    let bytes: Uint8Array | undefined;
    for (const client of this.clients.values()) {
      if (client.synced || !client.socket) continue;
      if (!bytes) {
        const buffer = new Uint8Array(Encoder.BUFFER_SIZE);
        buffer[0] = StateFrame.Full;
        bytes = this.encoder.encodeAll({ offset: 1 }, buffer).slice();
      }
      trySend(client.socket, bytes);
      client.synced = true;
    }
  }

  private broadcast<K extends keyof ServerEvents>(type: K, data: ServerEvents[K], except?: RoomClient) {
    const text = JSON.stringify({ type, data });
    for (const client of this.clients.values()) {
      if (client !== except && client.synced && client.socket) trySend(client.socket, text);
    }
  }

  private send<K extends keyof ServerEvents>(socket: WebSocket, type: K, data: ServerEvents[K]) {
    trySend(socket, JSON.stringify({ type, data }));
  }

  private async recordResults() {
    const entries = [...this.clients.values()].flatMap((client) => {
      const player = this.state.players.get(client.id);
      return player ? [{ client, player }] : [];
    });
    if (entries.length === 0) return;
    const minutes = this.state.duration / 60;
    try {
      const bests = await recordRound(this.db, {
        level: this.state.levelId,
        difficulty: this.state.difficulty,
        durationMinutes: isRoundMinutes(minutes) ? minutes : 0,
        energy: this.state.energy,
        sessionCode: this.code,
        solo: this.state.solo,
        teamScore: this.state.teamScore,
        stars: this.state.stars,
        players: entries.map(({ client, player }) => ({
          playerId: client.playerId,
          accountId: client.accountId,
          nickname: player.name,
          score: player.score,
          kills: player.kills,
          headshots: player.headshots,
          deaths: player.deaths,
          shots: player.shots,
          hits: player.hits,
        })),
      });
      for (const { client } of entries) {
        const best = bests.get(client.playerId);
        if (best && client.socket) this.send(client.socket, "personalBest", best);
      }
    } catch (err) {
      console.error("Could not record round results", err);
    }
  }

  private dispose() {
    clearInterval(this.loop);
    clearTimeout(this.unusedTimer);
    this.loop = null;
    for (const client of this.clients.values()) {
      clearTimeout(client.graceTimer);
      const socket = client.socket;
      client.socket = undefined;
      try {
        socket?.close(1001, "Session closed");
      } catch {}
    }
    this.clients.clear();
    this.onDispose();
  }
}

function trySend(socket: WebSocket, data: string | Uint8Array) {
  try {
    socket.send(data);
  } catch {}
}

function allFinite(values: unknown[]): boolean {
  return values.every((v) => typeof v === "number" && Number.isFinite(v));
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && allFinite(v);
}
