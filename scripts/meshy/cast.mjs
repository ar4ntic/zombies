const STYLE =
  "Stylized 3D game character in the style of Fortnite and Pixar, full body, funny goofy cartoon zombie, " +
  "pale mint-green skin, big silly expressive eyes, comedic expression, clean appealing proportions, " +
  "no blood, no gore, no wounds, no exposed bones, kid friendly, high quality game asset, standing";

const TEXTURE_STYLE =
  "vibrant stylized hand-painted look, soft pale mint-green skin, clean cartoon clothing colors, " +
  "no blood, no gore, no dirt stains";

/**
 * Animation library ids applied to every zombie, in order. Clip names in the output
 * GLB follow this order, so the client maps them by index (see ANIMATION_KEYS).
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
