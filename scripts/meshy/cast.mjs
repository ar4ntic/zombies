const STYLE =
  "Stylized 3D game character in the style of Fortnite and Pixar, full body, funny goofy cartoon zombie, " +
  "pale mint-green skin, big silly expressive eyes, comedic expression, clean appealing proportions, " +
  "no blood, no gore, no wounds, no exposed bones, kid friendly, high quality game asset, standing";

const TEXTURE_STYLE =
  "vibrant stylized hand-painted look, soft pale mint-green skin, clean cartoon clothing colors, " +
  "no blood, no gore, no dirt stains";

/**
 * Animation library ids applied to every zombie. The clips keep their library names in the
 * output GLB; characters/manifest.json maps the keys to those names for the client.
 */
export const ANIMATIONS = [
  { key: "walk", actionId: 112 }, // Frankenstein Walk
  { key: "walk2", actionId: 562 }, // Stumble Walk
  { key: "run", actionId: 16 }, // Run Fast
  { key: "attack", actionId: 214 }, // Punch Forward with Both Fists
  { key: "hit", actionId: 178 }, // Hit Reaction
  { key: "hitHead", actionId: 174 }, // Face Punch Reaction
  { key: "death", actionId: 187 }, // Knock Down
  { key: "death2", actionId: 183 }, // Shot and Fall Backward
  { key: "scream", actionId: 386 }, // Zombie Scream
  { key: "dance", actionId: 596 }, // YMCA Dance
];

export const CAST = [
  {
    id: "zombie_grandma",
    prompt: `${STYLE}, a zombie grandma wearing a fluffy pink bathrobe, bunny slippers and hair curlers`,
    texture: `${TEXTURE_STYLE}, fluffy pink bathrobe, white bunny slippers, colorful hair curlers`,
  },
  {
    id: "zombie_mailman",
    prompt: `${STYLE}, a zombie mailman wearing a blue postal uniform, cap and a messenger bag across his chest`,
    texture: `${TEXTURE_STYLE}, blue postal uniform with yellow details, brown leather messenger bag`,
  },
  {
    id: "zombie_chef",
    prompt: `${STYLE}, a chubby zombie chef wearing a tall white chef hat, white chef jacket and red neckerchief`,
    texture: `${TEXTURE_STYLE}, white chef uniform, red neckerchief, black checkered pants`,
  },
  {
    id: "zombie_jogger",
    prompt: `${STYLE}, a skinny zombie jogger wearing a neon tracksuit, sweatband and running shoes`,
    texture: `${TEXTURE_STYLE}, neon green and purple tracksuit, white sweatband, bright running shoes`,
  },
  {
    id: "zombie_builder",
    prompt: `${STYLE}, a zombie construction worker wearing a hi-vis orange vest, jeans, work boots and a traffic cone on his head as a hat`,
    texture: `${TEXTURE_STYLE}, hi-vis orange vest with reflective stripes, orange and white traffic cone hat, blue jeans`,
  },
  {
    id: "zombie_mascot",
    prompt:
      `${STYLE}, a zombie wearing a full-body fuzzy yellow chicken mascot costume, round fluffy yellow body suit, ` +
      `big orange cartoon chicken feet, a chicken head hood with a red comb on top of his head, his green zombie face visible`,
    texture: `${TEXTURE_STYLE}, fuzzy bright yellow feathered costume, orange chicken feet, red comb, white belly patch`,
  },
  {
    id: "zombie_wrestler",
    prompt:
      `${STYLE}, a huge bulky heavyweight zombie wrestler with a giant round belly, very thick arms and broad shoulders, ` +
      `wearing a colorful luchador mask, red wrestling singlet and wrestling boots`,
    texture: `${TEXTURE_STYLE}, colorful blue and gold luchador mask, shiny red wrestling singlet, white wrestling boots`,
  },
  {
    id: "zombie_gym",
    prompt: `${STYLE}, a huge muscular zombie gym bro wearing a tank top, sweatpants and a headband, very broad shoulders`,
    texture: `${TEXTURE_STYLE}, red tank top, grey sweatpants, white headband`,
  },
  {
    id: "zombie_teen",
    prompt: `${STYLE}, a zombie teenager wearing an oversized hoodie, big headphones around the neck, baggy jeans and sneakers`,
    texture: `${TEXTURE_STYLE}, purple oversized hoodie, black headphones, blue baggy jeans, white sneakers`,
  },
];

const PLAYER_STYLE =
  "Stylized 3D game character in the style of Fortnite and Pixar, full body, friendly brave cartoon hero, " +
  "healthy natural skin, big expressive eyes, confident smile, clean appealing proportions, empty hands, " +
  "no weapons, no blood, kid friendly, high quality game asset, standing";

const PLAYER_TEXTURE_STYLE = "vibrant stylized hand-painted look, natural skin tones, clean cartoon clothing colors, no blood, no dirt stains";

/** Animation library ids applied to every player skin. */
export const PLAYER_ANIMATIONS = [
  { key: "idle", actionId: 0 }, // Idle
  { key: "aim", actionId: 89 }, // Combat Stance
  { key: "walk", actionId: 234 }, // Walk Forward While Shooting
  { key: "run", actionId: 98 }, // Run and Shoot
  { key: "knockedOut", actionId: 187 }, // Knock Down
  { key: "cheer", actionId: 59 }, // Victory Cheer
];

/** Player skins. The ids, labels and arm colors the game uses are in shared/src/skins.ts. */
export const PLAYERS = [
  {
    id: "player_ranger",
    prompt: `${PLAYER_STYLE}, a young man park ranger wearing a green ranger jacket, khaki shorts, hiking boots and a wide-brim ranger hat`,
    texture: `${PLAYER_TEXTURE_STYLE}, forest green ranger jacket, khaki shorts, brown hiking boots, tan ranger hat`,
  },
  {
    id: "player_mechanic",
    prompt: `${PLAYER_STYLE}, a stocky man mechanic with dark brown skin and a short beard wearing blue overalls, a grey cap and black work gloves`,
    texture: `${PLAYER_TEXTURE_STYLE}, blue overalls, white t-shirt, grey cap, black work gloves`,
  },
  {
    id: "player_astronaut",
    prompt: `${PLAYER_STYLE}, a man astronaut with East Asian features and short black hair wearing a white space suit with orange stripes and orange gloves, no helmet`,
    texture: `${PLAYER_TEXTURE_STYLE}, white space suit with orange stripes, orange gloves, grey boots`,
  },
  {
    id: "player_skater",
    prompt: `${PLAYER_STYLE}, a teenage boy skater with freckles wearing a pink hoodie, a backwards cap, baggy shorts and sneakers`,
    texture: `${PLAYER_TEXTURE_STYLE}, pink hoodie, blue backwards cap, grey baggy shorts, white sneakers`,
  },
  {
    id: "player_firefighter",
    prompt: `${PLAYER_STYLE}, a tall man firefighter with a moustache wearing a yellow firefighter coat with reflective stripes, a firefighter helmet and black gloves`,
    texture: `${PLAYER_TEXTURE_STYLE}, yellow firefighter coat with silver reflective stripes, yellow helmet, black gloves and boots`,
  },
  {
    id: "player_pilot",
    prompt: `${PLAYER_STYLE}, a woman pilot with dark brown skin and curly hair wearing a brown leather bomber jacket, aviator goggles on her forehead and a white scarf`,
    texture: `${PLAYER_TEXTURE_STYLE}, brown leather bomber jacket, white scarf, olive trousers, brown gloves`,
  },
  {
    id: "player_explorer",
    prompt: `${PLAYER_STYLE}, a young woman explorer with a ponytail wearing a khaki safari shirt, shorts, a small backpack and hiking boots`,
    texture: `${PLAYER_TEXTURE_STYLE}, khaki safari shirt, olive shorts, brown backpack, brown hiking boots`,
  },
  {
    id: "player_medic",
    prompt: `${PLAYER_STYLE}, a woman paramedic with black hair in a bun wearing a teal paramedic uniform with white stripes and white gloves`,
    texture: `${PLAYER_TEXTURE_STYLE}, teal paramedic uniform with white reflective stripes, white gloves, white sneakers`,
  },
  {
    id: "player_engineer",
    prompt: `${PLAYER_STYLE}, a woman engineer with curly red hair wearing an orange hi-vis vest over a grey shirt, a white hard hat, jeans and grey gloves`,
    texture: `${PLAYER_TEXTURE_STYLE}, orange hi-vis vest with reflective stripes, white hard hat, blue jeans, grey gloves`,
  },
  {
    id: "player_scientist",
    prompt: `${PLAYER_STYLE}, an older woman scientist with grey hair and round glasses wearing a white lab coat, purple gloves and safety goggles around her neck`,
    texture: `${PLAYER_TEXTURE_STYLE}, white lab coat, purple gloves, teal sweater, dark trousers`,
  },
];
