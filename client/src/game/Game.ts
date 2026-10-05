import { PerspectiveCamera, Timer, Vector3 } from "three";
import {
  PARKING_LOT,
  PICKUP_RADIUS,
  STAND_TOLERANCE,
  TICK_MS,
  WAVE_COUNTDOWN_SECONDS,
  buildColliders,
  skinDef,
  type Box,
  type EnergyMode,
  type GameState,
  type PlayerState,
  type SettingsMessage,
} from "@zombies/shared";
import { Renderer, type GraphicsSetting } from "../engine/Renderer.ts";
import { Network, type NetworkEvents } from "../net/Network.ts";
import { Hud } from "../ui/Hud.ts";
import { PerfOverlay } from "../ui/PerfOverlay.ts";
import type { GameSettings } from "../ui/Menu.ts";
import { Bolts } from "./fx/Bolts.ts";
import { Particles } from "./fx/Particles.ts";
import { Scorches } from "./fx/Scorches.ts";
import { Sound } from "./fx/Sound.ts";
import { Input } from "./Input.ts";
import { Pickups } from "./Pickups.ts";
import { PlayerController } from "./PlayerController.ts";
import { RemotePlayers } from "./RemotePlayers.ts";
import { ViewModel } from "./weapons/ViewModel.ts";
import { BOLTS, SURFACE_SEARCH, WeaponSystem } from "./weapons/WeaponSystem.ts";
import { World } from "./World.ts";
import { ZombieManager } from "./zombies/ZombieManager.ts";
import { preloadCast } from "./zombies/cast.ts";

export type SessionChoice = { mode: "solo" } | { mode: "create"; private: boolean } | { mode: "join"; code: string };

const LEVEL = PARKING_LOT;
const RESULTS_DELAY_MS = 4500;
/** Seconds between requests for the capsule the player is standing on, until the server hands it over. */
const COLLECT_INTERVAL = 0.2;
/** Height above a player's feet their gun is held at, where other players' bolts and knockback come from. */
const GUN_HEIGHT = 1.5;

/** The announced wave and the whole seconds left until it starts. */
export interface WaveCountdown {
  wave: number;
  seconds: number;
}

export class Game {
  readonly input: Input;
  readonly network = new Network();
  readonly sound = new Sound();
  readonly player: PlayerController;
  readonly weapons: WeaponSystem;
  private readonly camera = new PerspectiveCamera(75, 1, 0.03, 500);
  private readonly world = new World(LEVEL);
  private readonly colliders = buildColliders(LEVEL);
  private readonly renderer: Renderer;
  private readonly remotes: RemotePlayers;
  private readonly zombies: ZombieManager;
  private readonly pickups: Pickups;
  private readonly particles: Particles;
  private readonly bolts: Bolts;
  private readonly scorches: Scorches;
  private readonly viewModel: ViewModel;
  private readonly timer = new Timer();
  private hud?: Hud;
  private spawned = false;
  private lastPhase = "";
  private lastWave = 0;
  private lastCountdown = 0;
  private collectTimer = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private wasDead = false;
  private resultsTimer?: ReturnType<typeof setTimeout>;
  private wasLocked = false;
  private readonly perf: PerfOverlay;
  private lookTestEnd?: () => void;
  private sendTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private elapsed = 0;
  private lastFrameTime = 0;
  private cpuMs = 0;
  fps = 0;
  /** Settles when everything a round needs is loaded; set by `load`. */
  ready: Promise<void> = Promise.resolve();
  solo = false;
  onLeave?: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly ui: HTMLElement,
    graphics: GraphicsSetting,
    debug = false,
  ) {
    const scene = this.world.scene;
    scene.add(this.camera);
    this.renderer = new Renderer(canvas, scene, this.camera, graphics);
    this.perf = new PerfOverlay(ui, this.renderer, debug);
    this.input = new Input(canvas);
    this.player = new PlayerController(this.camera, this.input, this.colliders, LEVEL.halfSize);
    this.remotes = new RemotePlayers(scene);
    this.pickups = new Pickups(scene);
    this.particles = new Particles(scene);
    this.bolts = new Bolts(scene);
    this.scorches = new Scorches(scene);
    this.zombies = new ZombieManager(scene, this.camera, this.particles);
    this.renderer.onWorldSettings = (settings) => {
      this.world.applyGraphics(settings);
      this.zombies.shadows = settings.shadows;
    };
    this.renderer.onWorldSettings(this.renderer.quality);
    this.viewModel = new ViewModel(this.camera);
    this.weapons = new WeaponSystem({
      camera: this.camera,
      input: this.input,
      player: this.player,
      viewModel: this.viewModel,
      zombies: this.zombies,
      colliders: this.colliders,
      particles: this.particles,
      bolts: this.bolts,
      scorches: this.scorches,
      sound: this.sound,
      surface: (origin, dir, near, far, point, normal) => this.world.surfaceHit(origin, dir, near, far, point, normal),
      mates: (origin, dir, maxDistance) => this.remotes.raycast(origin, dir, maxDistance),
      friendlyFire: () => !!this.state?.friendlyFire,
      onShoot: (msg) => this.network.sendShoot(msg),
      onSwitch: (weapon) => this.network.sendWeapon(weapon),
      onHit: (head) => this.hud?.hitmarker(head),
      onHitMate: (id) => this.hud?.notice(`Careful! You hit ${this.state?.players.get(id)?.name ?? "a teammate"}`),
    });
    document.addEventListener("pointerlockchange", () => {
      if (!this.input.locked) this.finishLookTest();
    });
    const spawn = LEVEL.playerSpawns[0]!;
    this.player.spawn(spawn.x, spawn.z, Math.atan2(spawn.x, spawn.z));
  }

  get state(): GameState | undefined {
    return this.network.state;
  }

  get me(): PlayerState | undefined {
    return this.state?.players?.get(this.network.sessionId);
  }

  get finished(): boolean {
    return this.state?.phase === "ended";
  }

  get inLobby(): boolean {
    return this.state?.phase === "lobby";
  }

  /** Set during the announced pause before a wave, including the last seconds before the first one. */
  get waveCountdown(): WaveCountdown | undefined {
    const state = this.state;
    if (!state) return undefined;
    if (state.phase === "playing" && state.waveIn > 0) return { wave: state.wave + 1, seconds: Math.ceil(state.waveIn) };
    if (state.phase === "countdown" && state.timer > 0 && state.timer <= WAVE_COUNTDOWN_SECONDS) return { wave: 1, seconds: Math.ceil(state.timer) };
    return undefined;
  }

  /** Static obstacles of the level, for the map. */
  get obstacles(): Box[] {
    return this.colliders;
  }

  get arenaHalfSize(): number {
    return LEVEL.halfSize;
  }

  get aimProgress(): number {
    return this.viewModel.aimProgress;
  }

  get fov(): number {
    return this.camera.fov;
  }

  get graphics(): GraphicsSetting {
    return this.renderer.setting;
  }

  setGraphics(setting: GraphicsSetting) {
    this.renderer.setGraphics(setting);
  }

  get sensitivity(): number {
    return this.player.sensitivityScale;
  }

  setSensitivity(scale: number) {
    this.player.sensitivityScale = scale;
  }

  get lookTesting(): boolean {
    return this.lookTestEnd !== undefined;
  }

  /**
   * Locks the pointer for looking around only, so the mouse sensitivity can be felt without playing:
   * movement and weapons stay off and a solo round stays paused. `onEnd` runs once the pointer is free again.
   */
  startLookTest(onEnd: () => void) {
    this.lookTestEnd = onEnd;
    void this.input.lock().then((locked) => {
      if (!locked) this.finishLookTest();
    });
  }

  stopLookTest() {
    if (this.input.locked) this.input.unlock();
    else this.finishLookTest();
  }

  private finishLookTest() {
    const onEnd = this.lookTestEnd;
    this.lookTestEnd = undefined;
    onEnd?.();
  }

  get playerCount(): number {
    return this.remotes.count + 1;
  }

  /**
   * Resolves once the scene is on screen, which only needs the sky. The level and then the zombies keep
   * loading behind the menu; `ready` resolves when a round can start without stalling.
   */
  load(): Promise<void> {
    return new Promise((shown, failed) => {
      this.ready = this.world
        .load(() => {
          this.player.update(0, false);
          this.timer.connect(document);
          this.renderer.webgl.setAnimationLoop((time) => this.frame(time));
          shown();
        })
        .then(async () => {
          this.renderer.onWorldSettings?.(this.renderer.quality);
          await this.zombies.warmUp(this.renderer.webgl, await preloadCast());
        });
      this.ready.catch(failed);
    });
  }

  async connect(name: string, skin: string, choice: SessionChoice, settings: GameSettings, testDuration?: number) {
    this.solo = choice.mode === "solo";
    this.viewModel.setArms(skinDef(skin));
    const events: NetworkEvents = {
      playerAdded: (id, state) => {
        if (id !== this.network.sessionId) this.remotes.add(id, state);
      },
      playerRemoved: (id) => this.remotes.remove(id),
      zombieAdded: (id, zombie) => this.zombies.add(id, zombie),
      zombieChanged: (id) => this.zombies.changed(id),
      zombieRemoved: (id) => this.zombies.remove(id),
      pickupAdded: (id, pickup) => this.pickups.add(id, pickup),
      pickupRemoved: (id) => this.pickups.remove(id),
      shot: (e) => {
        const from = new Vector3(...e.origin);
        const end = new Vector3(...e.end);
        const bolt = BOLTS[e.weapon];
        // A bolt that ended on the ground, a wall or an object burns it, as the shooter saw it.
        const dir = end.clone().sub(from);
        const length = dir.length();
        const point = new Vector3();
        const normal = new Vector3();
        const marks = length > 0.01 && this.world.surfaceHit(from, dir.divideScalar(length), length - SURFACE_SEARCH.behind, length + SURFACE_SEARCH.behind, point, normal);
        this.bolts.spawn(from, end, bolt.color, bolt.width * 1.5, bolt.length, marks ? () => this.scorches.add(point, normal, bolt.color, bolt.scorch) : undefined);
        this.remotes.shot(e.by);
        const distance = from.distanceTo(this.camera.position);
        this.sound.shot(e.weapon, Math.max(0.08, 1 - distance / 50) * 0.6);
      },
      zombieHit: (e) => {
        if (e.by === this.network.sessionId) return;
        const shooter = this.state?.players?.get(e.by);
        if (shooter) this.zombies.hit(e.zombie, new Vector3(shooter.x, shooter.y + GUN_HEIGHT, shooter.z), e.head);
      },
      kill: (e) => {
        if (e.by !== this.network.sessionId) return;
        this.sound.kill();
        this.hud?.kill(e.points, e.combo, e.head);
      },
      playerHurt: (e) => {
        if (e.player !== this.network.sessionId) return;
        this.sound.hurt();
        const bearing = Math.atan2(e.fromX - this.player.position.x, e.fromZ - this.player.position.z);
        this.hud?.damage(-(bearing - this.player.yaw - Math.PI), e.damage);
      },
      pickup: (e) => {
        if (e.player !== this.network.sessionId) return;
        const health = e.kind === "health";
        if (!health) this.weapons.addReserve("rifle", e.amount);
        this.sound.pickup(health);
        this.hud?.notice(health ? `+${e.amount} health` : `+${e.amount} rifle energy`);
      },
      personalBest: (e) => this.hud?.personalBest(e),
      disconnected: () => this.hud?.disconnected(),
    };
    this.pickups.clear();
    if (choice.mode === "join") {
      await this.network.joinSession(choice.code, { name, skin }, events);
    } else {
      const isPrivate = choice.mode === "create" && choice.private;
      await this.network.createSession({ name, skin, solo: this.solo, private: isPrivate, ...settings, duration: testDuration }, events);
    }
    this.hud = new Hud(this.ui, this);
  }

  restart() {
    this.network.sendRestart();
  }

  startRound() {
    this.network.sendStart();
    this.input.lock();
  }

  changeSettings(settings: SettingsMessage) {
    this.network.sendSettings(settings);
  }

  changeSkin(skin: string) {
    this.network.sendSkin(skin);
    this.viewModel.setArms(skinDef(skin));
  }

  leave() {
    clearTimeout(this.resultsTimer);
    this.network.leave();
    this.input.unlock();
    this.hud?.destroy();
    this.hud = undefined;
    this.zombies.clear();
    this.remotes.clear();
    this.pickups.clear();
    this.scorches.clear();
    this.spawned = false;
    this.lastPhase = "";
    this.lastWave = 0;
    this.lastCountdown = 0;
    this.wasDead = false;
    this.player.dead = false;
    this.onLeave?.();
  }

  private frame(time: number) {
    const start = performance.now();
    const interval = this.lastFrameTime ? time - this.lastFrameTime : 0;
    this.lastFrameTime = time;
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.elapsed += dt;
    const state = this.state;
    const me = this.me;

    if (state && me) this.syncWithServer(state, me);

    const paused = !!state?.paused;
    const testing = this.lookTesting && this.input.locked;
    const active = this.input.locked && !testing && !this.finished && !this.inLobby && !paused && !!me;
    this.handlePointerLock();
    if (testing) this.input.consumeWheel();

    this.player.update(paused ? 0 : dt, active, active || testing);
    this.weapons.update(dt, active);

    const lookDX = (this.player.yaw - this.lastYaw) / Math.max(dt, 1e-3);
    const lookDY = (this.player.pitch - this.lastPitch) / Math.max(dt, 1e-3);
    this.lastYaw = this.player.yaw;
    this.lastPitch = this.player.pitch;
    this.viewModel.update(dt, {
      aiming: this.player.aiming,
      sprinting: this.player.sprinting,
      speed: this.player.horizontalSpeed,
      bob: this.player.bob,
      grounded: this.player.grounded,
      lookDX: -lookDX * 20,
      lookDY: -lookDY * 20,
      reload: this.weapons.reloadProgress,
      charge: this.weapons.charge,
      dead: this.player.dead,
    });

    if (!paused) this.zombies.update(dt);
    this.remotes.update(dt, this.elapsed);
    this.pickups.update(dt, this.elapsed);
    this.particles.update(dt);
    this.bolts.update(dt);
    this.scorches.update(dt);
    this.sendPosition(dt);
    if (active) this.collectEnergy(dt);
    this.hud?.update(dt);
    this.renderer.render(dt, interval, this.cpuMs);
    this.input.endFrame();
    this.countFps(dt);
    this.cpuMs = performance.now() - start;
    this.perf.update(interval, this.cpuMs);
  }

  private syncWithServer(state: GameState, me: PlayerState) {
    const restarted = this.lastPhase === "ended" && state.phase !== "ended";
    if (state.phase === "lobby" && this.lastPhase !== "lobby") this.input.unlock();
    if (!this.spawned || restarted) {
      this.spawned = true;
      this.player.spawn(me.x, me.z, Math.atan2(me.x, me.z));
      this.weapons.reset(state.energy as EnergyMode);
      clearTimeout(this.resultsTimer);
      this.hud?.hideEnd();
    } else if (this.wasDead && !me.dead) {
      this.player.spawn(me.x, me.z, Math.atan2(me.x, me.z));
      this.weapons.refillMagazine("pistol");
    }
    if (!this.wasDead && me.dead) this.sound.knockedOut();
    this.wasDead = me.dead;
    this.player.dead = me.dead;
    this.remotes.cheering = state.phase === "ended";

    const countdown = this.waveCountdown?.seconds ?? 0;
    if (countdown !== this.lastCountdown) {
      if (countdown > 0) this.sound.countdownTick();
      this.lastCountdown = countdown;
    }

    if (state.phase !== this.lastPhase || state.wave !== this.lastWave) {
      // The host may change the energy mode in the lobby, after the weapons were set up.
      if (state.phase === "countdown" && this.lastPhase === "lobby") this.weapons.reset(state.energy as EnergyMode);
      if (state.phase === "playing" && state.wave > 0) {
        this.sound.waveStart();
        this.hud?.banner(`Wave ${state.wave}`, state.wave === 1 ? "Clear every wave before the time runs out!" : "Here they come!");
      } else if (state.phase === "ended") {
        this.hud?.banner("Time's up!", "Dance party!");
        this.resultsTimer = setTimeout(() => {
          this.input.unlock();
          this.hud?.showEnd();
        }, RESULTS_DELAY_MS);
      }
      this.lastPhase = state.phase;
      this.lastWave = state.wave;
    }
  }

  private handlePointerLock() {
    const locked = this.input.locked;
    if (locked === this.wasLocked) return;
    this.wasLocked = locked;
    this.sound.unlock();
    if (this.solo && !this.finished) this.network.sendPause(!locked || this.lookTesting);
  }

  /** Asks for the energy capsules underfoot while the rifle has room for more. */
  private collectEnergy(dt: number) {
    this.collectTimer -= dt;
    const { position, dead } = this.player;
    if (this.collectTimer > 0 || dead || position.y > STAND_TOLERANCE || !this.weapons.canTake("rifle")) return;
    const near = this.pickups.energyNear(position.x, position.z, PICKUP_RADIUS);
    if (near.length === 0) return;
    this.collectTimer = COLLECT_INTERVAL;
    this.network.sendCollect(near[0]!);
  }

  private sendPosition(dt: number) {
    this.sendTimer += dt * 1000;
    if (this.sendTimer < TICK_MS || !this.spawned) return;
    this.sendTimer = 0;
    const { position, yaw, pitch } = this.player;
    this.network.sendMove({ x: position.x, y: position.y, z: position.z, yaw, pitch });
  }

  private countFps(dt: number) {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }
}