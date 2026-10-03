import {
  COMBO_WINDOW,
  COUNTDOWN_SECONDS,
  LOBBY_COUNTDOWN_SECONDS,
  DEATH_PENALTY,
  EXTRA_ZOMBIES_PER_PLAYER,
  MAX_COMBO,
  MAX_ZOMBIES_ALIVE,
  MIN_SPAWN_INTERVAL,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_REGEN_DELAY,
  PLAYER_REGEN_PER_SECOND,
  SPAWN_PROTECTION_SECONDS,
  WAVE_AMMO_REFILL,
  WAVE_BREAK_SECONDS,
  WAVE_LULL_ZOMBIES,
  WAVE_SPAWN_SHARE,
  WEAPONS,
  ZOMBIES,
  ZombieAnim,
  ZombieState,
  buildColliders,
  pointInBox,
  resolveCircle,
  starScore,
  waveLength,
  zombieHash,
  type Box,
  type DifficultyDef,
  type GameState,
  type KillEvent,
  type LevelDef,
  type PlayerHurtEvent,
  type PlayerState,
  type ShootMessage,
  type Vec2,
  type WaveDef,
  type WeaponId,
  type ZombieDef,
  type ZombieHitEvent,
  type ZombieType,
} from "@zombies/shared";
import { FlowField } from "./FlowField.ts";

const FLOW_REFRESH = 0.25;
const DIRECT_CHASE_DISTANCE = 3.5;
const SEPARATION_DISTANCE = 0.9;
const TURN_RATE = 8;
const HIT_RANGE_SLACK = 4;
const FIRE_RATE_TOLERANCE = 0.7;
const SCREAM_TIME = 2.4;
const SCREAM_SALT = 7;
const RESPAWN_GRID = 4;
const RESPAWN_MARGIN = 3;

interface ZombieRuntime {
  def: ZombieDef;
  hp: number;
  speed: number;
  damage: number;
  attackTimer: number;
  screamTimer: number;
}

interface PlayerRuntime {
  lastDamageAt: number;
  lastKillAt: number;
  lastShotAt: Record<WeaponId, number>;
}

export interface SimulationEvents {
  zombieHit(e: ZombieHitEvent): void;
  kill(e: KillEvent): void;
  playerHurt(e: PlayerHurtEvent): void;
  ammoRefill(weapon: WeaponId, amount: number): void;
}

export interface RoundSettings {
  difficulty: DifficultyDef;
  /** Round length in seconds. */
  duration: number;
}

export class Simulation {
  private readonly colliders: Box[];
  private readonly flow: FlowField;
  private readonly zombies = new Map<string, ZombieRuntime>();
  private readonly players = new Map<string, PlayerRuntime>();
  private readonly respawnPoints: Vec2[] = [];
  private spawnQueue: ZombieType[] = [];
  private spawnInterval = 1;
  private spawnTimer = 0;
  private waveStartedAt = 0;
  private nextWaveIn = -1;
  private flowTimer = 0;
  private nextZombieId = 1;
  private time = 0;
  private difficulty!: DifficultyDef;
  private duration = 0;
  private waveLength = 0;
  private maxAlive = 0;

  constructor(
    private readonly state: GameState,
    private readonly level: LevelDef,
    private readonly events: SimulationEvents,
    settings: RoundSettings,
    lobby = false,
  ) {
    this.configure(settings);
    this.colliders = buildColliders(level);
    this.flow = new FlowField(level.halfSize + 10, this.colliders, 0.45);
    const limit = level.halfSize - RESPAWN_MARGIN;
    for (let x = -limit; x <= limit; x += RESPAWN_GRID) {
      for (let z = -limit; z <= limit; z += RESPAWN_GRID) {
        if (!this.colliders.some((box) => pointInBox(box, x, z, 1))) this.respawnPoints.push({ x, z });
      }
    }
    this.reset(lobby);
  }

  configure(settings: RoundSettings) {
    this.difficulty = settings.difficulty;
    this.duration = settings.duration;
    this.waveLength = waveLength(settings.duration);
    this.maxAlive = Math.min(MAX_ZOMBIES_ALIVE, settings.difficulty.maxAlive);
    this.state.duration = this.duration;
    this.state.difficulty = this.difficulty.id;
    this.state.scoreStar = starScore(this.level.scoreStarPerMinute, this.difficulty, this.duration);
  }

  /** Starts over with a countdown, or waits in the lobby until start(). */
  reset(lobby = false) {
    this.state.levelId = this.level.id;
    this.state.phase = lobby ? "lobby" : "countdown";
    this.state.timer = lobby ? 0 : COUNTDOWN_SECONDS;
    this.state.wave = 0;
    this.state.stars = 0;
    this.state.zombies.clear();
    this.zombies.clear();
    this.spawnQueue = [];
    this.nextWaveIn = -1;
    let i = 0;
    for (const player of this.state.players.values()) {
      this.resetStats(player);
      this.placeAtSpawn(player, this.level.playerSpawns[i++ % this.level.playerSpawns.length]!);
    }
    this.updateTeamScore();
  }

  addPlayer(id: string, player: PlayerState) {
    this.players.set(id, {
      lastDamageAt: -Infinity,
      lastKillAt: -Infinity,
      lastShotAt: { pistol: -Infinity, rifle: -Infinity },
    });
    this.resetStats(player);
    this.respawn(player);
  }

  removePlayer(id: string) {
    this.players.delete(id);
    this.updateTeamScore();
  }

  private resetStats(player: PlayerState) {
    player.score = 0;
    player.kills = 0;
    player.headshots = 0;
    player.deaths = 0;
    player.combo = 1;
    player.weapon = "pistol";
  }

  private placeAtSpawn(player: PlayerState, spawn: { x: number; z: number }) {
    player.x = spawn.x;
    player.y = 0;
    player.z = spawn.z;
    player.hp = PLAYER_MAX_HP;
    player.dead = false;
    player.respawnIn = 0;
    player.protection = SPAWN_PROTECTION_SECONDS;
  }

  /** Respawns at the open spot furthest from any zombie; the level spawns are used while there are none. */
  private respawn(player: PlayerState) {
    if (this.state.zombies.size === 0) {
      const spawns = this.level.playerSpawns;
      this.placeAtSpawn(player, spawns[Math.floor(Math.random() * spawns.length)]!);
      return;
    }
    let best = this.respawnPoints[0]!;
    let bestDist = -1;
    for (const point of this.respawnPoints) {
      let nearest = Infinity;
      for (const z of this.state.zombies.values()) nearest = Math.min(nearest, Math.hypot(z.x - point.x, z.z - point.z));
      if (nearest > bestDist) {
        bestDist = nearest;
        best = point;
      }
    }
    this.placeAtSpawn(player, best);
  }

  move(player: PlayerState, x: number, y: number, z: number, yaw: number, pitch: number) {
    if (player.dead) return;
    const limit = this.level.halfSize - PLAYER_RADIUS;
    player.x = Math.max(-limit, Math.min(limit, x));
    player.y = Math.max(0, Math.min(5, y));
    player.z = Math.max(-limit, Math.min(limit, z));
    player.yaw = yaw;
    player.pitch = pitch;
  }

  shoot(id: string, player: PlayerState, msg: ShootMessage): boolean {
    const runtime = this.players.get(id);
    const weapon = WEAPONS[msg.weapon];
    if (!runtime || !weapon || player.dead) return false;
    if (this.time - runtime.lastShotAt[msg.weapon] < weapon.fireInterval * FIRE_RATE_TOLERANCE) return false;
    runtime.lastShotAt[msg.weapon] = this.time;
    player.weapon = msg.weapon;
    player.protection = 0;

    const hit = msg.hit;
    if (!hit || this.state.phase !== "playing") return true;
    const zombie = this.state.zombies.get(hit.zombie);
    const zr = this.zombies.get(hit.zombie);
    if (!zombie || !zr) return true;
    if (Math.hypot(zombie.x - player.x, zombie.z - player.z) > weapon.range + HIT_RANGE_SLACK) return true;

    zr.hp -= weapon.damage * (hit.head ? weapon.headshotMultiplier : 1);
    const killed = zr.hp <= 0;
    this.events.zombieHit({ zombie: hit.zombie, by: id, head: hit.head, killed });
    if (killed) this.killZombie(hit.zombie, zr, id, player, runtime, hit.head);
    return true;
  }

  private killZombie(
    zombieId: string,
    zr: ZombieRuntime,
    killerId: string,
    killer: PlayerState,
    runtime: PlayerRuntime,
    head: boolean,
  ) {
    this.state.zombies.delete(zombieId);
    this.zombies.delete(zombieId);

    killer.combo = this.time - runtime.lastKillAt <= COMBO_WINDOW ? Math.min(MAX_COMBO, killer.combo + 1) : 1;
    runtime.lastKillAt = this.time;
    const points = Math.round(zr.def.points * this.difficulty.points * (head ? 1.5 : 1) * killer.combo);
    killer.score += points;
    killer.kills++;
    if (head) killer.headshots++;
    this.updateTeamScore();
    this.events.kill({ zombie: zombieId, by: killerId, head, points, combo: killer.combo });
  }

  private updateTeamScore() {
    let total = 0;
    for (const p of this.state.players.values()) total += p.score;
    this.state.teamScore = total;
  }

  start() {
    if (this.state.phase !== "lobby") return;
    this.state.phase = "countdown";
    this.state.timer = LOBBY_COUNTDOWN_SECONDS;
  }

  tick(dt: number) {
    if (this.state.paused || this.state.phase === "ended" || this.state.phase === "lobby") return;
    this.time += dt;
    this.state.timer = Math.max(0, this.state.timer - dt);
    this.updatePlayers(dt);

    if (this.state.phase === "countdown") {
      if (this.state.timer === 0) {
        this.state.phase = "playing";
        this.state.timer = this.duration;
        this.startWave(1);
      }
      return;
    }

    if (this.state.timer === 0) return this.endRound();
    this.updateWaves(dt);
    this.updateSpawning(dt);
    this.updateZombies(dt);
  }

  /** Wave n of the schedule; past the defined waves the last one keeps growing. */
  private waveDef(n: number): WaveDef {
    const waves = this.level.waves;
    const last = waves[waves.length - 1]!;
    const extra = Math.max(0, n - waves.length);
    const base = waves[n - 1] ?? last;
    const zombies: WaveDef["zombies"] = {};
    for (const [type, count] of Object.entries(base.zombies) as Array<[ZombieType, number]>) {
      const grown = Math.round(count * (1 + 0.2 * extra)) + (type === "brute" ? extra : 0);
      zombies[type] = type === "brute" ? Math.round(grown * this.difficulty.brutes) : grown;
    }
    return { zombies, spawnInterval: base.spawnInterval * 0.88 ** extra };
  }

  /** Queues the next wave behind any zombies still waiting to spawn and spreads it over the wave length. */
  private startWave(wave: number) {
    const def = this.waveDef(wave);
    const scale = 1 + EXTRA_ZOMBIES_PER_PLAYER * Math.max(0, this.state.players.size - 1);
    const queue: ZombieType[] = [];
    for (const [type, count] of Object.entries(def.zombies) as Array<[ZombieType, number]>) {
      for (let i = 0; i < Math.round(count * scale); i++) queue.push(type);
    }
    shuffle(queue);
    const spread = (WAVE_SPAWN_SHARE * this.waveLength) / Math.max(1, queue.length);
    this.spawnQueue = queue.concat(this.spawnQueue);
    this.spawnInterval = Math.max(MIN_SPAWN_INTERVAL, Math.min(def.spawnInterval, spread) * this.difficulty.spawnInterval);
    this.spawnTimer = 0;
    this.waveStartedAt = this.duration - this.state.timer;
    this.nextWaveIn = -1;
    this.state.wave = wave;
    if (wave > 1) this.events.ammoRefill("rifle", WAVE_AMMO_REFILL);
  }

  /** Waves start on schedule, or earlier once the current one has been cleared. */
  private updateWaves(dt: number) {
    const elapsed = this.duration - this.state.timer;
    if (elapsed >= this.waveStartedAt + this.waveLength) return this.startWave(this.state.wave + 1);
    if (this.spawnQueue.length > 0) return;
    if (this.nextWaveIn < 0) {
      if (this.state.zombies.size <= WAVE_LULL_ZOMBIES) this.nextWaveIn = WAVE_BREAK_SECONDS;
      return;
    }
    this.nextWaveIn -= dt;
    if (this.nextWaveIn <= 0) this.startWave(this.state.wave + 1);
  }

  private endRound() {
    this.state.phase = "ended";
    this.spawnQueue = [];
    for (const zombie of this.state.zombies.values()) zombie.anim = ZombieAnim.Dance;
    const players = [...this.state.players.values()];
    for (const player of players) {
      if (!player.dead) continue;
      player.dead = false;
      player.respawnIn = 0;
      player.hp = PLAYER_MAX_HP;
    }
    const deaths = players.reduce((sum, p) => sum + p.deaths, 0);
    let stars = 1;
    if (this.state.teamScore >= this.state.scoreStar) {
      stars++;
      if (deaths <= players.length) stars++;
    }
    this.state.stars = stars;
  }

  private updatePlayers(dt: number) {
    for (const [id, player] of this.state.players) {
      const runtime = this.players.get(id);
      if (!runtime) continue;
      if (player.dead) {
        player.respawnIn = Math.max(0, player.respawnIn - dt);
        if (player.respawnIn === 0) this.respawn(player);
        continue;
      }
      if (player.protection > 0) player.protection = Math.max(0, player.protection - dt);
      if (player.combo > 1 && this.time - runtime.lastKillAt > COMBO_WINDOW) player.combo = 1;
      if (player.hp < PLAYER_MAX_HP && this.time - runtime.lastDamageAt > PLAYER_REGEN_DELAY) {
        player.hp = Math.min(PLAYER_MAX_HP, player.hp + Math.ceil(PLAYER_REGEN_PER_SECOND * dt));
      }
    }
  }

  private updateSpawning(dt: number) {
    if (this.spawnQueue.length === 0) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 || this.state.zombies.size >= this.maxAlive) return;
    this.spawnTimer = this.spawnInterval;

    const type = this.spawnQueue.pop()!;
    const def = ZOMBIES[type];
    const spawn = this.level.zombieSpawns[Math.floor(Math.random() * this.level.zombieSpawns.length)]!;
    const id = String(this.nextZombieId++);
    const screams = zombieHash(id, SCREAM_SALT) < def.screamChance;
    const zombie = new ZombieState({
      type,
      x: spawn.x + (Math.random() - 0.5) * 2,
      z: spawn.z + (Math.random() - 0.5) * 2,
      rot: Math.atan2(-spawn.x, -spawn.z),
      anim: screams ? ZombieAnim.Scream : ZombieAnim.Move,
    });
    this.state.zombies.set(id, zombie);
    this.zombies.set(id, {
      def,
      hp: def.hp * this.difficulty.zombieHp,
      speed: def.speed * this.difficulty.zombieSpeed * (0.85 + Math.random() * 0.3),
      damage: Math.round(def.damage * this.difficulty.zombieDamage),
      attackTimer: def.attackCooldown * 0.5,
      screamTimer: screams ? SCREAM_TIME : 0,
    });
  }

  private updateZombies(dt: number) {
    const targets = [...this.state.players.entries()].filter(([, p]) => !p.dead && p.protection <= 0);

    this.flowTimer -= dt;
    if (this.flowTimer <= 0 && targets.length > 0) {
      this.flowTimer = FLOW_REFRESH;
      this.flow.compute(targets.map(([, p]) => ({ x: p.x, z: p.z })));
    }

    const list = [...this.state.zombies.entries()];
    for (const [id, zombie] of list) {
      const zr = this.zombies.get(id);
      if (!zr) continue;

      let nearest: [string, PlayerState] | undefined;
      let nearestDist = Infinity;
      for (const entry of targets) {
        const d = Math.hypot(entry[1].x - zombie.x, entry[1].z - zombie.z);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = entry;
        }
      }

      zr.attackTimer = Math.max(0, zr.attackTimer - dt);
      if (!nearest) {
        zombie.anim = ZombieAnim.Scream;
        continue;
      }
      const [targetId, target] = nearest;

      if (nearestDist <= zr.def.attackRange) {
        zombie.anim = ZombieAnim.Attack;
        this.turnTowards(zombie, target.x - zombie.x, target.z - zombie.z, dt);
        if (zr.attackTimer === 0) {
          zr.attackTimer = zr.def.attackCooldown;
          this.damagePlayer(targetId, target, zr.damage, zombie.x, zombie.z);
        }
        continue;
      }
      if (zr.screamTimer > 0) {
        zr.screamTimer -= dt;
        zombie.anim = ZombieAnim.Scream;
        this.turnTowards(zombie, target.x - zombie.x, target.z - zombie.z, dt);
        continue;
      }
      zombie.anim = ZombieAnim.Move;

      let dirX: number;
      let dirZ: number;
      const waypoint = nearestDist > DIRECT_CHASE_DISTANCE ? this.flow.nextWaypoint(zombie.x, zombie.z) : null;
      if (waypoint) {
        dirX = waypoint.x - zombie.x;
        dirZ = waypoint.z - zombie.z;
      } else {
        dirX = target.x - zombie.x;
        dirZ = target.z - zombie.z;
      }
      const len = Math.hypot(dirX, dirZ) || 1;
      dirX /= len;
      dirZ /= len;

      for (const [otherId, other] of list) {
        if (otherId === id) continue;
        const ox = zombie.x - other.x;
        const oz = zombie.z - other.z;
        const d = Math.hypot(ox, oz);
        if (d > 0 && d < SEPARATION_DISTANCE) {
          const strength = (SEPARATION_DISTANCE - d) / SEPARATION_DISTANCE;
          dirX += (ox / d) * strength * 1.5;
          dirZ += (oz / d) * strength * 1.5;
        }
      }
      const moveLen = Math.hypot(dirX, dirZ) || 1;
      const pos = {
        x: zombie.x + (dirX / moveLen) * zr.speed * dt,
        z: zombie.z + (dirZ / moveLen) * zr.speed * dt,
      };
      resolveCircle(pos, zr.def.radius, this.colliders);
      this.turnTowards(zombie, pos.x - zombie.x, pos.z - zombie.z, dt);
      zombie.x = pos.x;
      zombie.z = pos.z;
    }
  }

  private turnTowards(zombie: ZombieState, dx: number, dz: number, dt: number) {
    if (Math.abs(dx) + Math.abs(dz) < 1e-5) return;
    const desired = Math.atan2(dx, dz);
    let diff = desired - zombie.rot;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    zombie.rot += diff * Math.min(1, TURN_RATE * dt);
  }

  private damagePlayer(id: string, player: PlayerState, damage: number, fromX: number, fromZ: number) {
    const runtime = this.players.get(id);
    if (!runtime || player.dead || player.protection > 0) return;
    runtime.lastDamageAt = this.time;
    player.hp = Math.max(0, player.hp - damage);
    this.events.playerHurt({ player: id, damage, fromX, fromZ });
    if (player.hp === 0) {
      player.dead = true;
      player.respawnIn = this.difficulty.respawnSeconds;
      player.deaths++;
      player.combo = 1;
      player.score = Math.max(0, player.score - DEATH_PENALTY);
      this.updateTeamScore();
    }
  }
}

function shuffle<T>(items: T[]) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}
