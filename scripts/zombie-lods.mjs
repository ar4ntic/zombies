#!/usr/bin/env node
// Adds simplified level-of-detail meshes to the zombie characters in client/public/assets/characters.
// Player skins (player_*.glb) are left alone: only a few are ever on screen, always at full detail.
// Each LOD is a simplified index buffer over the body mesh's vertices, bound to the same skin and
// named "<mesh>_LOD1", "<mesh>_LOD2". Re-running replaces existing LODs. No Meshy API calls.
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "client/public/assets/characters");
/** Fraction of the full mesh's triangles kept by each LOD. */
const LODS = [0.33, 0.1];

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

function readFloats(accessor, size) {
  const count = accessor.getCount();
  const out = new Float32Array(count * size);
  const el = [];
  for (let i = 0; i < count; i++) out.set(accessor.getElement(i, el).slice(0, size), i * size);
  return out;
}

/**
 * Meshy characters have many small UV islands, so plain simplification stalls at the seams;
 * "Permissive" collapses across them while the normal/UV weights keep the texture in place.
 */
function simplify(doc, prim, ratio) {
  const positions = readFloats(prim.getAttribute("POSITION"), 3);
  const normals = readFloats(prim.getAttribute("NORMAL"), 3);
  const uvs = readFloats(prim.getAttribute("TEXCOORD_0"), 2);
  const vertexCount = positions.length / 3;
  const attributes = new Float32Array(vertexCount * 5);
  for (let i = 0; i < vertexCount; i++) {
    attributes.set(normals.subarray(i * 3, i * 3 + 3), i * 5);
    attributes.set(uvs.subarray(i * 2, i * 2 + 2), i * 5 + 3);
  }
  const indices = new Uint32Array(prim.getIndices().getArray());
  const target = Math.floor((indices.length * ratio) / 3) * 3;
  const [result] = MeshoptSimplifier.simplifyWithAttributes(
    indices, positions, 3, attributes, 5, [0.5, 0.5, 0.5, 1, 1], null, target, 0.05, ["Permissive"],
  );
  const array = vertexCount < 65536 ? new Uint16Array(result) : result;
  prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(array).setBuffer(prim.getIndices().getBuffer()));
}

const triangles = (mesh) => mesh.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);

for (const file of readdirSync(dir).filter((f) => f.endsWith(".glb") && !f.startsWith("player_"))) {
  const path = join(dir, file);
  const doc = await io.read(path);
  const nodes = doc.getRoot().listNodes();
  for (const node of nodes) if (/_LOD\d$/.test(node.getName())) node.dispose();

  const report = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    const skin = node.getSkin();
    if (!mesh || !skin) continue;
    const parent = node.getParentNode();
    report.push(triangles(mesh));
    LODS.forEach((ratio, i) => {
      const lodMesh = doc.createMesh(`${mesh.getName()}_LOD${i + 1}`);
      for (const prim of mesh.listPrimitives()) {
        const copy = prim.clone();
        simplify(doc, copy, ratio);
        lodMesh.addPrimitive(copy);
      }
      const lodNode = doc
        .createNode(`${node.getName()}_LOD${i + 1}`)
        .setMesh(lodMesh)
        .setSkin(skin)
        .setTranslation(node.getTranslation())
        .setRotation(node.getRotation())
        .setScale(node.getScale());
      if (parent) parent.addChild(lodNode);
      else doc.getRoot().getDefaultScene()?.addChild(lodNode);
      report.push(triangles(lodMesh));
    });
  }
  await doc.transform(prune());
  await io.write(path, doc);
  console.log(file.padEnd(24), report.join(" / "), "triangles");
}
