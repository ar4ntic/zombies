#!/usr/bin/env node
// Renders the banner at the top of the README, docs/banner.png, from client/public/logo.svg and the night street
// of the main menu's backdrop.
//
//   node scripts/make-banner.mjs
//
// The text is drawn with the fonts installed on the machine; the logo asks for Arial Black.
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIDTH = 1280;
const HEIGHT = 396;
const SCALE = 2;

const SKIN = "#a5ec92";
const OUTLINE = "#12261a";

/** Small deterministic generator, so the stars stay where they are between renders. */
function randomizer(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stars(count) {
  const random = randomizer(7);
  let dots = "";
  for (let i = 0; i < count; i++) {
    const [x, y, r, o] = [random() * WIDTH, random() * 250, 0.6 + random() * 1.2, 0.35 + random() * 0.6];
    dots += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" opacity="${o.toFixed(2)}"/>`;
  }
  return `<g fill="#d6f5d2">${dots}</g>`;
}

/** A shuffling zombie as on the menu's street, standing on the ground at `x`, `scale` times 100 x 160 units. */
function zombie(x, scale, shirt, pants, flip = false) {
  const turn = flip ? `translate(${x + 100 * scale} ${330 - 156 * scale}) scale(${-scale} ${scale})` : `translate(${x} ${330 - 156 * scale}) scale(${scale})`;
  return `
    <g transform="${turn}" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round">
      <ellipse cx="50" cy="155" rx="30" ry="4.5" fill="rgba(0,0,0,.45)" stroke="none"/>
      <g transform="rotate(-14 48 100)"><rect x="41" y="98" width="14" height="50" rx="7" fill="${pants}"/><rect x="39" y="142" width="25" height="12" rx="6" fill="#1b2a22"/></g>
      <rect x="46" y="60" width="40" height="12" rx="6" fill="${shirt}"/><circle cx="88" cy="66" r="7" fill="${SKIN}"/>
      <rect x="30" y="56" width="36" height="56" rx="15" fill="${shirt}" transform="rotate(7 48 104)"/>
      <g transform="rotate(12 48 100)"><rect x="41" y="98" width="14" height="50" rx="7" fill="${pants}"/><rect x="39" y="142" width="25" height="12" rx="6" fill="#1b2a22"/></g>
      <rect x="46" y="70" width="40" height="12" rx="6" fill="${shirt}"/><circle cx="88" cy="76" r="7" fill="${SKIN}"/>
      <g transform="translate(52 36) scale(1.5) translate(-32 -34)" stroke-width="1.8">
        <ellipse cx="32" cy="34" rx="15.5" ry="14.5" fill="${SKIN}"/>
        <path d="M19 28c2-7 8-10 14-9-4 2-6 4-7 7-2-1-5 0-7 2z" fill="#5fae5a" stroke="none"/>
        <circle cx="26" cy="32" r="6" fill="#fff"/><circle cx="27.2" cy="32.8" r="2.5" fill="${OUTLINE}" stroke="none"/>
        <circle cx="39.5" cy="34" r="3.8" fill="#fff"/><circle cx="39" cy="34.4" r="1.6" fill="${OUTLINE}" stroke="none"/>
        <path d="M24 42.5c5 3.2 11 3.2 16-.4" fill="none" stroke-width="2" stroke-linecap="round"/>
        <path d="M28 42.4v3.2M32 43.4v3.2M36 42.8v3.2" fill="none" stroke-width="1.6" stroke-linecap="round"/>
      </g>
    </g>`;
}

/** A row of houses along the street. Windows stay dark behind the title and the tagline. */
function houses(seed) {
  const random = randomizer(seed);
  let walls = "";
  let roofs = "";
  let windows = "";
  for (let x = -20; x < WIDTH; ) {
    const w = 110 + random() * 90;
    const h = 46 + random() * 44;
    const top = 330 - h;
    walls += `<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}"/>`;
    roofs += `<path d="M${(x - 8).toFixed(0)} ${(top + 2).toFixed(0)} ${(x + w / 2).toFixed(0)} ${(top - 34 - random() * 16).toFixed(0)} ${(x + w + 8).toFixed(0)} ${(top + 2).toFixed(0)}Z"/>`;
    for (let wx = x + 16; wx < x + w - 30; wx += 34) {
      const lit = random() < 0.3 && (wx < 300 || wx > 1000);
      windows += `<rect x="${wx.toFixed(0)}" y="${(top + 14).toFixed(0)}" width="18" height="20" fill="${lit ? "#ffd27a" : "#14271f"}" opacity="${lit ? 0.85 : 1}"/>`;
    }
    x += w + 30 + random() * 60;
  }
  return `<g fill="#0a1b14">${walls}</g><g fill="#0e271c">${roofs}</g>${windows}`;
}

function banner(logo) {
  const logoWidth = 620;
  const logoHeight = (logoWidth * 160) / 560;
  const nested = logo.replace(/^<svg /, `<svg x="${(WIDTH - logoWidth) / 2}" y="78" width="${logoWidth}" height="${logoHeight}" `);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH * SCALE}" height="${HEIGHT * SCALE}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050c09"/><stop offset=".75" stop-color="#10291d"/></linearGradient>
    <radialGradient id="halo"><stop offset=".36" stop-color="#7dff6a" stop-opacity=".28"/><stop offset="1" stop-color="#7dff6a" stop-opacity="0"/></radialGradient>
    <radialGradient id="moon" cx=".4" cy=".36" r=".75"><stop offset="0" stop-color="#f6fff0"/><stop offset=".7" stop-color="#cdf6be"/><stop offset="1" stop-color="#9edb8f"/></radialGradient>
    <radialGradient id="spot" cx=".5" cy=".42" r=".55"><stop offset="0" stop-color="#0c1d15" stop-opacity=".85"/><stop offset="1" stop-color="#0c1d15" stop-opacity="0"/></radialGradient>
    <linearGradient id="street" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#18281f"/><stop offset="1" stop-color="#070d0a"/></linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>
  ${stars(110)}
  <circle cx="1090" cy="120" r="230" fill="url(#halo)"/>
  <circle cx="1090" cy="120" r="70" fill="url(#moon)"/>
  <g fill="#7fc474" opacity=".34"><circle cx="1064" cy="92" r="12"/><circle cx="1114" cy="108" r="8"/><circle cx="1084" cy="146" r="10"/></g>
  <path fill="#0f2a1f" d="M0 280C140 262 260 276 380 266S620 250 760 266 1000 280 1130 262 1240 256 1280 262V340H0Z"/>
  ${houses(11)}
  <rect x="0" y="330" width="${WIDTH}" height="90" fill="url(#street)"/>
  <rect x="0" y="330" width="${WIDTH}" height="8" fill="#22352b"/>
  <path d="M60 368h60M220 368h60M380 368h60M540 368h60M700 368h60M860 368h60M1020 368h60M1180 368h60" stroke="rgba(255,255,255,.07)" stroke-width="5"/>
  ${zombie(70, 1.05, "#e0a23c", "#34506e")}
  ${zombie(190, 0.8, "#7c6bd1", "#2b3350")}
  ${zombie(1000, 0.85, "#3f86a8", "#263a48", true)}
  ${zombie(1110, 1.1, "#e8884a", "#2c3a4c", true)}
  <ellipse cx="${WIDTH / 2}" cy="190" rx="460" ry="190" fill="url(#spot)"/>
  ${nested}
  <text x="${WIDTH / 2}" y="292" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-weight="700" font-size="21"
    letter-spacing="4.5" fill="#cfe8c8">CO-OP ZOMBIE SURVIVAL IN YOUR BROWSER</text>
</svg>`;
}

const logo = (await readFile(join(root, "client/public/logo.svg"), "utf8")).trim();
await mkdir(join(root, "docs"), { recursive: true });
const out = join(root, "docs/banner.png");
await sharp(Buffer.from(banner(logo))).png({ compressionLevel: 9, palette: false }).toFile(out);
console.log(`docs/banner.png ${WIDTH * SCALE}x${HEIGHT * SCALE}`);
