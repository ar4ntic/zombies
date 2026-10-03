# Zombie Breakout

A first-person co-op zombie shooter that runs in the browser. Play solo or create a private
team session and share the link with friends.

Everything runs on one Cloudflare Worker:

- static assets: the Vite build in `client/dist` (single-page app, so `/join/CODE` links work)
- `GameSession` Durable Object: the authoritative game server for one session code
  (20 Hz simulation, WebSockets, state sync with `@colyseus/schema`)
- D1 database `zombie-breakout-db`: finished rounds, personal bests and leaderboards

## Develop

Requires Node 22 and pnpm (`corepack enable`).

```bash
pnpm install
pnpm run db:migrate:local   # creates the local D1 tables (once)
pnpm dev                    # Vite client on :5173, wrangler dev (Worker + DO + D1) on :8787
pnpm typecheck
```

Vite proxies `/api` and `/ws` to the Worker. To run the production build locally instead:

```bash
pnpm build
npx wrangler dev            # serves client/dist and the API on http://localhost:8787
```

Append `?quality=low|medium|high|ultra` to the URL to override the graphics preset.
With `?debug` the game is exposed as `window.game`, and `?debug&duration=N` makes solo rounds N seconds long.

## Smoke test

Runs session option checks, a two-client team session (join by code, reconnect, host transfer)
and one bot-played solo round against a running Worker:

```bash
pnpm smoke http://localhost:8787 60 --difficulty=nightmare --die   # round length in seconds
pnpm smoke http://localhost:8787 --minutes=1 --difficulty=easy      # standard round, also checks the leaderboard
```

`--die` lets the bot get knocked out once to check the penalty and respawn; `--human` and
`--still` play like a decent (kiting or stationary) player, for tuning the star scores.

## Deploy

Pushing to the repository deploys through Workers Builds (build command `pnpm run build`,
deploy command `npx wrangler deploy`). The D1 schema is applied separately, once per new migration:

```bash
npx wrangler login
npx wrangler d1 migrations apply zombie-breakout-db --remote
```

(or paste `migrations/0001_scores.sql` into the D1 console in the Cloudflare dashboard).

Rounds with a non-standard test length (`?duration=N`) are stored with `duration_minutes = 0`
and never show up on leaderboards.

## Project layout

- `client/` - Three.js game, menus, HUD and leaderboard (Vite)
- `worker/` - Cloudflare Worker: HTTP API, `GameSession` Durable Object, simulation, D1 scores
- `shared/` - state schema, messages and constants used by both
- `migrations/` - D1 schema
- `scripts/fetch-assets.mjs` - downloads and optimizes third-party art (`pnpm assets`)

Art credits are listed in `client/public/assets/CREDITS.txt`.
