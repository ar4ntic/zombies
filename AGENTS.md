# AGENTS.md

Guidance for coding agents working on Zombie Breakout. `README.md` is the human-facing
introduction; this file covers what an agent needs to change the code safely.

## What this is

A first-person co-op zombie shooter for the browser: solo rounds or private team sessions of up to
4 players, joined by a 6-character session code or a `/join/CODE` link. Everything runs on one
Cloudflare Worker (static client, HTTP API, a Durable Object per session, a D1 database for scores).

The tone is family-friendly: players are "knocked out", never killed, and damage feedback is amber,
never red or bloody. Keep new text and effects in that register.

## Commands

Requires Node 22 and pnpm 9 (`corepack enable`). Use pnpm only; an `npm install` leaves the
workspace packages (`client`, `shared`, `worker`) without their dependencies.

```bash
pnpm install
pnpm run db:migrate:local   # create the local D1 tables, once per new migration
pnpm dev:client             # Vite on :5173, proxies /api and /ws to :8787
pnpm dev:worker             # wrangler dev (Worker + Durable Object + D1) on :8787
pnpm typecheck              # tsc for shared, client and worker
pnpm build                  # Vite production build into client/dist
pnpm smoke http://localhost:8787 --minutes=1 --difficulty=easy
```

`wrangler dev` started in the background by an agent is stopped when the tool's time limit runs out;
give it a long limit when a session will need the server for a while.

- `pnpm dev` is meant to start both dev servers but fails on pnpm 9.15 with "None of the selected
  packages has a `/^dev:/` script". Start `dev:client` and `dev:worker` separately.
- The Vite proxy target (`:8787`) is hardcoded in `client/vite.config.ts`. If another project
  already listens on 8787, build the client and serve everything from the Worker on a free port:
  `pnpm build && pnpm exec wrangler dev --port 8788`.
- There is no linter, formatter config or unit test suite. `pnpm typecheck` plus the smoke bot are
  the checks.

## Verifying a change

1. `pnpm typecheck` must pass.
2. For anything touching the Worker, the protocol or scores, run the smoke bot against a running
   Worker. It checks session options, accounts, a two-client team session (join, reconnect, host
   transfer), the team lobby, and a bot-played solo round (waves, pickups, accuracy counters); with
   `--minutes=N` it also checks the leaderboard, and with `--mail-log=FILE` (the output of the local
   `wrangler dev`) the email confirmation and nickname protection. It prints `OK` or the list of
   failures. See `client/scripts/smoke-bot.mjs` for all flags.
3. For UI changes, open the game in a browser. `?debug` exposes the game as `window.game` and
   shows the performance overlay; `?debug&duration=N` makes solo rounds N seconds long;
   `?quality=low|medium|high|ultra|auto` overrides the graphics setting.

Gameplay needs pointer lock, which embedded and automated browsers usually refuse. Menus, lobby and
settings can be checked there; mouse look has to be simulated (stub `requestPointerLock` and
`document.pointerLockElement`, dispatch `mousemove` events with `movementX`) or tried by a human.

A browser pane that is not visible gets no animation frames, and the game's timer reports no elapsed
time while `document.hidden` is true. To drive the game there, override `document.hidden` to false
and call `game.frame(performance.now())` in a loop that yields between frames.

## Layout

```
client/     Three.js game, menus, HUD (Vite, no UI framework)
  src/engine/   renderer, quality presets, auto resolution scaler, asset loading
  src/game/     Game (main loop), Input, PlayerController, World, Pickups, weapons, zombies,
                players (skins of the other players), fx
  src/net/      Network (WebSocket + state decoding), api.ts (HTTP calls, player id), account.ts
  src/ui/       Menu, Settings, Account, CharacterPicker, Lobby, Hud, Leaderboard, PerfOverlay
  scripts/      smoke-bot.mjs
worker/     Cloudflare Worker
  src/index.ts        HTTP routes
  src/GameSession.ts  Durable Object, one per session code
  src/GameRoom.ts     sockets, message validation, state broadcast, result recording
  src/game/           Simulation (waves, zombies, pickups, scoring), FlowField (pathfinding)
  src/scores.ts       D1 queries: leaderboard, round recording, personal bests
  src/accounts.ts     /api/auth routes, nickname ownership
  src/auth.ts         password hashing, session cookie, mailed tokens, attempt limits
  src/mail.ts         account mails through Resend
shared/     Code used by both sides: state schema, messages, constants, weapons,
            zombies, difficulties, energy modes, skins, nickname rules, level data and collision
migrations/ D1 schema
scripts/    Asset pipeline (fetch-assets, zombie LODs, Meshy generation of zombies and player skins)
```

## Architecture

- **Server authority.** `GameRoom` owns the `GameState` and ticks the `Simulation` at 20 Hz
  (`TICK_RATE` in `shared/src/constants.ts`). Clients send their own position and their shots,
  including which zombie they hit; the server validates (weapon, range, fire rate, finite numbers)
  and owns health, score, waves, pickups and zombie movement. Energy (ammo) is counted by the client.
- **Waves.** A wave is a fixed list of zombies (level wave table, difficulty `waveSize` and `brutes`,
  team size). The next wave is announced through `GameState.waveIn` for `WAVE_COUNTDOWN_SECONDS` once
  no zombie of the current one is left; the round ends when its timer runs out.
- **Pickups.** `GameState.pickups` holds energy capsules (only with `energy: "limited"`) and health
  packs, spawned at the difficulty's rate. Health is applied by the server when a hurt player walks
  over a pack; a capsule is handed over when the client asks with `collect`, so a full rifle leaves it.
- **Height.** Boxes carry a height. The client walks over and stands on boxes whose top is at or below
  its feet (`surfaceHeight`, `resolveCircle` with `above`); the server derives which object a player
  stands on and zombies only hit players no higher than their `reach`. Zombies never leave the ground.
- **Protocol.** One WebSocket per player at `/ws/CODE`. Text frames are JSON envelopes
  `{ type, data }` typed by `ClientMessages` and `ServerEvents` in `shared/src/messages.ts`. Binary
  frames are `@colyseus/schema` bytes prefixed with one `StateFrame` byte (full state or patch).
  Only the schema library is used, not the Colyseus server.
- **State.** `shared/src/schema.ts` defines `GameState`, `PlayerState` and `ZombieState`. A new
  synced field goes there; both sides pick it up through `@zombies/shared`.
- **Sessions.** `POST /api/sessions` allocates a code and initialises the Durable Object. A room
  lives in memory only while players are connected or inside the 30 s reconnect grace period, and
  an unused session is freed after 60 s. Nothing about a running round is persisted.
- **Phases.** `lobby` (team sessions only), `countdown`, `playing`, `ended`. Solo rounds pause
  while the pointer is unlocked; team rounds keep running.
- **HTTP API.** `POST /api/sessions`, `GET /api/sessions/:code`, `GET /api/leaderboard`,
  `GET /api/nicknames/check`, `/api/auth/*` (register, login, logout, me, nickname, verify, resend,
  forgot, reset), `GET /api/health`. Everything else is served from `client/dist` as a single-page app.

## Scores and leaderboard

- Finished rounds are stored in D1 (`rounds`, `round_players`) by `recordRound`.
- A leaderboard entry is the best score per level, difficulty, round length and energy mode of one
  player: an account, or for anonymous players one browser id plus one nickname (compared by
  `nicknameKey`). The browser id is an anonymous UUID in localStorage, so several people sharing a
  browser each keep their own entry as long as their nicknames differ. Personal bests follow the
  same identity.
- `round_players` also stores shots and hits, for the accuracy shown at the end of a round.
- Rounds with a non-standard test length are stored with `duration_minutes = 0` and never appear
  on a leaderboard.
- Schema changes need a new numbered file in `migrations/`. It is applied locally with
  `pnpm run db:migrate:local` and to production separately (see Deployment).

## Accounts

- An account is an email address, a password and at most one nickname. Once the email address is
  confirmed, the Worker refuses that nickname to everybody who is not logged in to the account, at
  the WebSocket upgrade in `worker/src/index.ts`; anonymous leaderboard entries under it are hidden.
- A logged-in player always plays under the account's nickname. The Worker, not the client, tells
  the Durable Object which account a player belongs to (`account` query parameter, stripped from
  whatever the client sent).
- Passwords are PBKDF2-SHA256 hashes (100,000 rounds, the Workers limit). The session is an HttpOnly
  cookie; only hashes of session and mail tokens are stored. State-changing auth requests must come
  from the same host (`sameOrigin`) and are rate limited per address through `auth_attempts`.
- Mails go through Resend and need the `RESEND_API_KEY` secret and the `MAIL_FROM` var. Without
  them nothing is sent; on a local host the link is logged instead. Never log tokens elsewhere.
- Mailed links carry their token after the `#` (`/verify#TOKEN`, `/reset#TOKEN`); `client/src/main.ts`
  consumes it and clears the URL.
- Accounts whose email was never confirmed stop reserving their email and nickname after 7 days.

## Client conventions

- UI is plain DOM: a class or function builds its markup with a template string, collects
  elements by `data-ref`, and handles clicks by `data-action` through one delegated listener.
  Follow that pattern instead of adding a framework.
- Anything user-supplied (nicknames, links) goes through `escapeHtml` before entering a template.
- `Hud.update` runs every frame; write to the DOM through its `set`/`setStyle`/`setHidden`
  helpers, which skip unchanged values.
- Shared UI pieces: `ui/segmented.ts` (segmented radio controls), `ui/clipboard.ts` (copy with a
  fallback for non-HTTPS origins, where `navigator.clipboard` does not exist), `ui/Settings.ts`
  (graphics quality, mouse sensitivity and its "Try it out" look test, used by the main menu and
  the pause menu).
- Per-browser preferences live in localStorage under `zombies.*` keys: `nickname`, `difficulty`,
  `minutes`, `energy`, `skin`, `graphics`, `sensitivity`, `playerId`. Difficulty, round length and
  energy mode are round settings (the host's apply to a team); graphics and sensitivity are device
  settings; the skin is the player's own choice.
- A new round setting is added in `settingsSelectors`, `settingChange` and `settingValue` in
  `ui/Menu.ts`, which the lobby reuses.
- Styles are in the single `client/src/styles.css`. An element with an explicit `display` needs a
  `[hidden]` rule to be hideable; `.menu [hidden]` and `.hud [hidden]` already cover those trees.
- Graphics presets and what the auto scaler may change at runtime are in `engine/Renderer.ts` and
  `engine/AutoScaler.ts`.

## Code style

- TypeScript, strict, with `noUncheckedIndexedAccess`. Relative imports include the `.ts`
  extension; type-only imports use `import type` or inline `type` (`verbatimModuleSyntax`).
- Shared code is imported as `@zombies/shared`. Gameplay numbers belong in `shared/src/constants.ts`,
  `difficulty.ts`, `weapons.ts` or `zombies.ts`, not inline.
- Two-space indentation, double quotes, semicolons, lines up to about 160 characters.
- Comments are sparse and explain the code as it stands: invariants, hidden constraints,
  surprising browser behaviour. Do not reference tickets, PRs, requirement ids or bug-fix history
  in code or comments; that belongs in the commit message.
- Validate everything a client sends in `GameRoom.handleMessage` before it reaches the simulation.

## Assets

Models, textures and the HDRI in `client/public/assets` are committed and produced by the scripts
in `scripts/` (`pnpm assets`, `node scripts/zombie-lods.mjs`, `scripts/meshy/`). Do not hand-edit
the binaries; change the script and regenerate. Third-party credits are in
`client/public/assets/CREDITS.txt` and must stay current when art is added.

### Characters (Meshy)

All zombie characters and player skins in `client/public/assets/characters` were generated with the
[meshy.ai](https://www.meshy.ai) API: text-to-3D preview, refine (texturing), rigging and animation.

- `scripts/meshy/cast.mjs` defines the two casts (`CAST` for zombies, `PLAYERS` for player skins;
  one prompt per character), their style prompts and animation lists. The style prompts carry the
  no-blood, kid-friendly look; keep new characters consistent with them.
- `scripts/meshy/generate.mjs` runs the pipeline and writes the optimized `.glb` files:
  `node scripts/meshy/generate.mjs <id...|zombies|players|all> [--until=preview|refine|rig|animate|export]`.
  For player skins it also writes the portrait `characters/thumbs/<id>.webp`.
- A player skin also needs its entry in `shared/src/skins.ts` (id, label, colors of the first-person
  arms). The character picker only offers skins whose portrait exists; a player whose skin model is
  missing is shown as a plain stand-in.
- The API token is read from `MESHY_API_KEY` in the `.env` file at the repo root (or from the
  environment). `.env` is gitignored and also holds Cloudflare credentials: never commit it, and
  never print or copy its values into code, logs, docs or chat.
- Every pipeline step costs Meshy credits. The task ids of finished steps are kept in
  `scripts/meshy/state/<id>.json`, so re-running resumes instead of paying again; do not delete
  those files, and do not run the generator unless asked.
- After generating or changing a zombie, run `node scripts/zombie-lods.mjs` to add the LOD meshes
  (it skips player skins), and update `characters/manifest.json` if the cast or the clips changed.
  The manifest maps clip keys to clip names separately for zombies (`clips`) and skins (`players.clips`).

## Deployment

Pushing to the repository deploys through Cloudflare Workers Builds (`pnpm run build`, then
`npx wrangler deploy`), so a push goes live. Do not push or deploy unless asked.

D1 migrations are not part of that build. A new migration must be applied to production by hand,
before or together with the code that needs it:

```bash
npx wrangler d1 migrations apply zombie-breakout-db --remote
```

Bindings (`ASSETS`, `GAME`, `DB`), the `MAIL_FROM` var and the `RESEND_API_KEY` secret are declared
in `wrangler.toml` (the secret with `npx wrangler secret put RESEND_API_KEY`) and typed in
`worker/src/env.ts`.
