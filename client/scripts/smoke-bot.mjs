// Checks session options, then plays a solo round over the network with perfect aim.
// Usage: pnpm smoke [url] [roundSeconds] [--difficulty=normal] [--die] [--human | --still]
// --die holds fire until the bot is knocked out once, to exercise death, penalty and respawn.
// --human aims like a decent player (slower, misses, fewer headshots, shorter range) and backs away from zombies.
// --still aims like --human but stands still.
import { Callbacks, Client } from "@colyseus/sdk";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const url = args[0] ?? "http://localhost:8080";
const duration = Number(args[1] ?? 60);
const difficulty = process.argv.find((a) => a.startsWith("--difficulty="))?.split("=")[1] ?? "normal";
const testDeath = process.argv.includes("--die");
const still = process.argv.includes("--still");
const human = still || process.argv.includes("--human");
const aim = human
  ? { interval: 300, range: 25, hitChance: 0.65, headChance: 0.2 }
  : { interval: 100, range: 55, hitChance: 1, headChance: 0.4 };
const ARENA_LIMIT = 27;
const FLEE_SPEED = 4.5;
let lastShot = 0;
const failures = [];

const client = new Client(url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function checkSessions() {
  const host = await client.create("game", { name: "Host", difficulty: "bogus", minutes: 4 });
  const guest = await client.joinById(host.roomId, { name: "Guest", difficulty: "easy", minutes: 1 });
  await sleep(400);
  if (host.state.difficulty !== "normal" || host.state.duration !== 300) {
    failures.push(`invalid options not clamped (${host.state.difficulty}, ${host.state.duration}s)`);
  }
  if (guest.state.hostId !== host.sessionId) failures.push("creator is not host");
  await host.leave();
  await sleep(400);
  if (guest.state.hostId !== guest.sessionId) failures.push("host not transferred on leave");
  await guest.leave();

  const custom = await client.create("game", { name: "Host", difficulty: "nightmare", minutes: 10 });
  await sleep(400);
  const { state } = custom;
  if (state.difficulty !== "nightmare" || state.duration !== 600) failures.push("custom settings not applied");
  console.log(`sessions: clamped=normal/300s, nightmare/10min star=${state.scoreStar}, host transfer ok=${!failures.length}`);
  await custom.leave();
}

await checkSessions();
const room = await client.create("game", { name: "Bot", solo: true, duration, difficulty });
Callbacks.get(room);
await sleep(300);
console.log(`joined ${room.roomId}, ${room.state.difficulty} round ${duration}s, star at ${room.state.scoreStar}${testDeath ? ", testing knockout" : ""}`);
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
const types = new Set();

room.onMessage("zombieHit", () => hits++);
room.onMessage("kill", () => kills++);
room.onMessage("playerHurt", (e) => {
  if (e.player === room.sessionId) hurt++;
});
room.onMessage("ammo", () => {});
room.onMessage("shot", () => {});

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

await room.leave();
if (failures.length) {
  console.error("FAILED:", failures.join("; "));
  process.exit(1);
}
console.log("OK");
process.exit(0);
