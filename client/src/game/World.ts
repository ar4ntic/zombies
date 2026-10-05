import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  SphereGeometry,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { LevelDef, StructurePlacement } from "@zombies/shared";
import { loadHdri, loadModel, loadPbrTextures, type PbrTextureSet } from "../engine/assets.ts";
import type { QualitySettings } from "../engine/Renderer.ts";

/** Layer seen only by the sun's shadow camera: one merged, untextured mesh of all static casters. */
const SHADOW_PROXY_LAYER = 1;
/** Props smaller than this (bounding sphere radius in m) don't cast shadows. */
const SMALL_PROP_RADIUS = 0.35;
const LAMP_COLOR = new Color("#ffb46b");
const POOL_COLOR = new Color("#ff8f3d");
const UP = new Vector3(0, 1, 0);

export class World {
  readonly scene = new Scene();
  readonly sun = new DirectionalLight(new Color("#ffcf9e"), 2.6);
  private readonly casters: BufferGeometry[] = [];
  private readonly lampLights: PointLight[] = [];
  private readonly lampPools: Mesh[] = [];
  /** The ground, walls and props a shot can leave a mark on. */
  private readonly surfaces: Object3D[] = [];
  private readonly raycaster = new Raycaster();
  private readonly hitMatrix = new Matrix4();

  constructor(private readonly level: LevelDef) {}

  async load() {
    const hdri = await loadHdri(this.level.hdri);
    this.scene.background = hdri;
    this.scene.environment = hdri;
    this.scene.environmentIntensity = 0.7;
    this.scene.backgroundIntensity = 0.85;
    this.scene.fog = new FogExp2(new Color("#a58f80"), 0.009);

    this.addLights();
    await Promise.all([this.addGround(), this.addStructures(), this.addProps(), this.addStreetLamps()]);
    this.addShadowProxy();
  }

  /**
   * Where a ray meets the visible world between `near` and `far` along it. Writes the point and the surface
   * normal there (facing the ray's origin) and returns whether anything was hit. The colliders are only boxes
   * around the props, so marks on them are placed with this instead.
   */
  surfaceHit(origin: Vector3, dir: Vector3, near: number, far: number, point: Vector3, normal: Vector3): boolean {
    this.raycaster.set(origin, dir);
    this.raycaster.near = Math.max(0, near);
    this.raycaster.far = far;
    const hit = this.raycaster.intersectObjects(this.surfaces, false)[0];
    if (!hit?.face) return false;
    const object = hit.object as Mesh | InstancedMesh;
    this.hitMatrix.copy(object.matrixWorld);
    if (hit.instanceId !== undefined && "getMatrixAt" in object) {
      object.getMatrixAt(hit.instanceId, this.hitMatrix);
      this.hitMatrix.premultiply(object.matrixWorld);
    }
    point.copy(hit.point);
    normal.copy(hit.face.normal).transformDirection(this.hitMatrix);
    if (normal.dot(dir) > 0) normal.negate();
    return true;
  }

  applyGraphics(settings: QualitySettings) {
    const shadow = this.sun.shadow;
    if (shadow.mapSize.x !== settings.shadowMapSize) {
      shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      shadow.map?.dispose();
      shadow.map = null;
    }
    for (const light of this.lampLights) light.visible = settings.lampLights;
    for (const pool of this.lampPools) pool.visible = !settings.lampLights;
  }

  private addLights() {
    const half = this.level.halfSize + 8;
    const sun = this.sun;
    sun.position.set(-40, 28, -22);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 140 });
    sun.shadow.camera.layers.enable(SHADOW_PROXY_LAYER);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.scene.add(sun);

    this.scene.add(new HemisphereLight(new Color("#b8c6ff"), new Color("#4a3a30"), 0.35));
  }

  private async addGround() {
    const size = this.level.halfSize * 2;
    const [lotTex, outsideTex] = await Promise.all([
      loadPbrTextures(this.level.groundTexture, size / 4.5),
      loadPbrTextures(this.level.outsideTexture, 60),
    ]);

    const lot = new Mesh(new PlaneGeometry(size, size), pbrMaterial(lotTex));
    lot.rotation.x = -Math.PI / 2;
    lot.receiveShadow = true;
    this.addStatic(lot, true);

    const field = new Mesh(new PlaneGeometry(300, 300), pbrMaterial(outsideTex));
    field.rotation.x = -Math.PI / 2;
    field.position.y = -0.02;
    field.receiveShadow = true;
    this.addStatic(field);
  }

  /** Structures sharing a texture are merged into one mesh. */
  private async addStructures() {
    const byTexture = new Map<string, StructurePlacement[]>();
    for (const s of this.level.structures) byTexture.set(s.texture, [...(byTexture.get(s.texture) ?? []), s]);
    await Promise.all(
      [...byTexture].map(async ([texture, structures]) => {
        const set = await loadPbrTextures(texture, 1);
        const geometries = structures.map((s) => {
          const geometry = structureGeometry(s);
          this.casters.push(positionsOnly(geometry));
          return geometry;
        });
        const mesh = new Mesh(mergeGeometries(geometries), pbrMaterial(set));
        mesh.receiveShadow = true;
        this.addStatic(mesh, true);
      }),
    );
  }

  private async addProps() {
    const byModel = new Map<string, Matrix4[]>();
    for (const prop of this.level.props) {
      const matrix = placement(prop.x, prop.z, prop.rotation ?? 0);
      byModel.set(prop.model, [...(byModel.get(prop.model) ?? []), matrix]);
    }
    await Promise.all([...byModel].map(async ([model, matrices]) => this.addInstances((await loadModel(model)).scene, matrices)));
  }

  /** Repeated props are drawn as one InstancedMesh per part; their shadows come from the proxy. */
  private addInstances(template: Object3D, placements: Matrix4[]) {
    template.updateMatrixWorld(true);
    const radius = new Box3().setFromObject(template).getBoundingSphere(new Sphere()).radius;
    const castsShadow = radius >= SMALL_PROP_RADIUS;
    const matrix = new Matrix4();
    template.traverse((child) => {
      const part = child as Mesh;
      if (!part.isMesh) return;
      if (castsShadow) {
        for (const p of placements) this.casters.push(positionsOnly(part.geometry, matrix.multiplyMatrices(p, part.matrixWorld)));
      }
      let mesh: Mesh;
      if (placements.length === 1) {
        mesh = new Mesh(part.geometry, part.material);
        mesh.applyMatrix4(matrix.multiplyMatrices(placements[0]!, part.matrixWorld));
      } else {
        const instanced = new InstancedMesh(part.geometry, part.material as Material, placements.length);
        placements.forEach((p, i) => instanced.setMatrixAt(i, matrix.multiplyMatrices(p, part.matrixWorld)));
        instanced.computeBoundingSphere();
        mesh = instanced;
      }
      mesh.receiveShadow = true;
      this.addStatic(mesh, true);
    });
  }

  private async addStreetLamps() {
    const gltf = await loadModel("street_lamp_01");
    const height = new Box3().setFromObject(gltf.scene).getSize(new Vector3()).y;
    const bulbY = height - 0.35;
    const lamps = this.level.lamps;
    this.addInstances(
      gltf.scene,
      lamps.map(({ x, z, rotation }) => placement(x, z, rotation)),
    );

    const bulbs = new InstancedMesh(
      new SphereGeometry(0.12, 16, 8),
      new MeshBasicMaterial({ color: new Color("#ffb257").multiplyScalar(12) }),
      lamps.length,
    );
    const glow = glowTexture();
    const groundPool = new PlaneGeometry(9, 9).rotateX(-Math.PI / 2);
    lamps.forEach(({ x, z, rotation }, i) => {
      bulbs.setMatrixAt(i, new Matrix4().makeTranslation(x, bulbY, z));

      const light = new PointLight(LAMP_COLOR, 30, 18, 1.6);
      light.position.set(x, bulbY, z);
      light.visible = false;
      this.lampLights.push(light);
      this.scene.add(light);

      const ground = new Mesh(groundPool, poolMaterial(glow, 0.12));
      ground.position.set(x, 0.015, z);
      this.lampPools.push(ground);
      this.addStatic(ground);

      const wall = this.wallPool(x, z, rotation, bulbY, glow);
      if (wall) this.lampPools.push(wall);
    });
    bulbs.computeBoundingSphere();
    this.addStatic(bulbs);
  }

  /** Warm light on the wall behind a lamp, where a real point light is most visible. */
  private wallPool(x: number, z: number, rotation: number, bulbY: number, glow: Texture): Mesh | undefined {
    const back = new Vector3(0, 0, -1).applyAxisAngle(UP, rotation).round();
    const alongX = back.x === 0;
    const distance = this.level.halfSize - Math.abs(alongX ? z : x);
    if (distance > 4) return;
    const probeX = x + back.x * (distance + 0.3);
    const probeZ = z + back.z * (distance + 0.3);
    const wall = this.level.structures.find(
      (s) => !s.rotation && Math.abs(s.x - probeX) <= s.width / 2 && Math.abs(s.z - probeZ) <= s.depth / 2,
    );
    if (!wall) return;

    // Clip the glow to the wall segment so it doesn't spill into the gate opening.
    const size = 8;
    const lampAlong = alongX ? x : z;
    const wallCenter = alongX ? wall.x : wall.z;
    const wallHalf = (alongX ? wall.width : wall.depth) / 2;
    const from = Math.max(lampAlong - size / 2, wallCenter - wallHalf);
    const to = Math.min(lampAlong + size / 2, wallCenter + wallHalf);
    const centerY = Math.min(bulbY, wall.height);
    const positions: number[] = [];
    const uvs: number[] = [];
    for (const [a, y] of [[from, 0], [to, 0], [from, wall.height], [to, wall.height]] as const) {
      positions.push(alongX ? a : x + back.x * (distance - 0.01), y, alongX ? z + back.z * (distance - 0.01) : a);
      uvs.push(0.5 + (a - lampAlong) / size, 0.5 + (y - centerY) / size);
    }
    const geometry = new BufferGeometry()
      .setAttribute("position", new BufferAttribute(new Float32Array(positions), 3))
      .setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    const material = poolMaterial(glow, 0.45);
    material.side = DoubleSide;
    const mesh = new Mesh(geometry, material);
    this.addStatic(mesh);
    return mesh;
  }

  private addShadowProxy() {
    const proxy = new Mesh(mergeGeometries(this.casters), new MeshBasicMaterial());
    this.casters.length = 0;
    proxy.castShadow = true;
    proxy.frustumCulled = false;
    proxy.layers.set(SHADOW_PROXY_LAYER);
    this.addStatic(proxy);
  }

  private addStatic(object: Object3D, surface = false) {
    object.updateMatrix();
    object.matrixAutoUpdate = false;
    this.scene.add(object);
    if (surface) {
      object.updateMatrixWorld(true);
      this.surfaces.push(object);
    }
  }
}

function placement(x: number, z: number, rotation: number): Matrix4 {
  return new Matrix4().compose(new Vector3(x, 0, z), new Quaternion().setFromAxisAngle(UP, rotation), new Vector3(1, 1, 1));
}

/** Float position + index copy in world space, for the merged shadow proxy. */
function positionsOnly(geometry: BufferGeometry, matrix?: Matrix4): BufferGeometry {
  const source = geometry.getAttribute("position");
  const positions = new Float32Array(source.count * 3);
  const v = new Vector3();
  for (let i = 0; i < source.count; i++) {
    v.fromBufferAttribute(source, i);
    if (matrix) v.applyMatrix4(matrix);
    v.toArray(positions, i * 3);
  }
  const result = new BufferGeometry().setAttribute("position", new BufferAttribute(positions, 3));
  const index = geometry.getIndex();
  if (index) result.setIndex(new BufferAttribute(new Uint32Array(index.array), 1));
  return result;
}

/** World-space box with per-face UVs scaled so the texture tiles at a constant world size. */
function structureGeometry(s: StructurePlacement): BufferGeometry {
  const tile = s.tile ?? 2;
  const geometry = new BoxGeometry(s.width, s.height, s.depth);
  const uv = geometry.getAttribute("uv");
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 vertices each).
  const faceSize: Array<[number, number]> = [
    [s.depth, s.height],
    [s.depth, s.height],
    [s.width, s.depth],
    [s.width, s.depth],
    [s.width, s.height],
    [s.width, s.height],
  ];
  for (let face = 0; face < 6; face++) {
    const [u, v] = faceSize[face]!;
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, uv.getX(idx) * (u / tile), uv.getY(idx) * (v / tile));
    }
  }
  geometry.rotateY(s.rotation ?? 0);
  geometry.translate(s.x, s.height / 2, s.z);
  return geometry;
}

function glowTexture(): Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgb(255,255,255)");
  gradient.addColorStop(0.25, "rgb(130,130,130)");
  gradient.addColorStop(0.55, "rgb(32,32,32)");
  gradient.addColorStop(1, "rgb(0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

/** Additive light pool, standing in for a point light that every PBR material would pay for. */
function poolMaterial(map: Texture, strength: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map,
    color: POOL_COLOR.clone().multiplyScalar(strength),
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

const materialCache = new WeakMap<Texture, MeshStandardMaterial>();

function pbrMaterial(set: PbrTextureSet): MeshStandardMaterial {
  const cached = materialCache.get(set.map);
  if (cached) return cached;
  const material = new MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    aoMap: set.arm,
    roughnessMap: set.arm,
    metalnessMap: set.arm,
    roughness: 1,
    metalness: 1,
  });
  materialCache.set(set.map, material);
  return material;
}
