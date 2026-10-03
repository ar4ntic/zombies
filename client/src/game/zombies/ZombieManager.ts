import {
  CanvasTexture,
  Color,
  Frustum,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Sphere,
  Vector3,
  type Mesh,
  type MeshStandardMaterial,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { ZOMBIES, type ZombieState } from "@zombies/shared";
import type { Particles } from "../fx/Particles.ts";
import type { CharacterTemplate } from "./cast.ts";
import { ZombieView } from "./ZombieView.ts";

const DEATH_COLOR = new Color("#8dff6e");
/** Real shadows within this distance (times zombie scale), blob shadows beyond. */
const SHADOW_DISTANCE = 16;
const NEAR_DISTANCE = 14;
const FAR_DISTANCE = 32;
/** Switch distances to LOD 1 and LOD 2 at the default field of view. */
const LOD_DISTANCES = [9, 22];
const LOD_HYSTERESIS = 1;
const MAX_BLOBS = 128;
const TAN_HALF_BASE_FOV = Math.tan(MathUtils.degToRad(75 / 2));
const UPRIGHT = ZOMBIES.walker.hitbox;

function levelFor(distance: number, current: number): number {
  let level = 0;
  LOD_DISTANCES.forEach((d, i) => {
    if (distance > d + (current > i ? -LOD_HYSTERESIS : LOD_HYSTERESIS)) level = i + 1;
  });
  return level;
}

function blobTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(0,0,0,0.6)");
  gradient.addColorStop(0.5, "rgba(0,0,0,0.35)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

export interface ZombieRayHit {
  id: string;
  distance: number;
  head: boolean;
  point: Vector3;
}

interface Entry {
  view?: ZombieView;
  removed: boolean;
  discarded?: boolean;
}

export class ZombieManager {
  private readonly entries = new Map<string, Entry>();
  private readonly dying: ZombieView[] = [];
  private readonly tmp = new Vector3();
  private readonly frustum = new Frustum();
  private readonly projScreen = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly blobs: InstancedMesh;
  private readonly blobMatrix = new Matrix4();
  /** False when the renderer has shadows off; every zombie then gets a blob shadow. */
  shadows = true;

  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly particles: Particles,
  ) {
    this.blobs = new InstancedMesh(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      MAX_BLOBS,
    );
    this.blobs.count = 0;
    this.blobs.frustumCulled = false;
    this.blobs.matrixAutoUpdate = false;
    scene.add(this.blobs);
  }

  /** Uploads every character's textures and compiles the zombie shaders up front, so first sightings don't stall. */
  async warmUp(renderer: WebGLRenderer, templates: CharacterTemplate[]) {
    for (const template of templates) {
      template.scene.traverse((child) => {
        const material = (child as Mesh).material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
        for (const m of [material ?? []].flat()) {
          for (const texture of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.emissiveMap, m.aoMap]) {
            if (texture) renderer.initTexture(texture);
          }
        }
      });
    }
    const view = await ZombieView.create(this.scene, "warmup", { type: "walker", x: 0, z: 0, rot: 0, anim: 0 } as ZombieState);
    await renderer.compileAsync(this.scene, this.camera);
    view.dispose();
  }

  add(id: string, state: ZombieState) {
    const entry: Entry = { removed: false };
    this.entries.set(id, entry);
    void ZombieView.create(this.scene, id, state).then((view) => {
      entry.view = view;
      if (entry.discarded) view.dispose();
      else if (entry.removed) this.startDeath(view);
    });
  }

  clear() {
    for (const entry of this.entries.values()) {
      entry.discarded = true;
      entry.view?.dispose();
    }
    for (const view of this.dying) view.dispose();
    this.entries.clear();
    this.dying.length = 0;
  }

  changed(id: string) {
    this.entries.get(id)?.view?.pushSnapshot();
  }

  remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    entry.removed = true;
    if (entry.view) this.startDeath(entry.view);
  }

  hit(id: string, from: Vector3, head: boolean) {
    this.entries.get(id)?.view?.hit(from, head);
  }

  private startDeath(view: ZombieView) {
    view.die();
    this.dying.push(view);
  }

  get count(): number {
    return this.entries.size;
  }

  update(dt: number) {
    this.camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const eye = this.camera.position;
    const zoom = Math.tan(MathUtils.degToRad(this.camera.fov / 2)) / TAN_HALF_BASE_FOV;

    let blobs = 0;
    for (const { view } of this.entries.values()) {
      if (!view) continue;
      const distance = view.position.distanceTo(eye);
      this.sphere.center.copy(view.position).setY(0.9 * view.scale);
      this.sphere.radius = 1.2 * view.scale;
      const visible = this.frustum.intersectsSphere(this.sphere);
      let step = 0;
      if (!visible) step = distance > FAR_DISTANCE ? 1 / 8 : 1 / 15;
      else if (distance > FAR_DISTANCE) step = 1 / 20;
      else if (distance > NEAR_DISTANCE) step = 1 / 40;
      view.setLevel(levelFor((distance * zoom) / view.scale, view.level));
      view.setShadows(this.shadows && distance < SHADOW_DISTANCE * view.scale);
      view.update(dt, step);
      if (!view.castsShadow && !view.dying && blobs < MAX_BLOBS) {
        const size = 1.1 * view.scale;
        this.blobMatrix.makeScale(size, 1, size).setPosition(view.root.position.x, 0.02, view.root.position.z);
        this.blobs.setMatrixAt(blobs++, this.blobMatrix);
      }
    }
    this.blobs.count = blobs;
    this.blobs.instanceMatrix.needsUpdate = blobs > 0;

    for (let i = this.dying.length - 1; i >= 0; i--) {
      const view = this.dying[i]!;
      const wasDissolving = view.dissolve > 0;
      view.update(dt);
      if (view.dissolve > 0) this.emitDissolve(view, !wasDissolving, dt);
      if (view.dead) {
        view.dispose();
        this.dying.splice(i, 1);
      }
    }
  }

  private emitDissolve(view: ZombieView, burst: boolean, dt: number) {
    const s = view.scale;
    if (burst) {
      this.tmp.copy(view.position).setY(0.35 * s);
      this.particles.burst(this.tmp, {
        count: Math.round(50 * s),
        color: DEATH_COLOR,
        speed: 1.8,
        lift: 1.4,
        gravity: -0.4,
        life: 1.5,
        size: 0.05,
        jitter: new Vector3(1.4 * s, 0.5 * s, 1.4 * s),
      });
    }
    if (Math.random() < dt * 25) {
      this.tmp.copy(view.position).setY(0.15 + Math.random() * 0.5 * s);
      this.particles.burst(this.tmp, { count: 2, color: DEATH_COLOR, speed: 0.4, lift: 0.9, life: 1, size: 0.04, jitter: new Vector3(1.6 * s, 0.2, 1.6 * s) });
    }
  }

  /** Nearest zombie hit by a ray, using a head sphere and a body cylinder that follow the pose. */
  raycast(origin: Vector3, dir: Vector3, maxDistance: number): ZombieRayHit | null {
    let best: ZombieRayHit | null = null;
    for (const [id, { view }] of this.entries) {
      if (!view || view.dying) continue;
      const s = view.scale;
      const hb = view.leaning ? ZOMBIES.runner.hitbox : view.type === "runner" ? UPRIGHT : ZOMBIES[view.type].hitbox;
      const p = view.root.position;
      const fx = Math.sin(view.facing);
      const fz = Math.cos(view.facing);
      const head = raySphere(origin, dir, p.x + fx * hb.headForward * s, hb.headY * s, p.z + fz * hb.headForward * s, hb.headRadius * s);
      const body = rayCylinder(origin, dir, p.x + fx * hb.bodyForward * s, p.z + fz * hb.bodyForward * s, hb.bodyRadius * s, hb.bodyHeight * s);
      const isHead = head >= 0 && (body < 0 || head <= body + 0.05);
      const t = isHead ? head : body;
      if (t < 0 || t > maxDistance || (best && t >= best.distance)) continue;
      best = { id, distance: t, head: isHead, point: origin.clone().addScaledVector(dir, t) };
    }
    return best;
  }
}

function raySphere(o: Vector3, d: Vector3, cx: number, cy: number, cz: number, r: number): number {
  const ox = o.x - cx;
  const oy = o.y - cy;
  const oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

function rayCylinder(o: Vector3, d: Vector3, cx: number, cz: number, r: number, h: number): number {
  const ox = o.x - cx;
  const oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return -1;
  const b = ox * d.x + oz * d.z;
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0) return -1;
  const y = o.y + d.y * t;
  return y >= 0 && y <= h ? t : -1;
}
