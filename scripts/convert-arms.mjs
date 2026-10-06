#!/usr/bin/env node
// Downloads the first-person arms ("fps arms (rigged only)" by para, CC0, from OpenGameArt) and converts the FBX
// into the GLB and the skin texture the game loads. The archive is kept in .asset-cache/arms.
//
//   node scripts/convert-arms.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

// The three.js loaders expect a browser: images are not needed here, and the exporter reads its output through FileReader.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// three.js is a dependency of the client package only.
const three = (path) => import(pathToFileURL(join(root, "client/node_modules/three/examples/jsm", path)).href);
const { FBXLoader } = await three("loaders/FBXLoader.js");
const { GLTFExporter } = await three("exporters/GLTFExporter.js");

const source = join(root, ".asset-cache/arms");
const out = join(root, "client/public/assets/models");
const raw = join(source, "arms-raw.glb");

const ARCHIVE_URL = "https://opengameart.org/sites/default/files/fps%20arms.7z";
if (!existsSync(join(source, "FPS ARMS RIG 1.fbx"))) {
  mkdirSync(source, { recursive: true });
  const archive = join(source, "fps-arms.7z");
  const res = await fetch(ARCHIVE_URL);
  if (!res.ok) throw new Error(`download ${res.status}`);
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  // The tar of macOS and other libarchive builds unpacks 7z.
  execFileSync("tar", ["-xf", archive, "-C", source], { stdio: "inherit" });
}

const fbx = readFileSync(join(source, "FPS ARMS RIG 1.fbx"));
const scene = new FBXLoader().parse(fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.byteLength), "");
scene.traverse((object) => {
  // The skin texture ships as its own file, so one model serves bare and gloved hands.
  if (object.isMesh) for (const material of [object.material].flat()) material.map = null;
});
// The model keeps its texture coordinates although no texture is attached; see --prune-attributes below.
const glb = await new Promise((done, failed) => new GLTFExporter().parse(scene, done, failed, { binary: true }));
mkdirSync(out, { recursive: true });
writeFileSync(raw, Buffer.from(glb));
execFileSync(join(root, "node_modules/.bin/gltf-transform"), ["optimize", raw, join(out, "fps_arms.glb"), "--compress", "meshopt", "--simplify", "false", "--join", "false", "--instance", "false", "--flatten", "false", "--prune-attributes", "false"], {
  stdio: ["ignore", "ignore", "inherit"],
});
await sharp(join(source, "new_diff.png")).webp({ quality: 88 }).toFile(join(out, "fps_arms_skin.webp"));
console.log("wrote client/public/assets/models/fps_arms.glb and fps_arms_skin.webp");
