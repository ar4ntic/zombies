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
export const SPAWN_PROTECTION_SECONDS = 3;
export const DEATH_PENALTY = 500;

export const COUNTDOWN_SECONDS = 5;
/** Countdown after the host starts a team round from the lobby. */
export const LOBBY_COUNTDOWN_SECONDS = 3;
/** Pause between clearing a wave early and the next wave. */
export const WAVE_BREAK_SECONDS = 4;
/** The next wave starts ahead of schedule once no more than this many zombies are left. */
export const WAVE_LULL_ZOMBIES = 4;
/** Share of the wave length its spawns are spread over. */
export const WAVE_SPAWN_SHARE = 0.8;
export const MIN_SPAWN_INTERVAL = 0.3;
export const COMBO_WINDOW = 3;
export const MAX_COMBO = 5;
/** Hard cap for every difficulty, for client performance. */
export const MAX_ZOMBIES_ALIVE = 40;
/** Extra zombies per wave for each player beyond the first. */
export const EXTRA_ZOMBIES_PER_PLAYER = 0.6;
/** Rifle ammo granted to every player when a new wave starts. */
export const WAVE_AMMO_REFILL = 60;
