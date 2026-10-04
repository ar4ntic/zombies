export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

export const MAX_PLAYERS = 4;
/** How long a dropped player keeps their spot and can reconnect. */
export const RECONNECT_GRACE_SECONDS = 30;

export const SESSION_CODE_LENGTH = 6;
export const SESSION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const NICKNAME_MAX_LENGTH = 16;

export const PLAYER_RADIUS = 0.35;
export const PLAYER_MAX_HP = 100;
export const PLAYER_REGEN_DELAY = 5;
export const PLAYER_REGEN_PER_SECOND = 8;
export const PLAYER_GRAVITY = 24;
export const PLAYER_JUMP_SPEED = 8;
/** How far the player's center may hang over the edge of an object and still stand on it. */
export const STAND_OVERHANG = 0.2;
/** Feet this close below a surface count as standing on it. */
export const STAND_TOLERANCE = 0.1;
export const SPAWN_PROTECTION_SECONDS = 3;
export const DEATH_PENALTY = 500;

export const COUNTDOWN_SECONDS = 5;
/** Countdown after the host starts a team round from the lobby. */
export const LOBBY_COUNTDOWN_SECONDS = 3;
/** Announced pause between clearing a wave and the next one. */
export const WAVE_COUNTDOWN_SECONDS = 3;
export const MIN_SPAWN_INTERVAL = 0.3;
export const COMBO_WINDOW = 3;
export const MAX_COMBO = 5;
/** Hard cap for every difficulty, for client performance. */
export const MAX_ZOMBIES_ALIVE = 40;
/** Extra zombies per wave for each player beyond the first. */
export const EXTRA_ZOMBIES_PER_PLAYER = 0.6;
/** Horizontal distance at which a pickup on the ground is collected. */
export const PICKUP_RADIUS = 1.1;
/** Rifle energy in one collected capsule. */
export const ENERGY_PICKUP_AMOUNT = 60;
export const HEALTH_PICKUP_AMOUNT = 40;
/** Each player beyond the first shortens the pickup interval by this share and allows one more pickup at a time. */
export const PICKUP_RATE_PER_PLAYER = 0.5;
