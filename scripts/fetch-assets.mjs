#!/usr/bin/env node
// Downloads third-party art assets and converts them into web-ready files under
// client/public/assets. Re-run with --force to re-download everything.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "client/public/assets");
const cache = join(root, ".asset-cache");
const force = process.argv.includes("--force");
const gltfTransform = join(root, "node_modules/.bin/gltf-transform");

const HDRIS = [{ id: "suburban_parking_area", res: "2k" }];

const TEXTURES = [
  "asphalt_02",
  "sparse_grass",
  "concrete_floor_worn_001",
  "red_brick_03",
  "painted_plaster_wall",
];

const MODELS = [
  "barrel_03",
  "wooden_crate_02",
  "concrete_road_barrier",
  "street_lamp_01",
  "metal_trash_can",
  "fire_hydrant",
  "covered_car",
  "utility_box_01",
  "modular_chainlink_fence",
  "old_military_crate",
  "ammo_box",
  "medical_box",
  "portable_generator",
  "trashbag",
  "cardboard_box_01",
  "dead_tree_trunk",
  "wooden_picnic_table",
];

const credits = [];

async function download(url, dest) {
  if (existsSync(dest) && !force) return;
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log("  downloaded", url.split("/").pop());
}

async function polyhavenFiles(id) {
  const res = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!res.ok) throw new Error(`Poly Haven files ${id}: ${res.status}`);
  return res.json();
}

async function polyhavenCredit(id) {
  const res = await fetch(`https://api.polyhaven.com/info/${id}`);
  const info = await res.json();
  const authors = Object.keys(info.authors ?? {}).join(", ");
  credits.push(`${info.name ?? id} by ${authors} (https://polyhaven.com/a/${id}), CC0`);
}

async function fetchHdri({ id, res }) {
  const dest = join(out, "hdri", `${id}.hdr`);
  const files = await polyhavenFiles(id);
  await download(files.hdri[res].hdr.url, dest);
  await polyhavenCredit(id);
}

async function fetchTexture(id) {
  await polyhavenCredit(id);
  const maps = ["diff", "nor", "arm"];
  if (!force && maps.every((m) => existsSync(join(out, "textures", id, `${m}.webp`)))) return;
  const files = await polyhavenFiles(id);
  const urls = { diff: files.Diffuse, nor: files.nor_gl, arm: files.arm };
  for (const map of maps) {
    const src = join(cache, "textures", id, `${map}.jpg`);
    await download(urls[map]["2k"].jpg.url, src);
    const dest = join(out, "textures", id, `${map}.webp`);
    mkdirSync(dirname(dest), { recursive: true });
    await sharp(src).webp({ quality: map === "diff" ? 82 : 90 }).toFile(dest);
  }
  console.log("  converted", id);
}

async function fetchModel(id) {
  const dest = join(out, "models", `${id}.glb`);
  await polyhavenCredit(id);
  if (existsSync(dest) && !force) return;
  const files = await polyhavenFiles(id);
  const gltf = files.gltf["1k"].gltf;
  const srcDir = join(cache, "models", id);
  const srcFile = join(srcDir, `${id}.gltf`);
  await download(gltf.url, srcFile);
  for (const [rel, file] of Object.entries(gltf.include)) {
    await download(file.url, join(srcDir, rel));
  }
  optimize(srcFile, dest, ["--texture-size", "1024"]);
}

function optimize(src, dest, extra) {
  mkdirSync(dirname(dest), { recursive: true });
  execFileSync(
    gltfTransform,
    ["optimize", src, dest, "--compress", "meshopt", "--texture-compress", "webp", ...extra],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  console.log("  optimized", dest.replace(root + "/", ""));
}

if (force) rmSync(cache, { recursive: true, force: true });

console.log("HDRIs");
for (const h of HDRIS) await fetchHdri(h);
console.log("Textures");
for (const t of TEXTURES) await fetchTexture(t);
console.log("Models");
for (const m of MODELS) await fetchModel(m);
writeFileSync(join(out, "CREDITS.txt"), credits.join("\n") + "\n");
console.log(`Done. ${credits.length} credited assets.`);
