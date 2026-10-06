/**
 * The illustrated night street behind the main menu. It is drawn from markup and styles alone, so it is on
 * screen before the level has loaded.
 *
 * Everything is laid out on a 1600 x 900 stage that covers the viewport. Whatever moves is an element of
 * its own that only animates `transform` or `opacity`, which the browser can do without repainting the
 * scenery behind it.
 */

type Rect = [x: number, y: number, width: number, height: number];
type Hat = "tuft" | "hardhat" | "chef" | "cap" | "band" | "bun";

interface Walker {
  hat: Hat;
  shirt: string;
  pants: string;
  /** Stage units: width of the figure and how far above the lower edge it walks. */
  width: number;
  bottom: number;
  /** Seconds to cross the stage, and seconds a step takes. */
  seconds: number;
  step: number;
  /** Where on its way the figure starts, 0 to 1. */
  start: number;
  /** Walks from right to left. */
  back?: boolean;
  far?: boolean;
}

const WALKERS: Walker[] = [
  { hat: "cap", shirt: "#4a78b5", pants: "#27384d", width: 60, bottom: 186, seconds: 118, step: 0.74, start: 0.07, far: true },
  { hat: "bun", shirt: "#b58ac2", pants: "#4a3a55", width: 56, bottom: 182, seconds: 150, step: 0.9, start: 0.52, far: true, back: true },
  { hat: "tuft", shirt: "#d9a441", pants: "#3b4a44", width: 62, bottom: 176, seconds: 104, step: 0.68, start: 0.83, far: true },
  { hat: "band", shirt: "#e8884a", pants: "#2c3a4c", width: 58, bottom: 172, seconds: 96, step: 0.6, start: 0.3, far: true, back: true },
  { hat: "hardhat", shirt: "#e0a23c", pants: "#34506e", width: 118, bottom: 52, seconds: 84, step: 0.82, start: 0.12 },
  { hat: "chef", shirt: "#e9ede6", pants: "#3a3f47", width: 124, bottom: 40, seconds: 97, step: 0.92, start: 0.86, back: true },
  { hat: "tuft", shirt: "#7c6bd1", pants: "#2b3350", width: 112, bottom: 30, seconds: 76, step: 0.7, start: 0.62 },
  { hat: "cap", shirt: "#3f86a8", pants: "#263a48", width: 128, bottom: 16, seconds: 110, step: 1, start: 0.38, back: true },
];

const SKIN = "#a5ec92";
const SKIN_SHADE = "#8fd67d";
const OUTLINE = "#12261a";

const HATS: Record<Hat, string> = {
  tuft: "",
  hardhat: `<path d="M17.5 25C17.5 12 46.5 12 46.5 25Z" fill="#f2c14e"/><rect x="14" y="23.5" width="36" height="4" rx="2" fill="#f2c14e"/>`,
  chef: `<circle cx="24" cy="15" r="6.5" fill="#f1f4ee"/><circle cx="40" cy="15" r="6.5" fill="#f1f4ee"/><circle cx="32" cy="12" r="8" fill="#f1f4ee"/>
    <rect x="21" y="17" width="22" height="8" rx="2" fill="#f1f4ee"/>`,
  cap: `<path d="M18 26C18 13 46 13 46 26Z" fill="#3b6ea8"/><rect x="41" y="23" width="18" height="4.4" rx="2.2" fill="#2c5788"/>`,
  band: `<path d="M17.4 27.5Q32 21 46.6 28.5" fill="none" stroke="#ffb347" stroke-width="4.2"/>`,
  bun: `<circle cx="32" cy="15.5" r="5.5" fill="#cfd5da"/><path d="M17.5 28C19 16 45 16 46.5 28C40 22 24 22 17.5 28Z" fill="#cfd5da"/>`,
};

/** The face of the logo, in the logo's own coordinates. */
function face(hat: Hat): string {
  return `
    <g transform="translate(52 36) scale(1.5) translate(-32 -34)" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round">
      <ellipse cx="32" cy="34" rx="15.5" ry="14.5" fill="${SKIN}"/>
      <path d="M19 28c2-7 8-10 14-9-4 2-6 4-7 7-2-1-5 0-7 2z" fill="#5fae5a" stroke="none"/>
      ${HATS[hat]}
      <circle cx="26" cy="32" r="6" fill="#fff"/>
      <circle cx="27.2" cy="32.8" r="2.5" fill="${OUTLINE}" stroke="none"/>
      <circle cx="39.5" cy="34" r="3.8" fill="#fff"/>
      <circle cx="39" cy="34.4" r="1.6" fill="${OUTLINE}" stroke="none"/>
      <path d="M24 42.5c5 3.2 11 3.2 16-.4" fill="none" stroke-width="2" stroke-linecap="round"/>
      <path d="M28 42.4v3.2M32 43.4v3.2M36 42.8v3.2" fill="none" stroke-width="1.6" stroke-linecap="round"/>
    </g>`;
}

function walker(w: Walker): string {
  // The limbs on the far side of the body are the same shapes, darkened.
  const shade = (far: boolean, shape: string) => (far ? `<${shape} fill="rgba(0,0,0,.26)" stroke="none"/>` : "");
  const leg = (far: boolean) => `
    <g class="bd-leg ${far ? "b" : "f"}">
      <rect x="41" y="98" width="14" height="50" rx="7" fill="${w.pants}"/>
      <rect x="39" y="142" width="25" height="12" rx="6" fill="#1b2a22"/>
      ${shade(far, 'rect x="41" y="98" width="14" height="46" rx="7"')}
    </g>`;
  const arm = (far: boolean, y: number) => `
    <g class="bd-arm ${far ? "b" : "f"}">
      <rect x="46" y="${y}" width="40" height="12" rx="6" fill="${w.shirt}"/>
      <circle cx="88" cy="${y + 6}" r="7" fill="${SKIN}"/>
      ${shade(far, `rect x="46" y="${y}" width="49" height="12" rx="6"`)}
    </g>`;
  const style = `--w:${w.width};--y:${w.bottom};--t:${w.seconds}s;--d:${(-w.start * w.seconds).toFixed(1)}s;--step:${w.step}s`;
  return `
    <div class="bd-walker${w.far ? " far" : ""}${w.back ? " back" : ""}" style="${style}">
      <svg viewBox="0 0 100 160">
        <ellipse cx="50" cy="155" rx="30" ry="4.5" fill="rgba(0,0,0,.4)"/>
        <g class="bd-bob" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round">
          ${leg(true)}
          ${arm(true, 60)}
          <rect x="30" y="56" width="36" height="56" rx="15" fill="${w.shirt}" transform="rotate(7 48 104)"/>
          ${leg(false)}
          ${arm(false, 68)}
          <g class="bd-head">${face(w.hat)}</g>
        </g>
      </svg>
    </div>`;
}

const DOG = `
  <div class="bd-walker dog" style="--w:104;--y:8;--t:34s;--d:-21s;--step:0.3s">
    <svg viewBox="0 0 130 90">
      <ellipse cx="66" cy="86" rx="44" ry="4" fill="rgba(0,0,0,.4)"/>
      <g class="bd-bob" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round">
        <path class="bd-tail" d="M30 46C18 44 12 34 16 22" fill="none" stroke="${SKIN_SHADE}" stroke-width="7" stroke-linecap="round"/>
        <rect class="bd-paw b" x="38" y="56" width="10" height="28" rx="5" fill="#74b866"/>
        <rect class="bd-paw f" x="78" y="56" width="10" height="28" rx="5" fill="#74b866"/>
        <rect x="26" y="36" width="70" height="30" rx="15" fill="${SKIN_SHADE}"/>
        <rect class="bd-paw f" x="30" y="56" width="10" height="28" rx="5" fill="${SKIN_SHADE}"/>
        <rect class="bd-paw b" x="86" y="56" width="10" height="28" rx="5" fill="${SKIN_SHADE}"/>
        <g class="bd-head">
          <circle cx="100" cy="32" r="18" fill="${SKIN}"/>
          <rect x="106" y="34" width="22" height="14" rx="7" fill="${SKIN}"/>
          <circle cx="126" cy="38" r="3" fill="${OUTLINE}" stroke="none"/>
          <path d="M84 44q6 8 16 8" fill="none" stroke="#ffb347" stroke-width="5" stroke-linecap="round"/>
          <path d="M90 16q-10 8-5 22q10-6 11-18z" fill="#5fae5a"/>
          <circle cx="101" cy="28" r="6" fill="#fff" stroke-width="1.8"/>
          <circle cx="102.4" cy="28.6" r="2.5" fill="${OUTLINE}" stroke="none"/>
          <path d="M108 48q8 4 16 0" fill="none" stroke-width="2" stroke-linecap="round"/>
        </g>
      </g>
    </svg>
  </div>`;

/** Small deterministic generator, so the stars and sparks sit in the same places on every visit. */
function randomizer(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = randomizer(7);

function stars(count: number, seconds: number, delay: number): string {
  let dots = "";
  for (let i = 0; i < count; i++) {
    const [x, y, r] = [random() * 1600, random() * 520, 0.7 + random() * 1.3];
    dots += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}"/>`;
  }
  return `<svg class="bd-layer bd-stars" style="--t:${seconds}s;--d:${delay}s" viewBox="0 0 1600 900" fill="#d6f5d2">${dots}</svg>`;
}

function sparks(count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) {
    const [x, y, size, seconds] = [random() * 1600, 40 + random() * 330, 3 + random() * 4, 9 + random() * 10];
    out += `<i class="bd-spark" style="--x:${x.toFixed(0)};--y:${y.toFixed(0)};--s:${size.toFixed(1)};--t:${seconds.toFixed(1)}s;--d:${(-random() * seconds).toFixed(1)}s"></i>`;
  }
  return out;
}

const SKYLINE = "#143a29";
const WALL = "#0a1b14";
const ROOF = "#0e271c";

/** Window panes with a cross of glazing bars in the colour of the wall. */
const windows = (list: Rect[], fill: string) =>
  list
    .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/><path d="M${x + w / 2} ${y}v${h}M${x} ${y + h / 2}h${w}" stroke="${WALL}" stroke-width="3"/>`)
    .join("");

const WINDOWS: Record<"dark" | "lit" | "tv" | "peek", Rect[]> = {
  dark: [
    [160, 600, 34, 40], [284, 545, 30, 36], [284, 612, 30, 36], [684, 590, 32, 38], [888, 492, 26, 30], [976, 492, 26, 30], [932, 540, 26, 30],
    [888, 588, 26, 30], [976, 588, 26, 30], [932, 636, 26, 30], [1270, 592, 34, 40], [1408, 556, 32, 36], [1408, 620, 32, 36],
  ],
  lit: [[56, 600, 34, 40], [774, 590, 32, 38], [932, 492, 26, 30], [976, 540, 26, 30], [888, 636, 26, 30], [1520, 556, 32, 36]],
  tv: [[350, 545, 30, 36], [932, 588, 26, 30]],
  peek: [[1176, 592, 34, 40], [888, 540, 26, 30]],
};

const RIM = `fill="none" stroke="rgba(170,240,160,.32)" stroke-width="2.5" stroke-linecap="round"`;

const MOON = `
  <svg class="bd-layer" viewBox="0 0 1600 900">
    <defs>
      <radialGradient id="bd-halo"><stop offset=".36" stop-color="#7dff6a" stop-opacity=".3"/><stop offset="1" stop-color="#7dff6a" stop-opacity="0"/></radialGradient>
      <radialGradient id="bd-moon" cx=".4" cy=".36" r=".75">
        <stop offset="0" stop-color="#f6fff0"/><stop offset=".7" stop-color="#cdf6be"/><stop offset="1" stop-color="#9edb8f"/>
      </radialGradient>
      <linearGradient id="bd-cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd98a" stop-opacity=".36"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></linearGradient>
      <radialGradient id="bd-glow"><stop offset="0" stop-color="#ffe6a8" stop-opacity=".8"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>
    </defs>
    <circle cx="1300" cy="350" r="340" fill="url(#bd-halo)"/>
    <circle cx="1300" cy="350" r="130" fill="url(#bd-moon)"/>
    <g fill="#7fc474" opacity=".34">
      <circle cx="1252" cy="298" r="23"/><circle cx="1344" cy="326" r="14"/><circle cx="1288" cy="398" r="18"/><circle cx="1368" cy="404" r="9"/><circle cx="1226" cy="366" r="8"/>
    </g>
  </svg>`;

const CLOUD = `
  <svg viewBox="0 0 420 120">
    <g fill="#1b4634"><ellipse cx="130" cy="70" rx="90" ry="30"/><ellipse cx="215" cy="52" rx="78" ry="40"/><ellipse cx="300" cy="72" rx="88" ry="28"/></g>
    <g fill="#102c20"><ellipse cx="126" cy="80" rx="96" ry="28"/><ellipse cx="216" cy="67" rx="82" ry="38"/><ellipse cx="302" cy="82" rx="94" ry="26"/></g>
  </svg>`;

const TOWN = `
  <svg class="bd-layer" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="bd-street" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#18281f"/><stop offset="1" stop-color="#0a120e"/></linearGradient>
    </defs>
    <path fill="#0f2a1f" d="M0 610C140 575 240 600 360 580S560 548 700 575 900 600 1040 572 1260 545 1380 568 1540 590 1600 578V700H0Z"/>
    <g fill="${SKYLINE}">
      <rect x="0" y="505" width="92" height="200"/><rect x="92" y="468" width="60" height="240"/>
      <path d="M380 396 425 366 470 396Z"/><rect x="386" y="394" width="78" height="50" rx="8"/>
      <rect x="520" y="452" width="84" height="250"/><rect x="604" y="484" width="58" height="220"/><rect x="822" y="436" width="60" height="270"/>
      <rect x="1022" y="508" width="52" height="200"/><rect x="1096" y="520" width="64" height="180"/><rect x="1114" y="442" width="28" height="80"/>
      <path d="M1108 444 1128 374 1148 444Z"/><rect x="1338" y="478" width="60" height="230"/><rect x="1556" y="466" width="44" height="240"/>
    </g>
    <path d="M396 444 384 660M454 444 466 660M391 530 461 580M459 530 389 580" fill="none" stroke="${SKYLINE}" stroke-width="5"/>
    <g fill="#ffd27a" opacity=".55">
      <rect x="20" y="530" width="5" height="7"/><rect x="60" y="560" width="5" height="7"/><rect x="112" y="492" width="5" height="7"/><rect x="128" y="530" width="5" height="7"/>
      <rect x="540" y="478" width="5" height="7"/><rect x="576" y="512" width="5" height="7"/><rect x="842" y="462" width="5" height="7"/><rect x="1126" y="470" width="5" height="9"/>
      <rect x="1356" y="502" width="5" height="7"/><rect x="1376" y="540" width="5" height="7"/><rect x="1574" y="492" width="5" height="7"/>
    </g>

    <g fill="#081711">
      <circle cx="243" cy="672" r="24"/><circle cx="1085" cy="585" r="36"/><circle cx="1060" cy="612" r="27"/><circle cx="1112" cy="614" r="27"/><rect x="1080" y="620" width="10" height="80"/>
      <circle cx="636" cy="664" r="28"/><circle cx="848" cy="670" r="24"/><circle cx="1352" cy="676" r="20"/>
    </g>

    <g fill="${WALL}">
      <rect x="170" y="506" width="20" height="56"/><rect x="30" y="572" width="190" height="120"/>
      <rect x="262" y="520" width="140" height="172"/>
      <rect x="440" y="600" width="180" height="92"/><rect x="434" y="592" width="192" height="10"/><rect x="470" y="564" width="120" height="30"/>
      <rect x="660" y="560" width="170" height="132"/>
      <rect x="870" y="470" width="150" height="222"/><rect x="864" y="462" width="162" height="10"/><rect x="900" y="436" width="34" height="28" rx="4"/><rect x="982" y="410" width="3" height="54"/>
      <rect x="1290" y="496" width="20" height="50"/><rect x="1150" y="560" width="180" height="132"/>
      <rect x="1380" y="530" width="200" height="162"/>
    </g>
    <g fill="${ROOF}">
      <path d="M14 574 125 496 236 574Z"/><path d="M250 522 332 462 414 522Z"/><path d="M646 562 745 486 844 562Z"/><path d="M1136 562 1240 474 1344 562Z"/><path d="M1366 532 1480 452 1594 532Z"/>
    </g>
    <path d="M125 496 236 574M332 462 414 522M745 486 844 562M1240 474 1344 562M1480 452 1594 532M1026 462H864M626 592H434" ${RIM}/>
    <circle cx="125" cy="545" r="10" fill="#14271f"/>
    ${windows([...WINDOWS.dark, ...WINDOWS.tv, ...WINDOWS.peek], "#14271f")}
    ${windows(WINDOWS.lit, "#ffd27a")}
    <rect x="456" y="622" width="92" height="50" fill="#35513f"/>
    <g fill="#06110c">
      <rect x="108" y="632" width="30" height="60"/><rect x="348" y="628" width="32" height="64"/><rect x="566" y="626" width="34" height="66"/><rect x="730" y="634" width="30" height="58"/>
      <rect x="930" y="672" width="30" height="20"/><rect x="1226" y="632" width="30" height="60"/><rect x="1486" y="624" width="74" height="68"/>
    </g>
    <path d="M1486 640h74M1486 656h74M1486 672h74" stroke="${WALL}" stroke-width="2"/>

    <rect x="0" y="690" width="1600" height="210" fill="url(#bd-street)"/>
    <rect x="0" y="690" width="1600" height="16" fill="#22352b"/>
    <rect x="0" y="706" width="1600" height="3" fill="#0a120e"/>
    <path d="M90 714l-14 42M190 714l-14 42M510 714l-14 42M610 714l-14 42M710 714l-14 42M810 714l-14 42M910 714l-14 42M1010 714l-14 42M1110 714l-14 42M1210 714l-14 42M1310 714l-14 42"
      stroke="rgba(255,255,255,.09)" stroke-width="3"/>
    <path d="M40 812h70M190 812h70M340 812h70M490 812h70M640 812h70M790 812h70M940 812h70M1090 812h70M1240 812h70M1390 812h70M1540 812h60" stroke="rgba(255,255,255,.07)" stroke-width="6"/>

    <rect x="418" y="600" width="5" height="106" fill="#06110c"/>
    <rect x="400" y="562" width="40" height="40" rx="5" fill="#2d67ad" stroke="#b9d6ff" stroke-width="2"/>
    <text x="420" y="593" text-anchor="middle" font-family="'Arial Black', Arial, sans-serif" font-weight="900" font-size="30" fill="#eaf3ff">P</text>

    <g fill="#06110c">
      <rect x="227" y="500" width="6" height="206"/><rect x="262" y="482" width="28" height="9" rx="4"/>
      <rect x="1353" y="500" width="6" height="206"/><rect x="1296" y="482" width="28" height="9" rx="4"/>
    </g>
    <path d="M230 502q0-16 18-16h18M1356 502q0-16-18-16h-18" fill="none" stroke="#06110c" stroke-width="5"/>
  </svg>`;

const lamp = (x: number, flicker: boolean) => `
  <svg class="bd-layer${flicker ? " bd-flicker" : ""}" viewBox="0 0 1600 900">
    <path d="M${x - 11} 490h22l94 240h-210z" fill="url(#bd-cone)"/>
    <circle cx="${x}" cy="492" r="30" fill="url(#bd-glow)"/>
    <ellipse cx="${x}" cy="728" rx="112" ry="14" fill="rgba(255,214,120,.1)"/>
    <rect x="${x - 10}" y="489" width="20" height="4" rx="2" fill="#fff3cf"/>
  </svg>`;

const LIGHTS = `
  ${lamp(276, true)}
  ${lamp(1310, false)}
  <svg class="bd-layer bd-tv" viewBox="0 0 1600 900">${windows(WINDOWS.tv, "#7cc6dc")}</svg>
  <svg class="bd-layer bd-peek" viewBox="0 0 1600 900">${windows(WINDOWS.peek, "#ffd27a")}</svg>`;

const CAT = `
  <svg class="bd-cat" viewBox="0 0 56 44">
    <g fill="#06110c">
      <ellipse cx="30" cy="31" rx="13" ry="13"/><circle cx="19" cy="15" r="9"/><path d="M11 11 12 0 19 8ZM20 8 26 0 27 11Z"/>
      <path class="bd-tail" d="M41 40C52 40 55 30 50 19" fill="none" stroke="#06110c" stroke-width="4.5" stroke-linecap="round"/>
    </g>
    <circle cx="15.5" cy="14" r="1.7" fill="#7dff6a"/><circle cx="22" cy="14" r="1.7" fill="#7dff6a"/>
  </svg>`;

const PROPS = `
  <svg class="bd-layer" viewBox="0 0 1600 900">
    <g stroke="#0a120e" stroke-width="2.5" stroke-linejoin="round">
      <path d="M62 752C58 728 70 716 100 712 118 690 150 676 190 676 232 676 256 690 272 710 292 714 302 726 300 752Z" fill="#26353f"/>
      <path d="M1500 752l6-14 10-4 6-24h36l6 24 10 4 6 14z" fill="#5c6660"/>
      <path d="M336 756l6-14 10-4 6-24h36l6 24 10 4 6 14z" fill="#5c6660"/>
      <rect x="1404" y="704" width="32" height="48" rx="5" fill="#27598f"/><rect x="1442" y="708" width="32" height="48" rx="5" fill="#27598f"/>
    </g>
    <path d="M104 714C122 700 150 690 188 690M196 678 206 750M150 680 138 750M246 696 262 750" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="2"/>
    <path d="M100 752a14 14 0 0 1 28 0zM248 752a14 14 0 0 1 28 0z" fill="#070d0a"/>
    <path d="M1404 718h32M1404 738h32M1442 722h32M1442 742h32" stroke="#1b4571" stroke-width="4"/>
    <path d="M1526 716l-6 20M1544 716l-6 20M1362 720l-6 20M1380 720l-6 20" stroke="#2d3531" stroke-width="7"/>
  </svg>`;

const FOREGROUND = `
  <svg class="bd-layer" viewBox="0 0 1600 900">
    <g fill="#040807">
      <path d="M-10 900V822l22-22 22 22v78zM38 900V806l22-22 22 22v94zM86 900V828l22-22 22 22v72z" transform="rotate(-4 60 900)"/>
      <path d="M140 900V812l22-22 22 22v88zM190 900V838l22-22 22 22v62z" transform="rotate(5 190 900)"/>
      <rect x="-10" y="846" width="260" height="14" transform="rotate(-2 120 850)"/>
      <path d="M0 900l8-40 8 30 10-52 8 46 12-34 6 40 12-28 6 38zM232 900l8-34 8 24 12-46 6 40 12-30 8 46zM1320 900l8-30 8 22 10-44 8 38 12-28 6 34 10-50 8 44 12-30 6 44zM1470 900l8-38 8 28 10-56 8 48 12-34 6 40 12-62 8 54 12-30 6 50 10-36 8 36z"/>
      <rect x="1500" y="800" width="8" height="100"/><rect x="1468" y="776" width="72" height="34" rx="12"/><rect x="1536" y="768" width="4" height="26"/><rect x="1536" y="768" width="18" height="10"/>
    </g>
  </svg>`;

const FADE_MS = 500;

export class Backdrop {
  readonly el = document.createElement("div");
  private fade?: ReturnType<typeof setTimeout>;

  constructor() {
    this.el.className = "backdrop";
    this.el.setAttribute("aria-hidden", "true");
    const far = WALKERS.filter((w) => w.far);
    const near = WALKERS.filter((w) => !w.far);
    this.el.innerHTML = `
      <div class="bd-stage">
        <div class="bd-sky"></div>
        ${stars(26, 3.1, 0)}${stars(26, 4.3, -1.5)}${stars(22, 5.7, -3)}
        ${MOON}
        <div class="bd-cloud" style="--y:560;--w:300;--t:260s;--d:-75s">${CLOUD}</div>
        <div class="bd-cloud" style="--y:700;--w:220;--t:190s;--d:-150s">${CLOUD}</div>
        <div class="bd-cloud" style="--y:455;--w:380;--t:330s;--d:-262s">${CLOUD}</div>
        ${TOWN}
        ${CAT}
        ${LIGHTS}
        ${far.map(walker).join("")}
        ${PROPS}
        <i class="bd-fog" style="--y:120;--t:95s;--d:-30s"></i>
        ${near.map(walker).join("")}
        ${DOG}
        ${FOREGROUND}
        <i class="bd-fog" style="--y:-40;--t:70s;--d:-55s"></i>
        <i class="bd-fog" style="--y:40;--t:130s;--d:-100s"></i>
        ${sparks(18)}
      </div>
      <div class="bd-vignette"></div>`;
  }

  show() {
    clearTimeout(this.fade);
    this.el.hidden = false;
    // Without reading the layout here the fade would start from the end state.
    void this.el.offsetWidth;
    this.el.classList.remove("leaving");
  }

  /** Fades out, then takes the scene out of the page so that nothing of it keeps animating during a round. */
  hide() {
    this.el.classList.add("leaving");
    clearTimeout(this.fade);
    this.fade = setTimeout(() => (this.el.hidden = true), FADE_MS);
  }
}
