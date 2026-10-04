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
   Worker. It checks session options, a two-client team session (join, reconnect, host transfer),
   the team lobby, and a bot-played solo round; with `--minutes=N` it also checks the leaderboard.
   It prints `OK` or the list of failures. See `client/scripts/smoke-bot.mjs` for all flags.
3. For UI changes, open the game in a browser. `?debug` exposes the game as `window.game` and
   shows the performance overlay; `?debug&duration=N` makes solo rounds N seconds long;
   `?quality=low|medium|high|ultra|auto` overrides the graphics setting.

Gameplay needs pointer lock, which embedded and automated browsers usually refuse. Menus, lobby and
settings can be checked there; mouse look has to be simulated (stub `requestPointerLock` and
`document.pointerLockElement`, dispatch `mousemove` events with `movementX`) or tried by a human.

## Layout

```
client/     Three.js game, menus, HUD (Vite, no UI framework)
  src/engine/   renderer, quality presets, auto resolution scaler, asset loading
  src/game/     Game (main loop), Input, PlayerController, World, weapons, zombies, fx
  src/net/      Network (WebSocket + state decoding), api.ts (HTTP calls, player id)
  src/ui/       Menu, Settings, Lobby, Hud, Leaderboard, PerfOverlay
  scripts/      smoke-bot.mjs
worker/     Cloudflare Worker
  src/index.ts        HTTP routes
  src/GameSession.ts  Durable Object, one per session code
  src/GameRoom.ts     sockets, message validation, state broadcast, result recording
  src/game/           Simulation (waves, zombies, scoring), FlowField (pathfinding)
  src/scores.ts       D1 queries: leaderboard, round recording, personal bests
shared/     Code used by both sides: state schema, messages, constants, weapons,
            zombies, difficulties, level data and collision
migrations/ D1 schema
scripts/    Asset pipeline (fetch-assets, zombie LODs, Meshy character generation)
```

## Architecture

- **Server authority.** `GameRoom` owns the `GameState` and ticks the `Simulation` at 20 Hz
  (`TICK_RATE` in `shared/src/constants.ts`). Clients send their own position and their shots,
  including which zombie they hit; the server validates (weapon, range, finite numbers) and owns
  health, score, waves and zombie movement.
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
  `GET /api/health`. Everything else is served from `client/dist` as a single-page app.

## Scores and leaderboard

- Finished rounds are stored in D1 (`rounds`, `round_players`) by `recordRound`.
- A leaderboard entry is one browser id plus one nickname (case-insensitive), best score per
  level, difficulty and round length. The browser id is an anonymous UUID in localStorage, so
  several people sharing a browser each keep their own entry as long as their nicknames differ.
  Personal bests follow the same identity.
- Rounds with a non-standard test length are stored with `duration_minutes = 0` and never appear
  on a leaderboard.
- Schema changes need a new numbered file in `migrations/`. It is applied locally with
  `pnpm run db:migrate:local` and to production separately (see Deployment).

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
  `minutes`, `graphics`, `sensitivity`, `playerId`. Difficulty and round length are round settings
  (the host's apply to a team); graphics and sensitivity are device settings.
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

### Zombie characters (Meshy)

All zombie characters in `client/public/assets/characters` were generated with the
[meshy.ai](https://www.meshy.ai) API: text-to-3D preview, refine (texturing), rigging and animation.

- `scripts/meshy/cast.mjs` defines the cast (one prompt per character), the shared style prompts
  and the animation list. The style prompts carry the no-blood, kid-friendly look; keep new
  characters consistent with them.
- `scripts/meshy/generate.mjs` runs the pipeline and writes the optimized `.glb` files:
  `node scripts/meshy/generate.mjs <id...|all> [--until=preview|refine|rig|animate|export]`.
- The API token is read from `MESHY_API_KEY` in the `.env` file at the repo root (or from the
  environment). `.env` is gitignored and also holds Cloudflare credentials: never commit it, and
  never print or copy its values into code, logs, docs or chat.
- Every pipeline step costs Meshy credits. The task ids of finished steps are kept in
  `scripts/meshy/state/<id>.json`, so re-running resumes instead of paying again; do not delete
  those files, and do not run the generator unless asked.
- After generating or changing a character, run `node scripts/zombie-lods.mjs` to add the LOD
  meshes, and update `characters/manifest.json` if the cast or the clips changed.

## Deployment

Pushing to the repository deploys through Cloudflare Workers Builds (`pnpm run build`, then
`npx wrangler deploy`), so a push goes live. Do not push or deploy unless asked.

D1 migrations are not part of that build. A new migration must be applied to production by hand,
before or together with the code that needs it:

```bash
npx wrangler d1 migrations apply zombie-breakout-db --remote
```

Bindings (`ASSETS`, `GAME`, `DB`) are declared in `wrangler.toml` and typed in `worker/src/env.ts`.
