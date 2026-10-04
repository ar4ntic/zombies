import { schema, t, type SchemaType } from "@colyseus/schema";

export const PlayerState = schema(
  {
    name: t.string().default(""),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    yaw: t.float32().default(0),
    pitch: t.float32().default(0),
    weapon: t.string().default("pistol"),
    hp: t.uint8().default(100),
    dead: t.boolean().default(false),
    /** Seconds until respawn while dead. */
    respawnIn: t.float32().default(0),
    /** Seconds of spawn protection left. */
    protection: t.float32().default(0),
    score: t.uint32().default(0),
    kills: t.uint16().default(0),
    headshots: t.uint16().default(0),
    deaths: t.uint16().default(0),
    combo: t.uint8().default(1),
    /** Shots fired and shots that hit a zombie during the round. */
    shots: t.uint16().default(0),
    hits: t.uint16().default(0),
    skin: t.string().default(""),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const ZombieState = schema(
  {
    type: t.string().default("walker"),
    x: t.float32().default(0),
    z: t.float32().default(0),
    rot: t.float32().default(0),
    anim: t.uint8().default(0),
  },
  "ZombieState",
);
export type ZombieState = SchemaType<typeof ZombieState>;

export type PickupKind = "energy" | "health";

export const PickupState = schema(
  {
    kind: t.string().default("energy"),
    x: t.float32().default(0),
    z: t.float32().default(0),
  },
  "PickupState",
);
export type PickupState = SchemaType<typeof PickupState>;

export type GamePhase = "lobby" | "countdown" | "playing" | "ended";

export const GameState = schema(
  {
    levelId: t.string().default(""),
    hostId: t.string().default(""),
    solo: t.boolean().default(false),
    paused: t.boolean().default(false),
    phase: t.string().default("countdown"),
    wave: t.uint8().default(0),
    /** Seconds until the next wave starts; 0 while a wave is running. */
    waveIn: t.float32().default(0),
    /** Zombies of the current wave still to be knocked out, spawned or not. */
    zombiesLeft: t.uint16().default(0),
    /** Countdown seconds before the round, then seconds left in the round. */
    timer: t.float32().default(0),
    duration: t.uint16().default(0),
    difficulty: t.string().default("normal"),
    energy: t.string().default("limited"),
    /** Team score needed for the second star. */
    scoreStar: t.uint32().default(0),
    teamScore: t.uint32().default(0),
    stars: t.uint8().default(0),
    players: t.map(PlayerState),
    zombies: t.map(ZombieState),
    pickups: t.map(PickupState),
  },
  "GameState",
);
export type GameState = SchemaType<typeof GameState>;
