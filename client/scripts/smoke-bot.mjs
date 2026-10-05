// Checks session options, accounts, a two-client team session and the team lobby (including a 1-minute team round),
// then plays a solo round over the network with perfect aim.
// Usage: pnpm smoke [url] [roundSeconds | --minutes=N] [--difficulty=normal] [--die] [--human | --still]
// --minutes plays a standard-length round, which also shows up on the leaderboard (checked at the end).
// --energy=infinite|limited picks the energy mode of the solo round (default limited, which also checks capsule pickups).
// --mail-log=FILE reads the confirmation link from the output of a local `wrangler dev` (which logs account mails
//   instead of sending them), to also check that a confirmed account's nickname is refused to everybody else.
// --die holds fire until the bot is knocked out once, to exercise death, penalty and respawn.
// --human aims like a decent player (slower, misses, fewer headshots, shorter range) and backs away from zombies.
// --still aims like --human but stands still.
import { readFileSync } from "node:fs";
import { Callbacks, Decoder } from "@colyseus/schema";
import { GameState, StateFrame } from "../../shared/src/index.ts";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const option = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const url = (args[0] ?? "http://localhost:8787").replace(/\/$/, "");
const minutes = option("minutes") ? Number(option("minutes")) : undefined;
const duration = minutes ? minutes * 60 : Number(args[1] ?? 60);
const difficulty = option("difficulty") ?? "normal";
const energy = option("energy") ?? "limited";
const mailLog = option("mail-log");
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
    return Session.join(body.code, options.name, options.playerId, options.skin);
  }

  /** `cookie` joins as the account that session cookie belongs to. */
  static async join(code, name, playerId = crypto.randomUUID(), skin, cookie) {
    const session = new Session(code);
    await session.connect(new URLSearchParams({ name, playerId, ...(skin ? { skin } : {}) }), cookie);
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

  connect(params, cookie) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${url.replace(/^http/, "ws")}/ws/${this.code}?${params}`, cookie ? { headers: { cookie } } : undefined);
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
  const host = await Session.create({ name: "Host", difficulty: "bogus", minutes: 4, duration: 30, energy: "bogus", skin: "bogus" });
  const guest = await Session.join(host.code, "Guest", undefined, "player_medic");
  await sleep(400);
  if (host.state.difficulty !== "normal" || host.state.duration !== 300 || host.state.energy !== "limited") {
    failures.push(`invalid options not clamped (${host.state.difficulty}, ${host.state.duration}s, ${host.state.energy})`);
  }
  const skins = [host, guest].map((s) => host.state.players.get(s.sessionId)?.skin).join(",");
  if (skins !== "player_ranger,player_medic") failures.push(`skins wrong: ${skins}`);
  guest.send("skin", { skin: "bogus" });
  guest.send("skin", { skin: "player_pilot" });
  await sleep(300);
  if (host.state.players.get(guest.sessionId)?.skin !== "player_pilot") failures.push("skin change not applied");
  if (guest.state.hostId !== host.sessionId) failures.push("creator is not host");
  host.leave();
  await sleep(400);
  if (guest.state.hostId !== guest.sessionId) failures.push("host not transferred on leave");
  guest.leave();
  await sleep(300);
  if ((await api(`/api/sessions/${host.code}`)).status !== 404) failures.push("empty session still exists");

  const custom = await Session.create({ name: "Host", difficulty: "nightmare", minutes: 10, energy: "infinite", friendlyFire: true });
  await sleep(400);
  const { state } = custom;
  if (state.difficulty !== "nightmare" || state.duration !== 600 || state.energy !== "infinite" || !state.friendlyFire) failures.push("custom settings not applied");
  if (host.state.friendlyFire || host.state.private) failures.push("friendly fire or private on by default");
  const anonymousPrivate = await api("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Host", private: true }) });
  if (anonymousPrivate.status !== 403) failures.push(`private session created without an account (HTTP ${anonymousPrivate.status})`);
  console.log(`sessions: clamped=normal/300s, nightmare/10min star=${state.scoreStar}, host transfer ok=${!failures.length}`);
  custom.leave();
}

/** Account endpoints with a cookie jar of one. */
function accountClient() {
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(`${url}/api/auth/${path}`, {
      method,
      headers: { "content-type": "application/json", origin: url, ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { call, cookie: () => cookie };
}

/** The token of the last link the Worker logged as mailed to an address; the log is written with a delay. */
async function mailedToken(email, page) {
  for (const end = Date.now() + 3000; Date.now() < end; await sleep(100)) {
    const mails = readFileSync(mailLog, "utf8").split(`[mail] to ${email}:`);
    const token = mails.length > 1 ? mails.at(-1).match(new RegExp(`/${page}#([\\w-]{20,})\\s`))?.[1] : undefined;
    if (token) return token;
  }
  return undefined;
}

async function checkAccounts() {
  const before = failures.length;
  const stamp = Date.now().toString(36);
  const email = `smoke-${stamp}@example.test`;
  const password = `smoke-${stamp}-pass`;
  const nickname = `Smoke${stamp.slice(-6)}`;
  const account = accountClient();
  const expect = (what, ok) => ok || failures.push(`accounts: ${what}`);

  expect("short password accepted", (await account.call("POST", "register", { email, password: "short" })).status === 400);
  const registered = await account.call("POST", "register", { email, password });
  expect("register failed", registered.status === 201 && registered.body?.account?.email === email && !registered.body.account.verified);
  expect("duplicate email accepted", (await account.call("POST", "register", { email, password })).status === 409);
  expect("cross-site request accepted", (await fetch(`${url}/api/auth/logout`, { method: "POST", headers: { origin: "https://elsewhere.example" } })).status === 403);
  expect("invalid nickname accepted", (await account.call("PUT", "nickname", { nickname: "x" })).status === 400);
  const named = await account.call("PUT", "nickname", { nickname });
  expect("nickname not set", named.status === 200 && named.body?.account?.nickname === nickname);

  const host = await Session.create({ name: "AccountHost" });
  const check = async (cookie) => (await (await fetch(`${url}/api/nicknames/check?name=${nickname.toUpperCase()}`, { headers: cookie ? { cookie } : {} })).json());
  const open = await Session.join(host.code, nickname).then((s) => s.leave() ?? "joined", () => "refused");
  expect(`unconfirmed nickname already protected (${open})`, open === "joined" && !(await check()).protected);

  let verified = false;
  if (mailLog) {
    const token = await mailedToken(email, "verify");
    const confirmed = await account.call("POST", "verify", { token });
    verified = confirmed.status === 200 && confirmed.body?.account?.verified === true;
    expect("email confirmation failed", verified);
    expect("confirmation link worked twice", (await account.call("POST", "verify", { token })).status === 400);
    const stranger = await Session.join(host.code, nickname.toUpperCase()).then((s) => s.leave() ?? "joined", () => "refused");
    expect(`protected nickname given to a stranger (${stranger})`, stranger === "refused");
    const state = await check();
    const mine = await check(account.cookie());
    expect("nickname check wrong", state.protected && !state.mine && mine.protected && mine.mine);
  }
  // Only a confirmed account plays as a member, under its own nickname.
  const owner = await Session.join(host.code, "SomethingElse", undefined, undefined, account.cookie());
  await sleep(300);
  const seen = host.state.players.get(owner.sessionId);
  expect(`account player wrong: ${seen?.name}, member=${seen?.member}`, seen?.member === verified && seen?.name === (verified ? nickname : "SomethingElse"));
  owner.leave();
  host.leave();

  const privateSession = await fetch(`${url}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: account.cookie() },
    body: JSON.stringify({ name: nickname, private: true }),
  });
  expect(`private session for ${verified ? "a member refused" : "an unconfirmed account created"}`, privateSession.status === (verified ? 201 : 403));
  if (privateSession.status === 201) {
    const { code } = await privateSession.json();
    const member = await Session.join(code, nickname, undefined, undefined, account.cookie());
    const stranger = await Session.join(code, "Stranger").then((s) => s.leave() ?? "joined", () => "refused");
    const info = await api(`/api/sessions/${code}`);
    expect(`private session open to strangers (${stranger}, private=${info.body?.private})`, stranger === "refused" && info.body?.private === true && member.state.private);
    member.leave();
  }
  console.log(`accounts: register, nickname, ${verified ? "confirmed + protected, private session" : "confirmation skipped (no --mail-log)"}, ok=${failures.length === before}`);
  return { account, email, password, nickname, verified, check };
}

/** Logs the test account out and in again and deletes it. */
async function finishAccounts({ account, email, password, nickname, check }) {
  const before = failures.length;
  const expect = (what, ok) => ok || failures.push(`accounts: ${what}`);
  expect("logout failed", (await account.call("POST", "logout")).status === 200 && (await account.call("GET", "me")).body?.account === null);
  expect("wrong password accepted", (await account.call("POST", "login", { email, password: `${password}!` })).status === 401);
  expect("login failed", (await account.call("POST", "login", { email, password })).body?.account?.nickname === nickname);
  expect("account deleted without the password", (await account.call("DELETE", "me", { password: "wrong-password" })).status === 401);
  expect("account not deleted", (await account.call("DELETE", "me", { password })).status === 200 && !(await check()).protected);
  console.log(`accounts: logout, login, delete, ok=${failures.length === before}`);
}

/** Fills a team session to the limit and checks friendly fire in it. */
async function checkBigTeam() {
  const before = failures.length;
  const host = await Session.create({ name: "P1", difficulty: "easy", minutes: 1, friendlyFire: true });
  const guests = [];
  for (let i = 2; i <= 10; i++) guests.push(await Session.join(host.code, `P${i}`));
  await waitFor("ten players", () => host.state.players.size === 10);
  const info = await api(`/api/sessions/${host.code}`);
  const eleventh = await Session.join(host.code, "P11").then((s) => s.leave() ?? "joined", () => "refused");
  if (!info.body?.full || eleventh !== "refused") failures.push(`team of ten not full (full=${info.body?.full}, eleventh ${eleventh})`);
  const places = new Set([...host.state.players.values()].map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`));
  if (places.size !== 10) failures.push(`players share spawn points (${places.size} places for 10 players)`);

  host.send("start", {});
  const shooter = guests[0];
  const victim = () => host.state.players.get(host.sessionId);
  await waitFor("big team round", () => host.state.phase === "playing" && victim().protection === 0, 9000);
  const me = shooter.state.players.get(shooter.sessionId);
  const shoot = (target) => shooter.send("shoot", { weapon: "rifle", origin: [me.x, 1.5, me.z], end: [victim().x, 1.5, victim().z], hitPlayer: target });
  shoot("nobody");
  await sleep(400);
  const untouched = victim().hp;
  shoot(host.sessionId);
  await waitFor("friendly fire damage", () => victim().hp < untouched, 2000);
  if (untouched !== 100 || victim().hp !== 88) failures.push(`friendly fire damage wrong: ${untouched} -> ${victim().hp}`);
  if (me.hits !== 0) failures.push("a hit on a teammate counted for accuracy");
  console.log(`big team: 10 players, 11th ${eleventh}, friendly fire ${untouched} -> ${victim().hp}, ok=${failures.length === before}`);
  for (const s of [...guests, host]) s.leave();
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

async function waitFor(what, check, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (check()) return true;
  failures.push(`timed out waiting for ${what}`);
  return false;
}

/** Shoots the nearest zombie, like the solo bot with perfect aim. */
function fire(session) {
  const s = session.state;
  const me = s.players.get(session.sessionId);
  if (!me || me.dead || s.phase !== "playing") return;
  let best;
  for (const [id, z] of s.zombies) {
    const d = Math.hypot(z.x - me.x, z.z - me.z);
    if (d < 55 && (!best || d < best.d)) best = { id, z, d };
  }
  if (best) session.send("shoot", { weapon: "rifle", origin: [me.x, 1.5, me.z], end: [best.z.x, 1.5, best.z.z], hit: { zombie: best.id, head: false } });
}

/** `member` is the test account; when it is confirmed it plays as the guest, to check the members leaderboard. */
async function checkLobby(member) {
  const before = failures.length;
  const host = await Session.create({ name: "Host", difficulty: "normal", minutes: 3 });
  const hostErrors = [];
  host.onMessage("error", (e) => hostErrors.push(e.message));
  await sleep(1500);
  const lobby = (s) => s.state.phase === "lobby" && s.state.zombies.size === 0 && s.state.timer === 0 && s.state.wave === 0;
  if (!lobby(host)) failures.push(`team session not waiting in the lobby (${host.state.phase}, timer ${host.state.timer}, ${host.state.zombies.size} zombies)`);
  const info = await api(`/api/sessions/${host.code}`);
  if (info.body?.phase !== "lobby") failures.push(`session info phase ${info.body?.phase}`);

  const guest = await Session.join(host.code, "Guest", undefined, undefined, member.verified ? member.account.cookie() : undefined);
  const guestErrors = [];
  guest.onMessage("error", (e) => guestErrors.push(e.message));
  await waitFor("guest in the lobby", () => lobby(guest) && guest.state.players.size === 2);

  guest.send("start", {});
  guest.send("settings", { difficulty: "hard", minutes: 10 });
  host.send("settings", { difficulty: "bogus", minutes: 2 });
  await waitFor("rejections", () => guestErrors.length === 2 && hostErrors.length === 1);
  await sleep(300);
  if (!lobby(host) || host.state.difficulty !== "normal" || host.state.duration !== 180) failures.push("non-host start/settings or invalid settings accepted");

  const star = host.state.scoreStar;
  host.send("settings", { difficulty: "easy" });
  host.send("settings", { minutes: 1 });
  host.send("settings", { energy: "infinite" });
  await waitFor("guest to see the new settings", () => guest.state.difficulty === "easy" && guest.state.duration === 60 && guest.state.energy === "infinite");
  if (guest.state.scoreStar === star || !lobby(guest)) failures.push("settings change did not update the star score or left the lobby");

  host.send("start", {});
  await waitFor("countdown", () => guest.state.phase === "countdown");
  const countdown = guest.state.timer;
  if (countdown > 3) failures.push(`lobby countdown ${countdown}s`);
  await waitFor("round start", () => guest.state.phase === "playing", 5000);
  // Without friendly fire a shot at a teammate does nothing.
  await waitFor("spawn protection to end", () => host.state.players.get(host.sessionId).protection === 0, 5000);
  const mate = guest.state.players.get(host.sessionId);
  guest.send("shoot", { weapon: "rifle", origin: [mate.x + 1, 1.5, mate.z], end: [mate.x, 1.5, mate.z], hitPlayer: host.sessionId });
  await sleep(400);
  if (host.state.players.get(host.sessionId).hp !== 100) failures.push("teammate hurt with friendly fire off");

  const kills = new Map([[host, 0], [guest, 0]]);
  const hits = new Map([[host, 0], [guest, 0]]);
  for (const s of kills.keys()) {
    s.onMessage("kill", (e) => e.by === s.sessionId && kills.set(s, kills.get(s) + 1));
    s.onMessage("zombieHit", (e) => e.by === s.sessionId && hits.set(s, hits.get(s) + 1));
  }
  const shooting = setInterval(() => kills.forEach((_, s) => fire(s)), 150);
  await waitFor("round end", () => host.state.phase === "ended" && guest.state.phase === "ended", 75_000);
  clearInterval(shooting);
  const score = host.state.teamScore;
  console.log(`lobby round: ${host.state.difficulty} ${host.state.duration}s, team score ${score}, kills host=${kills.get(host)} guest=${kills.get(guest)}, hits host=${hits.get(host)} guest=${hits.get(guest)}`);
  if (!kills.get(host) && !kills.get(guest)) failures.push("nobody scored a kill in the lobby round");
  if (!hits.get(host) || !hits.get(guest)) failures.push("a lobby player landed no hits");
  for (const s of kills.keys()) {
    const p = host.state.players.get(s.sessionId);
    if (!p || p.hits !== hits.get(s) || p.shots < p.hits) failures.push(`accuracy counters wrong: ${p?.hits}/${p?.shots} for ${hits.get(s)} hit events`);
  }
  if (host.state.pickups.size > 0 && [...host.state.pickups.values()].some((p) => p.kind === "energy")) failures.push("energy capsules in an infinite round");

  // Players without an account are ranked on the public board, members on their own.
  await sleep(1500);
  const board = async (kind, cookie) =>
    (await (await fetch(`${url}/api/leaderboard?difficulty=easy&minutes=1&energy=infinite&board=${kind}&limit=50`, { headers: cookie ? { cookie } : {} })).json()).entries ?? [];
  const publicNames = (await board("public")).map((e) => e.nickname);
  if (!publicNames.includes("Host")) failures.push("host missing on the public leaderboard");
  if (member.verified) {
    const members = await board("members", member.account.cookie());
    const mine = members.find((e) => e.me);
    if (mine?.nickname !== member.nickname) failures.push(`member not on the members leaderboard (${JSON.stringify(mine)})`);
    if (publicNames.includes(member.nickname)) failures.push("member listed on the public leaderboard");
  } else if ((await board("members")).some((e) => e.nickname === "Guest")) {
    failures.push("player without an account on the members leaderboard");
  }

  guest.send("restart", {});
  await sleep(500);
  if (guest.state.phase !== "ended") failures.push("non-host restart accepted");
  host.send("restart", {});
  await waitFor("both back in the lobby", () => lobby(host) && lobby(guest));
  const scores = [...guest.state.players.values()].map((p) => p.score);
  if (scores.some((s) => s !== 0) || guest.state.teamScore !== 0) failures.push("scores not reset in the lobby");
  if (guest.state.difficulty !== "easy" || guest.state.duration !== 60 || guest.state.energy !== "infinite") failures.push("lobby forgot the settings");

  host.send("start", {});
  await waitFor("second round", () => host.state.phase === "playing", 6000);
  const late = await Session.join(host.code, "Late");
  if (late.state.phase !== "playing" || late.state.players.size !== 3) failures.push(`late joiner saw ${late.state.phase} with ${late.state.players.size} players`);
  for (const s of [late, guest, host]) s.leave();
  console.log(`lobby: code=${host.code} waits, settings host-only, start host-only, play again -> lobby, late join -> playing, ok=${failures.length === before}`);
}

await checkSessions();
const member = await checkAccounts();
await checkTeam();
await checkBigTeam();
await checkLobby(member);
await finishAccounts(member);

const playerId = crypto.randomUUID();
const room = await Session.create({ name: "Bot", playerId, solo: true, difficulty, energy, ...(minutes ? { minutes } : { duration }) });
await sleep(300);
console.log(`joined ${room.code}, ${room.state.difficulty} round ${room.state.duration}s, star at ${room.state.scoreStar}${testDeath ? ", testing knockout" : ""}`);
if (room.state.difficulty !== difficulty) failures.push(`difficulty ${room.state.difficulty}, expected ${difficulty}`);
if (room.state.energy !== energy) failures.push(`energy ${room.state.energy}, expected ${energy}`);
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
let waveCountdowns = 0;
let countingDown = false;
let earlyWave = false;
let sawCapsule = false;
let collected = 0;
let healed = 0;
let healAttempts = 0;
let home;
const types = new Set();

room.onMessage("zombieHit", () => hits++);
room.onMessage("kill", () => kills++);
room.onMessage("playerHurt", (e) => {
  if (e.player === room.sessionId) hurt++;
});
room.onMessage("personalBest", (e) => (personalBest = e));
room.onMessage("pickup", (e) => {
  if (e.player !== room.sessionId) return;
  if (e.kind === "energy") collected++;
  else healed += e.amount;
});

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

    if (s.phase === "playing") {
      if (s.waveIn > 0 && !countingDown) waveCountdowns++;
      countingDown = s.waveIn > 0;
      if (s.waveIn > 0 && s.zombies.size > 0) earlyWave = true;
    }

    let { x, z } = me;
    // The server does not limit movement speed, so the bot steps straight onto a capsule to collect it.
    const capsule = [...s.pickups].find(([, p]) => p.kind === "energy");
    if (capsule) sawCapsule = true;
    if (capsule && !human && !me.dead && !deathPhase && s.phase === "playing") {
      x = capsule[1].x;
      z = capsule[1].z;
      room.send("move", { x, y: 0, z, yaw: 0, pitch: 0 });
      room.send("collect", { id: capsule[0] });
    }
    // While waiting to be knocked out, a hurt bot steps onto a health pack once and returns to the zombies.
    const pack = [...s.pickups].find(([, p]) => p.kind === "health");
    if (deathPhase && pack && !me.dead && me.hp < 100 && healed === 0) {
      healAttempts++;
      home ??= { x, z };
      x = pack[1].x;
      z = pack[1].z;
    } else if (home) {
      ({ x, z } = home);
      home = undefined;
    }
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
          `hits=${hits} shots=${me.shots} hurt=${hurt} maxAlive=${maxAlive} waves=${s.wave} countdowns=${waveCountdowns} capsules=${collected} healed=${healed} ` +
          `dancing=${dancing}/${s.zombies.size} types=${[...types].join(",")}`,
      );
      if (s.phase !== "ended") failures.push("round did not end");
      if (kills === 0) failures.push("no kills");
      if (dancing !== s.zombies.size) failures.push("not all zombies dance");
      if (testDeath && !respawned) failures.push("no knockout/respawn observed");
      if (!penaltyOk) failures.push("death penalty wrong");
      if (me.deaths !== observedDeaths) failures.push(`deaths counter ${me.deaths}, observed ${observedDeaths}`);
      if (s.teamScore !== me.score) failures.push("team score != player score");
      if (pauseCheck !== "ok") failures.push(`solo pause did not freeze the timer (${pauseCheck})`);
      if (me.hits !== hits || me.shots < me.hits) failures.push(`accuracy counters wrong: ${me.hits}/${me.shots} for ${hits} hit events`);
      if (healAttempts > 3 && healed === 0) failures.push("health pack not applied to a hurt player standing on it");
      if (earlyWave) failures.push("a wave was announced while zombies were still standing");
      if (s.wave > 1 && waveCountdowns < s.wave - 1) failures.push(`${s.wave} waves but only ${waveCountdowns} countdowns`);
      if (s.waveIn !== 0 || s.pickups.size !== 0) failures.push("wave countdown or pickups left after the round");
      if (energy === "infinite" ? sawCapsule : !human && !testDeath && duration >= 40 && collected === 0) failures.push(`energy capsules wrong for ${energy} mode (seen=${sawCapsule}, collected=${collected})`);
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
  const board = await api(`/api/leaderboard?level=${room.state.levelId}&difficulty=${difficulty}&minutes=${roundMinutes}&energy=${energy}&limit=50&player=${playerId}`);
  const mine = board.body?.entries?.find((e) => e.me);
  console.log(`leaderboard ${difficulty}/${roundMinutes}min/${energy}: ${board.body?.entries?.length ?? 0} entries, bot ${mine ? `#${mine.rank} ${mine.nickname} ${mine.score}` : "missing"}`);
  if (!mine || mine.score !== finalScore) failures.push("bot not on the leaderboard with its score");
  const other = energy === "limited" ? "infinite" : "limited";
  const otherBoard = await api(`/api/leaderboard?level=${room.state.levelId}&difficulty=${difficulty}&minutes=${roundMinutes}&energy=${other}&limit=50&player=${playerId}`);
  if (otherBoard.body?.entries?.some((e) => e.me)) failures.push(`bot also on the ${other} leaderboard`);
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
