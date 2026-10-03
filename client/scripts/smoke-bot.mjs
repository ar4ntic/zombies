// Checks session options and a two-client team session, then plays a solo round over the network with perfect aim.
// Usage: pnpm smoke [url] [roundSeconds | --minutes=N] [--difficulty=normal] [--die] [--human | --still]
// --minutes plays a standard-length round, which also shows up on the leaderboard (checked at the end).
// --die holds fire until the bot is knocked out once, to exercise death, penalty and respawn.
// --human aims like a decent player (slower, misses, fewer headshots, shorter range) and backs away from zombies.
// --still aims like --human but stands still.
import { Callbacks, Decoder } from "@colyseus/schema";
import { GameState, StateFrame } from "../../shared/src/index.ts";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const option = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const url = (args[0] ?? "http://localhost:8787").replace(/\/$/, "");
const minutes = option("minutes") ? Number(option("minutes")) : undefined;
const duration = minutes ? minutes * 60 : Number(args[1] ?? 60);
const difficulty = option("difficulty") ?? "normal";
const testDeath = process.argv.includes("--die");
const still = process.argv.includes("--still");
const human = still || process.argv.includes("--human");
const aim = human
  ? { interval: 300, range: 25, hitChance: 0.65, headChance: 0.2 }
  : { interval: 100, range: 55, hitChance: 1, headChance: 0.4 };
const ARENA_LIMIT = 27;
const FLEE_SPEED = 4.5;
const STANDARD_MINUTES = [1, 3, 5, 7, 10];
let lastShot = 0;
const failures = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, init) {
  const res = await fetch(`${url}${path}`, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Minimal client for the Worker protocol: JSON text events, binary schema state frames. */
class Session {
  static async create(options) {
    const { status, body } = await api("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options),
    });
    if (status !== 201) throw new Error(`create session failed: HTTP ${status}`);
    return Session.join(body.code, options.name, options.playerId);
  }

  static async join(code, name, playerId = crypto.randomUUID()) {
    const session = new Session(code);
    await session.connect(new URLSearchParams({ name, playerId }));
    return session;
  }

  constructor(code) {
    this.code = code;
    this.decoder = new Decoder(new GameState());
    this.callbacks = Callbacks.get(this.decoder);
    this.handlers = new Map();
    this.sessionId = "";
    this.token = "";
  }

  get state() {
    return this.decoder.state;
  }

  connect(params) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${url.replace(/^http/, "ws")}/ws/${this.code}?${params}`);
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      let synced = false;
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          const { type, data } = JSON.parse(event.data);
          if (type === "welcome") Object.assign(this, { sessionId: data.sessionId, token: data.token });
          this.handlers.get(type)?.(data);
          return;
        }
        const bytes = new Uint8Array(event.data);
        if (bytes[0] === StateFrame.Full) {
          if (this.decoder.root.refs.size > 1) this.decoder.decodeResync(bytes, { offset: 1 });
          else this.decoder.decode(bytes, { offset: 1 });
          if (!synced) resolve();
          synced = true;
        } else if (synced) {
          this.decoder.decode(bytes, { offset: 1 });
        }
      });
      const refused = () => {
        if (!synced) reject(new Error(`connection to ${this.code} refused`));
      };
      socket.addEventListener("error", refused);
      socket.addEventListener("close", refused);
    });
  }

  onMessage(type, handler) {
    this.handlers.set(type, handler);
  }

  send(type, data) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type, data }));
  }

  leave() {
    this.socket.close(1000);
  }

  /** Simulates a dropped connection; the server keeps the player for the grace period. */
  drop() {
    this.socket.close(4000);
  }

  reconnect() {
    return this.connect(new URLSearchParams({ token: this.token }));
  }
}

async function checkSessions() {
  const host = await Session.create({ name: "Host", difficulty: "bogus", minutes: 4, duration: 30 });
  const guest = await Session.join(host.code, "Guest");
  await sleep(400);
  if (host.state.difficulty !== "normal" || host.state.duration !== 300) {
    failures.push(`invalid options not clamped (${host.state.difficulty}, ${host.state.duration}s)`);
  }
  if (guest.state.hostId !== host.sessionId) failures.push("creator is not host");
  host.leave();
  await sleep(400);
  if (guest.state.hostId !== guest.sessionId) failures.push("host not transferred on leave");
  guest.leave();
  await sleep(300);
  if ((await api(`/api/sessions/${host.code}`)).status !== 404) failures.push("empty session still exists");

  const custom = await Session.create({ name: "Host", difficulty: "nightmare", minutes: 10 });
  await sleep(400);
  const { state } = custom;
  if (state.difficulty !== "nightmare" || state.duration !== 600) failures.push("custom settings not applied");
  console.log(`sessions: clamped=normal/300s, nightmare/10min star=${state.scoreStar}, host transfer ok=${!failures.length}`);
  custom.leave();
}

async function checkTeam() {
  const before = failures.length;
  const host = await Session.create({ name: "Alice", difficulty: "easy", minutes: 3 });
  const info = await api(`/api/sessions/${host.code.toLowerCase()}`);
  if (info.status !== 200 || info.body.full || info.body.players !== 1 || info.body.minutes !== 3) {
    failures.push(`session info wrong: ${JSON.stringify(info.body)}`);
  }
  const guest = await Session.join(host.code, "Bob");
  await sleep(400);
  const names = (s) => [...s.state.players.values()].map((p) => p.name).sort().join(",");
  if (names(host) !== "Alice,Bob" || names(guest) !== "Alice,Bob") failures.push(`players not shared: ${names(host)} / ${names(guest)}`);
  if (host.state.hostId !== host.sessionId || guest.state.hostId !== host.sessionId) failures.push("team host wrong");

  const guestId = guest.sessionId;
  guest.drop();
  await sleep(1500);
  if (!host.state.players.has(guestId)) failures.push("dropped player removed before the grace period");
  await guest.reconnect();
  await sleep(400);
  if (guest.sessionId !== guestId || !guest.state.players.has(guestId) || guest.state.players.size !== 2) {
    failures.push("reconnect with token did not restore the player");
  }

  const solo = await Session.create({ name: "Solo", solo: true, difficulty: "easy", minutes: 1 });
  const soloInfo = await api(`/api/sessions/${solo.code}`);
  const intruder = await Session.join(solo.code, "Intruder").then(
    () => "joined",
    () => "refused",
  );
  if (!soloInfo.body?.full || intruder !== "refused") failures.push(`solo session accepted a second player (${intruder})`);
  solo.leave();
  if ((await api("/api/sessions/ZZZZZZ")).status !== 404) failures.push("unknown session code not 404");

  host.leave();
  await sleep(400);
  if (guest.state.hostId !== guestId) failures.push("team host not transferred to guest");
  const players = guest.state.players.size;
  guest.leave();
  console.log(
    `team: code=${host.code} both see Alice,Bob, reconnect kept ${guestId}, host transfer -> guest, players after leave=${players}, ok=${failures.length === before}`,
  );
}

await checkSessions();
await checkTeam();

const playerId = crypto.randomUUID();
const room = await Session.create({ name: "Bot", playerId, solo: true, difficulty, ...(minutes ? { minutes } : { duration }) });
await sleep(300);
console.log(`joined ${room.code}, ${room.state.difficulty} round ${room.state.duration}s, star at ${room.state.scoreStar}${testDeath ? ", testing knockout" : ""}`);
if (room.state.difficulty !== difficulty) failures.push(`difficulty ${room.state.difficulty}, expected ${difficulty}`);
let pauseCheck = "pending";
let pausedTimer = 0;
let pausedAt = 0;

let kills = 0;
let hits = 0;
let hurt = 0;
let lastWave = -1;
let lastPhase = "";
let wasDead = false;
let respawned = false;
let scoreBeforeDeath = 0;
let penaltyOk = !testDeath;
let deathPhase = testDeath;
let observedDeaths = 0;
let maxAlive = 0;
let personalBest;
const types = new Set();

room.onMessage("zombieHit", () => hits++);
room.onMessage("kill", () => kills++);
room.onMessage("playerHurt", (e) => {
  if (e.player === room.sessionId) hurt++;
});
room.onMessage("personalBest", (e) => (personalBest = e));

const started = Date.now();
const elapsed = () => ((Date.now() - started) / 1000).toFixed(1);

await new Promise((resolve) => {
  const loop = setInterval(() => {
    const s = room.state;
    const me = s.players.get(room.sessionId);
    if (!me) return;
    maxAlive = Math.max(maxAlive, s.zombies.size);
    if (s.phase !== lastPhase || s.wave !== lastWave) {
      lastPhase = s.phase;
      lastWave = s.wave;
      console.log(`[${elapsed()}s] phase=${s.phase} wave=${s.wave} timer=${s.timer.toFixed(0)} alive=${s.zombies.size} score=${s.teamScore}`);
    }

    if (!wasDead && me.dead) {
      console.log(`[${elapsed()}s] knocked out: score ${scoreBeforeDeath} -> ${me.score}, deaths=${me.deaths}, respawn in ${me.respawnIn.toFixed(1)}s`);
      observedDeaths++;
      if (deathPhase) penaltyOk = me.score === Math.max(0, scoreBeforeDeath - 500);
      deathPhase = false;
    }
    if (wasDead && !me.dead) {
      respawned = true;
      console.log(`[${elapsed()}s] respawned at (${me.x.toFixed(1)}, ${me.z.toFixed(1)}) hp=${me.hp} protection=${me.protection.toFixed(1)}`);
    }
    wasDead = me.dead;
    if (!me.dead) scoreBeforeDeath = me.score;

    if (pauseCheck === "pending" && s.phase === "playing" && s.timer < duration - 3) {
      room.send("pause", { paused: true });
      pauseCheck = "paused";
      pausedAt = Date.now();
      pausedTimer = s.timer;
    }
    if (pauseCheck === "paused") {
      if (Date.now() - pausedAt < 1500) return;
      pauseCheck = s.paused && Math.abs(s.timer - pausedTimer) < 0.15 ? "ok" : "failed";
      console.log(`[${elapsed()}s] pause check: ${pauseCheck} (timer ${pausedTimer.toFixed(2)} -> ${s.timer.toFixed(2)})`);
      room.send("pause", { paused: false });
    }

    let { x, z } = me;
    if (human && !still && !me.dead) {
      let fx = -x / ARENA_LIMIT;
      let fz = -z / ARENA_LIMIT;
      for (const zombie of s.zombies.values()) {
        const d = Math.hypot(zombie.x - x, zombie.z - z);
        if (d > 0 && d < 8) {
          fx += ((x - zombie.x) / d) * (8 - d);
          fz += ((z - zombie.z) / d) * (8 - d);
        }
      }
      const len = Math.hypot(fx, fz);
      if (len > 0.5) {
        x = Math.max(-ARENA_LIMIT, Math.min(ARENA_LIMIT, x + (fx / len) * FLEE_SPEED * 0.1));
        z = Math.max(-ARENA_LIMIT, Math.min(ARENA_LIMIT, z + (fz / len) * FLEE_SPEED * 0.1));
      }
    }
    if (!me.dead) room.send("move", { x, y: 0, z, yaw: 0, pitch: 0 });
    const holdFire = deathPhase && kills >= 5;
    let best;
    for (const [id, z] of s.zombies) {
      types.add(z.type);
      const d = Math.hypot(z.x - me.x, z.z - me.z);
      if (d < aim.range && (!best || d < best.d)) best = { id, z, d };
    }
    if (best && !me.dead && !holdFire && s.phase === "playing" && Date.now() - lastShot >= aim.interval) {
      lastShot = Date.now();
      room.send("shoot", {
        weapon: "rifle",
        origin: [me.x, 1.5, me.z],
        end: [best.z.x, 1.5, best.z.z],
        hit: Math.random() < aim.hitChance ? { zombie: best.id, head: Math.random() < aim.headChance } : undefined,
      });
    }

    if (s.phase === "ended" || Date.now() - started > (duration + 30) * 1000) {
      clearInterval(loop);
      const dancing = [...s.zombies.values()].filter((z) => z.anim === 3).length;
      console.log(
        `END ${s.difficulty} ${s.duration}s phase=${s.phase} stars=${s.stars} star=${s.scoreStar} teamScore=${s.teamScore} score=${me.score} kills=${me.kills} headshots=${me.headshots} deaths=${me.deaths} ` +
          `hits=${hits} hurt=${hurt} maxAlive=${maxAlive} waves=${s.wave} dancing=${dancing}/${s.zombies.size} types=${[...types].join(",")}`,
      );
      if (s.phase !== "ended") failures.push("round did not end");
      if (kills === 0) failures.push("no kills");
      if (dancing !== s.zombies.size) failures.push("not all zombies dance");
      if (testDeath && !respawned) failures.push("no knockout/respawn observed");
      if (!penaltyOk) failures.push("death penalty wrong");
      if (me.deaths !== observedDeaths) failures.push(`deaths counter ${me.deaths}, observed ${observedDeaths}`);
      if (s.teamScore !== me.score) failures.push("team score != player score");
      if (pauseCheck !== "ok") failures.push(`solo pause did not freeze the timer (${pauseCheck})`);
      resolve();
    }
  }, 100);
});

const finalScore = room.state.players.get(room.sessionId)?.score ?? 0;
for (let i = 0; i < 50 && !personalBest; i++) await sleep(100);
console.log(`personalBest: ${JSON.stringify(personalBest)}`);
if (!personalBest) failures.push("no personalBest event");
else if (personalBest.isBest !== finalScore > 0 || personalBest.previousBest !== null) failures.push("personalBest wrong for a new player");

const roundMinutes = room.state.duration / 60;
if (STANDARD_MINUTES.includes(roundMinutes)) {
  const board = await api(`/api/leaderboard?level=${room.state.levelId}&difficulty=${difficulty}&minutes=${roundMinutes}&limit=50&player=${playerId}`);
  const mine = board.body?.entries?.find((e) => e.me);
  console.log(`leaderboard ${difficulty}/${roundMinutes}min: ${board.body?.entries?.length ?? 0} entries, bot ${mine ? `#${mine.rank} ${mine.nickname} ${mine.score}` : "missing"}`);
  if (!mine || mine.score !== finalScore) failures.push("bot not on the leaderboard with its score");
} else {
  console.log(`leaderboard: skipped, ${room.state.duration}s is not a standard round length`);
}

room.leave();
if (failures.length) {
  console.error("FAILED:", failures.join("; "));
  process.exit(1);
}
console.log("OK");
process.exit(0);
