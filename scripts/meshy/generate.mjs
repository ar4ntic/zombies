#!/usr/bin/env node
// Generates rigged, animated zombie characters and player skins, and static four-legged zombies, with the Meshy API.
//
//   node scripts/meshy/generate.mjs <id...|zombies|players|animals|all> [--until=preview|refine|rig|animate|export] [--fresh]
//
// Progress (task ids) is stored in scripts/meshy/state/<id>.json so re-running resumes
// without paying for finished steps again, and separate characters can run in parallel.
// --fresh forgets the progress of the named characters and generates them anew, paying for every step again.
// Requires MESHY_API_KEY in .env.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { ANIMALS, ANIMATIONS, CAST, PLAYER_ANIMATIONS, PLAYERS } from "./cast.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stateDir = join(root, "scripts/meshy/state");
const cacheDir = join(root, ".asset-cache/meshy");
const outDir = join(root, "client/public/assets/characters");
const gltfTransform = join(root, "node_modules/.bin/gltf-transform");
const API = "https://api.meshy.ai/openapi";
const STEPS = ["preview", "refine", "rig", "animate", "export"];
const THUMBNAIL_SIZE = 256;
/** Square around the head in Meshy's full-body render, as fractions of its size. */
const PORTRAIT = { left: 0.31, top: 0.04, size: 0.38 };

// Player skins are seen from further away than the zombies in the player's face, and ten of them have to load.
// Animals have no animations: they skip rigging and are exported as textured meshes.
const GROUPS = {
  zombies: CAST.map((c) => ({ ...c, animations: ANIMATIONS, textureSize: 2048, polycount: 30000, thumbnail: false })),
  players: PLAYERS.map((c) => ({ ...c, animations: PLAYER_ANIMATIONS, textureSize: 1024, polycount: 30000, thumbnail: true })),
  animals: ANIMALS.map((c) => ({ ...c, animations: null, textureSize: 1024, polycount: 12000, thumbnail: false })),
};
const CHARACTERS = Object.values(GROUPS).flat();

const apiKey = process.env.MESHY_API_KEY ?? readEnvKey();
if (!apiKey) throw new Error("MESHY_API_KEY missing (add it to .env)");

const args = process.argv.slice(2);
const until = args.find((a) => a.startsWith("--until="))?.split("=")[1] ?? "export";
if (!STEPS.includes(until)) throw new Error(`--until must be one of ${STEPS.join(", ")}`);
const ids = args.filter((a) => !a.startsWith("--"));
const targets = ids.includes("all")
  ? CHARACTERS
  : CHARACTERS.filter((c) => ids.includes(c.id) || Object.entries(GROUPS).some(([group, cast]) => ids.includes(group) && cast.includes(c)));
if (targets.length === 0) throw new Error(`Pick characters: all | ${[...Object.keys(GROUPS), ...CHARACTERS.map((c) => c.id)].join(" | ")}`);

const fresh = args.includes("--fresh");
const state = {};
for (const char of targets) {
  const file = join(stateDir, `${char.id}.json`);
  state[char.id] = existsSync(file) && !fresh ? JSON.parse(readFileSync(file, "utf8")) : {};
}
const saveState = () => {
  mkdirSync(stateDir, { recursive: true });
  for (const char of targets) {
    writeFileSync(join(stateDir, `${char.id}.json`), JSON.stringify(state[char.id], null, 2) + "\n");
  }
};

function readEnvKey() {
  const envFile = join(root, ".env");
  if (!existsSync(envFile)) return undefined;
  return readFileSync(envFile, "utf8").match(/^MESHY_API_KEY=(.+)$/m)?.[1]?.trim();
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function waitFor(path, label) {
  for (;;) {
    const task = await api("GET", path);
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED") {
      throw new Error(`${label} ${task.status}: ${JSON.stringify(task.task_error ?? task)}`);
    }
    process.stdout.write(`\r  ${label}: ${task.status} ${task.progress ?? 0}%   `);
    await new Promise((r) => setTimeout(r, 8000));
  }
}

async function step(char, name, create, poll) {
  const s = (state[char.id] ??= {});
  if (!s[name]) {
    s[name] = (await create()).result;
    saveState();
    console.log(`  ${name} task created: ${s[name]}`);
  }
  const task = await waitFor(poll(s[name]), `${char.id} ${name}`);
  process.stdout.write("\n");
  return task;
}

async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

const reached = (name) => STEPS.indexOf(name) <= STEPS.indexOf(until);

/**
 * Pins the hip bone's horizontal position to its rest pose in every clip, so the
 * game controls where characters go. Vertical motion (bobbing, falling) is kept.
 */
async function removeRootMotion(src, dest) {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
  const doc = await io.read(src);
  const hips = doc.getRoot().listNodes().find((n) => n.getName() === "Hips");
  if (!hips) throw new Error("Hips bone not found");
  const [restX, , restZ] = hips.getTranslation();
  for (const anim of doc.getRoot().listAnimations()) {
    for (const channel of anim.listChannels()) {
      if (channel.getTargetNode() !== hips || channel.getTargetPath() !== "translation") continue;
      const output = channel.getSampler().getOutput();
      const values = output.getArray().slice();
      for (let i = 0; i < values.length; i += 3) {
        values[i] = restX;
        values[i + 2] = restZ;
      }
      output.setArray(values);
    }
  }
  await io.write(dest, doc);
}

/** Writes the compressed model the game loads. */
function optimize(src, char) {
  const dest = join(outDir, `${char.id}.glb`);
  mkdirSync(outDir, { recursive: true });
  execFileSync(
    gltfTransform,
    [
      "optimize",
      src,
      dest,
      "--compress", "meshopt",
      "--texture-compress", "webp",
      "--texture-size", String(char.textureSize),
      "--simplify", "false",
      "--join", "false",
      "--instance", "false",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  console.log(`  exported ${dest.replace(root + "/", "")}`);
}

for (const char of targets) {
  console.log(`\n== ${char.id}`);
  const dir = join(cacheDir, char.id);

  const preview = await step(
    char,
    "preview",
    () =>
      api("POST", "/v2/text-to-3d", {
        mode: "preview",
        prompt: char.prompt,
        ai_model: "latest",
        ...(char.animations ? { pose_mode: "a-pose" } : {}),
        should_remesh: true,
        topology: "triangle",
        target_polycount: char.polycount,
        target_formats: ["glb"],
      }),
    (id) => `/v2/text-to-3d/${id}`,
  );
  await download(preview.thumbnail_url, join(dir, "preview.png"));
  console.log(`  preview thumbnail: ${join(dir, "preview.png")}`);
  if (!reached("refine")) continue;

  const refine = await step(
    char,
    "refine",
    () =>
      api("POST", "/v2/text-to-3d", {
        mode: "refine",
        preview_task_id: state[char.id].preview,
        enable_pbr: true,
        texture_resolution: "2k",
        texture_prompt: char.texture,
        target_formats: ["glb"],
      }),
    (id) => `/v2/text-to-3d/${id}`,
  );
  await download(refine.thumbnail_url, join(dir, "refine.png"));
  await download(refine.model_urls.glb, join(dir, "textured.glb"));
  console.log(`  textured thumbnail: ${join(dir, "refine.png")}`);
  if (!char.animations) {
    if (reached("export")) optimize(join(dir, "textured.glb"), char);
    continue;
  }
  if (!reached("rig")) continue;

  await step(
    char,
    "rig",
    () => api("POST", "/v1/rigging", { input_task_id: state[char.id].refine, height_meters: 1.8 }),
    (id) => `/v1/rigging/${id}`,
  );
  if (!reached("animate")) continue;

  const anim = await step(
    char,
    "animate",
    () =>
      api("POST", "/v1/animations", {
        rig_task_id: state[char.id].rig,
        action_ids: char.animations.map((a) => a.actionId),
      }),
    (id) => `/v1/animations/${id}`,
  );
  const animUrl = anim.result?.animation_glb_url ?? anim.animation_glb_url;
  await download(animUrl, join(dir, "animated.glb"));
  if (!reached("export")) continue;

  const inPlace = join(dir, "in-place.glb");
  await removeRootMotion(join(dir, "animated.glb"), inPlace);
  optimize(inPlace, char);
  if (char.thumbnail) {
    const thumb = join(outDir, "thumbs", `${char.id}.webp`);
    mkdirSync(dirname(thumb), { recursive: true });
    const render = sharp(join(dir, "refine.png"));
    const { width, height } = await render.metadata();
    const size = Math.round(Math.min(width, height) * PORTRAIT.size);
    await render
      .extract({ left: Math.round(width * PORTRAIT.left), top: Math.round(height * PORTRAIT.top), width: size, height: size })
      .flatten({ background: "#e9edf0" })
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
      .webp({ quality: 86 })
      .toFile(thumb);
    console.log(`  thumbnail ${thumb.replace(root + "/", "")}`);
  }
}
