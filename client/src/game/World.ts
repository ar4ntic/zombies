import {
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  Vector3,
  type Object3D,
  type Texture,
} from "three";
import type { LevelDef, StructurePlacement } from "@zombies/shared";
import { loadHdri, loadModel, loadPbrTextures, type PbrTextureSet } from "../engine/assets.ts";

export class World {
  readonly scene = new Scene();

  constructor(private readonly level: LevelDef) {}

  async load(shadowMapSize: number) {
    const hdri = await loadHdri(this.level.hdri);
    this.scene.background = hdri;
    this.scene.environment = hdri;
    this.scene.environmentIntensity = 0.7;
    this.scene.backgroundIntensity = 0.85;
    this.scene.fog = new FogExp2(new Color("#a58f80"), 0.009);

    this.addLights(shadowMapSize);
    await Promise.all([this.addGround(), this.addStructures(), this.addProps(), this.addStreetLamps()]);
  }

  private addLights(shadowMapSize: number) {
    const half = this.level.halfSize + 8;
    const sun = new DirectionalLight(new Color("#ffcf9e"), 2.6);
    sun.position.set(-40, 28, -22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 140 });
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
    this.scene.add(lot);

    const field = new Mesh(new PlaneGeometry(300, 300), pbrMaterial(outsideTex));
    field.rotation.x = -Math.PI / 2;
    field.position.y = -0.02;
    field.receiveShadow = true;
    this.scene.add(field);
  }

  private async addStructures() {
    const textures = new Map<string, Promise<PbrTextureSet>>();
    await Promise.all(
      this.level.structures.map(async (s) => {
        let set = textures.get(s.texture);
        if (!set) {
          set = loadPbrTextures(s.texture, 1);
          textures.set(s.texture, set);
        }
        this.scene.add(structureMesh(s, await set));
      }),
    );
  }

  private async addProps() {
    await Promise.all(
      this.level.props.map(async (prop) => {
        const gltf = await loadModel(prop.model);
        const object = gltf.scene.clone();
        object.position.set(prop.x, 0, prop.z);
        object.rotation.y = prop.rotation ?? 0;
        enableShadows(object);
        this.scene.add(object);
      }),
    );
  }

  private async addStreetLamps() {
    const gltf = await loadModel("street_lamp_01");
    const height = new Box3().setFromObject(gltf.scene).getSize(new Vector3()).y;
    const bulbMaterial = new MeshStandardMaterial({ color: "#ffd9a0", emissive: "#ffb257", emissiveIntensity: 12 });

    for (const { x, z, rotation } of this.level.lamps) {
      const lamp = new Group();
      const model = gltf.scene.clone();
      enableShadows(model);
      lamp.add(model);

      const bulb = new Mesh(new SphereGeometry(0.12, 16, 8), bulbMaterial);
      bulb.position.set(0, height - 0.35, 0);
      lamp.add(bulb);

      const light = new PointLight(new Color("#ffb46b"), 30, 18, 1.6);
      light.position.copy(bulb.position);
      lamp.add(light);

      lamp.position.set(x, 0, z);
      lamp.rotation.y = rotation;
      this.scene.add(lamp);
    }
  }
}

/** Box with per-face UVs scaled so the texture tiles at a constant world size. */
function structureMesh(s: StructurePlacement, set: PbrTextureSet): Mesh {
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
  const mesh = new Mesh(geometry, pbrMaterial(set));
  mesh.position.set(s.x, s.height / 2, s.z);
  mesh.rotation.y = s.rotation ?? 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
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

export function enableShadows(object: Object3D) {
  object.traverse((child) => {
    if ((child as Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}
