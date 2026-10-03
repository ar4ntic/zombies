import {
  EquirectangularReflectionMapping,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type DataTexture,
  type Texture,
} from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const textureLoader = new TextureLoader();
const hdrLoader = new HDRLoader();

const gltfCache = new Map<string, Promise<GLTF>>();

export function loadModel(name: string): Promise<GLTF> {
  return loadGltf(`/assets/models/${name}.glb`);
}

export function loadCharacter(name: string): Promise<GLTF> {
  return loadGltf(`/assets/characters/${name}.glb`);
}

function loadGltf(url: string): Promise<GLTF> {
  let promise = gltfCache.get(url);
  if (!promise) {
    promise = gltfLoader.loadAsync(url);
    gltfCache.set(url, promise);
  }
  return promise;
}

export async function loadHdri(name: string): Promise<DataTexture> {
  const texture = await hdrLoader.loadAsync(`/assets/hdri/${name}.hdr`);
  texture.mapping = EquirectangularReflectionMapping;
  return texture;
}

export interface PbrTextureSet {
  map: Texture;
  normalMap: Texture;
  /** Packed ambient occlusion (R), roughness (G), metalness (B). */
  arm: Texture;
}

export async function loadPbrTextures(name: string, repeat: number): Promise<PbrTextureSet> {
  const base = `/assets/textures/${name}`;
  const [map, normalMap, arm] = await Promise.all([
    textureLoader.loadAsync(`${base}/diff.webp`),
    textureLoader.loadAsync(`${base}/nor.webp`),
    textureLoader.loadAsync(`${base}/arm.webp`),
  ]);
  map.colorSpace = SRGBColorSpace;
  for (const texture of [map, normalMap, arm]) {
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = 8;
  }
  return { map, normalMap, arm };
}
