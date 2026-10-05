#!/usr/bin/env node
// Renders the PNG icons that browsers and phones ask for from client/public/favicon.svg.
//
//   node scripts/make-icons.mjs
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "client/public");
const ICONS = [
  { file: "favicon-32.png", size: 32 },
  { file: "apple-touch-icon.png", size: 180 },
];

for (const { file, size } of ICONS) {
  await sharp(join(dir, "favicon.svg"), { density: (72 * size) / 64 }).resize(size, size).png().toFile(join(dir, file));
  console.log(`${file} ${size}x${size}`);
}
