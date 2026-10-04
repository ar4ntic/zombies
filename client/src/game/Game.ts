import { PerspectiveCamera, Timer, Vector3 } from "three";
import {
  PARKING_LOT,
  TICK_MS,
  buildColliders,
  type GameState,
  type PlayerState,
  type SettingsMessage,
} from "@zombies/shared";
import { Renderer, type GraphicsSetting } from "../engine/Renderer.ts";
import { Network, type NetworkEvents } from "../net/Network.ts";
import { Hud } from "../ui/Hud.ts";
import { PerfOverlay } from "../ui/PerfOverlay.ts";
import type { GameSettings } from "../ui/Menu.ts";
import { Particles } from "./fx/Particles.ts";
import { Sound } from "./fx/Sound.ts";
import { Tracers } from "./fx/Tracers.ts";
import { Input } from "./Input.ts";
import { PlayerController } from "./PlayerController.ts";
import { RemotePlayers } from "./RemotePlayers.ts";
import { ViewModel } from "./weapons/ViewModel.ts";
import { TRACER_COLORS, WeaponSystem } from "./weapons/WeaponSystem.ts";
import { World } from "./World.ts";
import { ZombieManager } from "./zombies/ZombieManager.ts";
import { preloadCast } from "./zombies/cast.ts";

export type SessionChoice = { mode: "solo" } | { mode: "create" } | { mode: "join"; code: string };

const LEVEL = PARKING_LOT;
const RESULTS_DELAY_MS = 4500;

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
  private readonly particles: Particles;
  private readonly tracers: Tracers;
  private readonly viewModel: ViewModel;
  private readonly timer = new Timer();
  private hud?: Hud;
  private spawned = false;
  private lastPhase = "";
  private lastWave = 0;
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
    this.particles = new Particles(scene);
    this.tracers = new Tracers(scene);
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
      tracers: this.tracers,
      sound: this.sound,
      onShoot: (msg) => this.network.sendShoot(msg),
      onSwitch: (weapon) => this.network.sendWeapon(weapon),
      onHit: (head) => this.hud?.hitmarker(head),
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

  async load() {
    const [, cast] = await Promise.all([this.world.load(), preloadCast()]);
    await this.zombies.warmUp(this.renderer.webgl, cast);
    this.player.update(0, false);
    this.timer.connect(document);
    this.renderer.webgl.setAnimationLoop((time) => this.frame(time));
  }

  async connect(name: string, choice: SessionChoice, settings: GameSettings, testDuration?: number) {
    this.solo = choice.mode === "solo";
    const events: NetworkEvents = {
      playerAdded: (id, state) => {
        if (id !== this.network.sessionId) this.remotes.add(id, state);
      },
      playerRemoved: (id) => this.remotes.remove(id),
      zombieAdded: (id, zombie) => this.zombies.add(id, zombie),
      zombieChanged: (id) => this.zombies.changed(id),
      zombieRemoved: (id) => this.zombies.remove(id),
      shot: (e) => {
        const from = new Vector3(...e.origin);
        this.tracers.spawn(from, new Vector3(...e.end), TRACER_COLORS[e.weapon], 0.012);
        const distance = from.distanceTo(this.camera.position);
        this.sound.shot(e.weapon, Math.max(0.08, 1 - distance / 50) * 0.6);
      },
      zombieHit: (e) => {
        if (e.by === this.network.sessionId) return;
        const shooter = this.state?.players?.get(e.by);
        if (shooter) this.zombies.hit(e.zombie, new Vector3(shooter.x, 1.5, shooter.z), e.head);
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
      ammo: (e) => {
        this.weapons.addReserve(e.weapon, e.amount);
        this.hud?.notice(`+${e.amount} rifle ammo`);
      },
      personalBest: (e) => this.hud?.personalBest(e),
      disconnected: () => this.hud?.disconnected(),
    };
    if (choice.mode === "join") {
      await this.network.joinSession(choice.code, { name }, events);
    } else {
      await this.network.createSession({ name, solo: this.solo, ...settings, duration: testDuration }, events);
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

  leave() {
    clearTimeout(this.resultsTimer);
    this.network.leave();
    this.input.unlock();
    this.hud?.destroy();
    this.hud = undefined;
    this.zombies.clear();
    this.remotes.clear();
    this.spawned = false;
    this.lastPhase = "";
    this.lastWave = 0;
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
      dead: this.player.dead,
    });

    if (!paused) this.zombies.update(dt);
    this.remotes.update(dt, this.elapsed);
    this.particles.update(dt);
    this.tracers.update(dt);
    this.sendPosition(dt);
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
      this.weapons.reset();
      clearTimeout(this.resultsTimer);
      this.hud?.hideEnd();
    } else if (this.wasDead && !me.dead) {
      this.player.spawn(me.x, me.z, Math.atan2(me.x, me.z));
      this.weapons.refillMagazine("pistol");
    }
    if (!this.wasDead && me.dead) this.sound.knockedOut();
    this.wasDead = me.dead;
    this.player.dead = me.dead;

    if (state.phase !== this.lastPhase || state.wave !== this.lastWave) {
      if (state.phase === "playing" && state.wave > 0) {
        this.sound.waveStart();
        this.hud?.banner(`Wave ${state.wave}`, state.wave === 1 ? "Survive until the timer runs out!" : "Here they come!");
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