import {
  COMBO_WINDOW,
  COUNTDOWN_SECONDS,
  LOBBY_COUNTDOWN_SECONDS,
  DEATH_PENALTY,
  ENERGY_PICKUP_AMOUNT,
  EXTRA_ZOMBIES_ALIVE_PER_PLAYER,
  EXTRA_ZOMBIES_PER_PLAYER,
  FRIENDLY_FIRE_DAMAGE,
  HEALTH_PICKUP_AMOUNT,
  MAX_COMBO,
  MAX_ZOMBIES_ALIVE,
  MIN_SPAWN_INTERVAL,
  PICKUP_RADIUS,
  PICKUP_RATE_PER_PLAYER,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_REGEN_DELAY,
  PLAYER_REGEN_PER_SECOND,
  PickupState,
  SPAWN_PROTECTION_SECONDS,
  STAND_OVERHANG,
  STAND_TOLERANCE,
  WAVE_COUNTDOWN_SECONDS,
  WEAPONS,
  ZOMBIES,
  ZombieAnim,
  ZombieState,
  buildColliders,
  pointInBox,
  resolveCircle,
  starScore,
  surfaceHeight,
  zombieHash,
  type Box,
  type DifficultyDef,
  type EnergyMode,
  type GameState,
  type KillEvent,
  type LevelDef,
  type PickupEvent,
  type PickupKind,
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
/** Shots that may arrive at once after a network hiccup before the fire rate limit applies. */
const FIRE_BURST = 3;
const SCREAM_TIME = 2.4;
const SCREAM_SALT = 7;
const RESPAWN_GRID = 4;
const RESPAWN_MARGIN = 3;
const PICKUP_GRID = 2;
const PICKUP_CLEARANCE = 0.8;
const PICKUP_SPACING = 3;
const PICKUP_PLAYER_DISTANCE = 4;
const PICKUP_PLACE_ATTEMPTS = 12;
/** Extra reach for a collect request, covering the distance moved since the client sent it. */
const COLLECT_SLACK = 1;
const PICKUP_KINDS: PickupKind[] = ["energy", "health"];

interface ZombieRuntime {
  def: ZombieDef;
  hp: number;
  speed: number;
  damage: number;
  attackTimer: number;
  screamTimer: number;
}

interface FireBudget {
  shots: number;
  /** Wall-clock seconds of the last update. */
  at: number;
}

interface PlayerRuntime {
  lastDamageAt: number;
  lastKillAt: number;
  fire: Record<WeaponId, FireBudget>;
  /** Regenerated health not yet added to the whole-number hp. */
  regen: number;
}

export interface SimulationEvents {
  zombieHit(e: ZombieHitEvent): void;
  kill(e: KillEvent): void;
  playerHurt(e: PlayerHurtEvent): void;
  pickup(e: PickupEvent): void;
}

export interface RoundSettings {
  difficulty: DifficultyDef;
  /** Round length in seconds. */
  duration: number;
  energy: EnergyMode;
  friendlyFire: boolean;
}

export class Simulation {
  private readonly colliders: Box[];
  private readonly flow: FlowField;
  private readonly zombies = new Map<string, ZombieRuntime>();
  private readonly players = new Map<string, PlayerRuntime>();
  private readonly respawnPoints: Vec2[] = [];
  private readonly pickupPoints: Vec2[] = [];
  private readonly pickupTimers: Record<PickupKind, number> = { energy: 0, health: 0 };
  private spawnQueue: ZombieType[] = [];
  private spawnInterval = 1;
  private spawnTimer = 0;
  private flowTimer = 0;
  private nextZombieId = 1;
  private nextPickupId = 1;
  private time = 0;
  private difficulty!: DifficultyDef;
  private duration = 0;
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
    for (let x = -limit; x <= limit; x += PICKUP_GRID) {
      for (let z = -limit; z <= limit; z += PICKUP_GRID) {
        if (!this.colliders.some((box) => pointInBox(box, x, z, PICKUP_CLEARANCE))) this.pickupPoints.push({ x, z });
      }
    }
    this.reset(lobby);
  }

  configure(settings: RoundSettings) {
    this.difficulty = settings.difficulty;
    this.duration = settings.duration;
    this.maxAlive = Math.min(MAX_ZOMBIES_ALIVE, settings.difficulty.maxAlive);
    this.state.duration = this.duration;
    this.state.difficulty = this.difficulty.id;
    this.state.energy = settings.energy;
    this.state.friendlyFire = settings.friendlyFire;
    this.state.scoreStar = starScore(this.level.scoreStarPerMinute, this.difficulty, this.duration);
  }

  /** Starts over with a countdown, or waits in the lobby until start(). */
  reset(lobby = false) {
    this.state.levelId = this.level.id;
    this.state.phase = lobby ? "lobby" : "countdown";
    this.state.timer = lobby ? 0 : COUNTDOWN_SECONDS;
    this.state.wave = 0;
    this.state.waveIn = 0;
    this.state.zombiesLeft = 0;
    this.state.stars = 0;
    this.state.zombies.clear();
    this.state.pickups.clear();
    this.zombies.clear();
    this.spawnQueue = [];
    for (const kind of PICKUP_KINDS) this.pickupTimers[kind] = this.pickupInterval(kind) / 2;
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
      fire: { pistol: { shots: FIRE_BURST, at: 0 }, rifle: { shots: FIRE_BURST, at: 0 } },
      regen: 0,
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
    player.shots = 0;
    player.hits = 0;
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

  /** Respawns at the open spot furthest from any zombie; while there are none, at a level spawn nobody stands on. */
  private respawn(player: PlayerState) {
    if (this.state.zombies.size === 0) {
      const spawns = this.level.playerSpawns;
      const taken = (spawn: Vec2) => [...this.state.players.values()].some((p) => p !== player && Math.hypot(p.x - spawn.x, p.z - spawn.z) < PLAYER_RADIUS * 2);
      this.placeAtSpawn(player, spawns.find((spawn) => !taken(spawn)) ?? spawns[Math.floor(Math.random() * spawns.length)]!);
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
    if (!this.spendShot(runtime.fire[msg.weapon], weapon.fireInterval)) return false;
    player.weapon = msg.weapon;
    player.protection = 0;
    if (this.state.phase !== "playing") return true;
    player.shots++;

    if (msg.hitPlayer !== undefined) {
      const mate = this.state.players.get(msg.hitPlayer);
      const inRange = mate && Math.hypot(mate.x - player.x, mate.z - player.z) <= weapon.range + HIT_RANGE_SLACK;
      if (this.state.friendlyFire && mate && mate !== player && inRange) {
        this.damagePlayer(msg.hitPlayer, mate, Math.round(weapon.damage * FRIENDLY_FIRE_DAMAGE), player.x, player.z);
      }
      return true;
    }

    const hit = msg.hit;
    if (!hit) return true;
    const zombie = this.state.zombies.get(hit.zombie);
    const zr = this.zombies.get(hit.zombie);
    if (!zombie || !zr) return true;
    if (Math.hypot(zombie.x - player.x, zombie.z - player.z) > weapon.range + HIT_RANGE_SLACK) return true;

    player.hits++;
    zr.hp -= weapon.damage * (hit.head ? weapon.headshotMultiplier : 1);
    const killed = zr.hp <= 0;
    this.events.zombieHit({ zombie: hit.zombie, by: id, head: hit.head, killed });
    if (killed) this.killZombie(hit.zombie, zr, id, player, runtime, hit.head);
    return true;
  }

  /**
   * Fire rate limit on wall-clock time, since shots arrive between ticks. A few shots may come in at once
   * after a network hiccup; beyond that the weapon's own rate applies.
   */
  private spendShot(budget: FireBudget, fireInterval: number): boolean {
    const now = Date.now() / 1000;
    budget.shots = Math.min(FIRE_BURST, budget.shots + (now - budget.at) / (fireInterval * FIRE_RATE_TOLERANCE));
    budget.at = now;
    if (budget.shots < 1) return false;
    budget.shots--;
    return true;
  }

  /** Hands an energy capsule to the player standing on it. Health packs are applied without asking. */
  collect(id: string, player: PlayerState, pickupId: string) {
    const pickup = this.state.pickups.get(pickupId);
    if (!pickup || pickup.kind !== "energy" || player.dead || this.state.phase !== "playing") return;
    if (Math.hypot(pickup.x - player.x, pickup.z - player.z) > PICKUP_RADIUS + COLLECT_SLACK) return;
    this.state.pickups.delete(pickupId);
    this.events.pickup({ player: id, kind: "energy", amount: ENERGY_PICKUP_AMOUNT });
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
    this.updatePickups(dt);
    const left = this.spawnQueue.length + this.state.zombies.size;
    if (this.state.zombiesLeft !== left) this.state.zombiesLeft = left;
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

  /** Queues every zombie of the wave; its size grows with the difficulty and the number of players. */
  private startWave(wave: number) {
    const def = this.waveDef(wave);
    const team = 1 + EXTRA_ZOMBIES_PER_PLAYER * Math.max(0, this.state.players.size - 1);
    const queue: ZombieType[] = [];
    for (const [type, count] of Object.entries(def.zombies) as Array<[ZombieType, number]>) {
      const scale = team * (type === "brute" ? 1 : ZOMBIES[type].body === "quadruped" ? this.difficulty.animals : this.difficulty.waveSize);
      for (let i = 0; i < Math.round(count * scale); i++) queue.push(type);
    }
    shuffle(queue);
    this.spawnQueue = queue;
    this.spawnInterval = Math.max(MIN_SPAWN_INTERVAL, def.spawnInterval * this.difficulty.spawnInterval);
    this.spawnTimer = 0;
    this.state.wave = wave;
    this.state.waveIn = 0;
  }

  /** The next wave is announced once every zombie of the current one is knocked out. */
  private updateWaves(dt: number) {
    if (this.state.waveIn > 0) {
      this.state.waveIn = Math.max(0, this.state.waveIn - dt);
      if (this.state.waveIn === 0) this.startWave(this.state.wave + 1);
      return;
    }
    if (this.spawnQueue.length === 0 && this.state.zombies.size === 0) this.state.waveIn = WAVE_COUNTDOWN_SECONDS;
  }

  private endRound() {
    this.state.phase = "ended";
    this.state.waveIn = 0;
    this.state.zombiesLeft = this.state.zombies.size;
    this.state.pickups.clear();
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
        runtime.regen += PLAYER_REGEN_PER_SECOND * dt;
        const whole = Math.floor(runtime.regen);
        runtime.regen -= whole;
        if (whole > 0) player.hp = Math.min(PLAYER_MAX_HP, player.hp + whole);
      }
    }
  }

  /** Seconds between pickups of one kind; shorter with more players. */
  private pickupInterval(kind: PickupKind): number {
    const rate = kind === "energy" ? this.difficulty.energyPickup : this.difficulty.healthPickup;
    return rate.interval / (1 + PICKUP_RATE_PER_PLAYER * Math.max(0, this.state.players.size - 1));
  }

  private updatePickups(dt: number) {
    for (const kind of PICKUP_KINDS) {
      if (kind === "energy" && this.state.energy !== "limited") continue;
      const rate = kind === "energy" ? this.difficulty.energyPickup : this.difficulty.healthPickup;
      let lying = 0;
      for (const pickup of this.state.pickups.values()) if (pickup.kind === kind) lying++;
      if (lying >= rate.max + Math.max(0, this.state.players.size - 1)) continue;
      this.pickupTimers[kind] -= dt;
      if (this.pickupTimers[kind] > 0) continue;
      this.pickupTimers[kind] = this.pickupInterval(kind);
      this.spawnPickup(kind);
    }

    for (const [pickupId, pickup] of [...this.state.pickups]) {
      if (pickup.kind !== "health") continue;
      for (const [id, player] of this.state.players) {
        if (player.dead || player.hp >= PLAYER_MAX_HP || player.y > STAND_TOLERANCE) continue;
        if (Math.hypot(pickup.x - player.x, pickup.z - player.z) > PICKUP_RADIUS) continue;
        const amount = Math.min(HEALTH_PICKUP_AMOUNT, PLAYER_MAX_HP - player.hp);
        player.hp += amount;
        this.state.pickups.delete(pickupId);
        this.events.pickup({ player: id, kind: "health", amount });
        break;
      }
    }
  }

  /** Places a pickup on open ground, away from players and other pickups. Skipped when no free spot turns up. */
  private spawnPickup(kind: PickupKind) {
    for (let attempt = 0; attempt < PICKUP_PLACE_ATTEMPTS; attempt++) {
      const point = this.pickupPoints[Math.floor(Math.random() * this.pickupPoints.length)];
      if (!point) return;
      const near = (other: { x: number; z: number }, distance: number) => Math.hypot(other.x - point.x, other.z - point.z) < distance;
      if ([...this.state.pickups.values()].some((p) => near(p, PICKUP_SPACING))) continue;
      if ([...this.state.players.values()].some((p) => near(p, PICKUP_PLAYER_DISTANCE))) continue;
      this.state.pickups.set(String(this.nextPickupId++), new PickupState({ kind, x: point.x, z: point.z }));
      return;
    }
  }

  /** Height of the object a player stands on, or 0 on the ground and in mid-air. */
  private elevation(player: PlayerState): number {
    if (player.y <= STAND_TOLERANCE) return 0;
    return surfaceHeight(player.x, player.z, this.colliders, player.y + STAND_TOLERANCE, STAND_OVERHANG);
  }

  private updateSpawning(dt: number) {
    if (this.spawnQueue.length === 0) return;
    this.spawnTimer -= dt;
    const maxAlive = this.maxAlive + EXTRA_ZOMBIES_ALIVE_PER_PLAYER * Math.max(0, this.state.players.size - 1);
    if (this.spawnTimer > 0 || this.state.zombies.size >= maxAlive) return;
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
    const targets = [...this.state.players.entries()]
      .filter(([, p]) => !p.dead && p.protection <= 0)
      .map(([id, player]) => ({ id, player, elevation: this.elevation(player) }));

    this.flowTimer -= dt;
    if (this.flowTimer <= 0 && targets.length > 0) {
      this.flowTimer = FLOW_REFRESH;
      // Zombies walk towards the players a walker can reach as long as there are any.
      const low = targets.filter((t) => t.elevation <= ZOMBIES.walker.reach);
      this.flow.compute((low.length > 0 ? low : targets).map(({ player }) => ({ x: player.x, z: player.z })));
    }

    const list = [...this.state.zombies.entries()];
    for (const [id, zombie] of list) {
      const zr = this.zombies.get(id);
      if (!zr) continue;

      // The nearest player this zombie can reach; one standing too high is only chased when nobody else is left.
      let nearest: (typeof targets)[number] | undefined;
      let nearestDist = Infinity;
      let nearestReachable = false;
      for (const entry of targets) {
        const d = Math.hypot(entry.player.x - zombie.x, entry.player.z - zombie.z);
        const reachable = entry.elevation <= zr.def.reach;
        if (reachable === nearestReachable ? d < nearestDist : reachable) {
          nearestDist = d;
          nearest = entry;
          nearestReachable = reachable;
        }
      }

      zr.attackTimer = Math.max(0, zr.attackTimer - dt);
      if (!nearest) {
        zombie.anim = ZombieAnim.Scream;
        continue;
      }
      const { id: targetId, player: target } = nearest;

      if (nearestDist <= zr.def.attackRange) {
        this.turnTowards(zombie, target.x - zombie.x, target.z - zombie.z, dt);
        if (!nearestReachable) {
          zombie.anim = ZombieAnim.Scream;
          continue;
        }
        zombie.anim = ZombieAnim.Attack;
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
    runtime.regen = 0;
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
