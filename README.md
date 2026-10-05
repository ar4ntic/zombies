# Zombie Breakout

A first-person co-op zombie shooter that runs in the browser. Play solo or create a private
team session and share the link with friends.

Everything runs on one Cloudflare Worker:

- static assets: the Vite build in `client/dist` (single-page app, so `/join/CODE` links work)
- `GameSession` Durable Object: the authoritative game server for one session code
  (20 Hz simulation, WebSockets, state sync with `@colyseus/schema`)
- D1 database `zombie-breakout-db`: finished rounds, personal bests, leaderboards and accounts

## How it plays

- Laser pistol and laser rifle fire bolts and are reloaded with energy capsules. The round setting
  "Rifle energy" decides whether the rifle's spare capsules are infinite or have to be collected in the arena.
- Zombies come in waves. A wave has a fixed number of zombies for the difficulty and team size, and the next
  one starts three seconds after the last zombie of the current one is knocked out. The round still ends
  when its timer runs out.
- Energy capsules (limited mode) and health packs appear in the arena, more often on lower difficulties.
- Players can jump onto crates, walls and cars. Walkers and runners cannot hit a player standing higher than
  one meter; brutes can.
- Players pick one of the character skins; the others see it, and it colors their own first-person arms.
- Team sessions take up to 10 players. "Friendly fire" is a round setting: when it is on, shots also hurt teammates.
- Later waves bring fast, galloping zombie dogs and cats on normal difficulty and above.
- A round map in the corner, turned with the player's view, shows zombies, teammates, pickups and obstacles.
- Bolts leave burn marks on the ground, walls and objects.
- The end of a round shows every player's accuracy (hits per shot).
- An optional account (email and password) owns one nickname. Once the email address is confirmed, nobody
  else can play under that nickname, the account is ranked on the members leaderboard instead of the
  public one, and it can open and join private team sessions.

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

Graphics quality (Auto, Low, Medium, High, Ultra) and mouse sensitivity are set under Settings in the
main menu or in the in-game menu, and stored in localStorage. Auto scales the render resolution to hold the display refresh rate (at most 60 fps) and
drops ambient occlusion, bloom and shadow resolution only when the resolution is already at its minimum.
Append `?quality=auto|low|medium|high|ultra` to the URL to override the setting.

Press F3 for the performance overlay (fps, frame times, CPU/GPU time, render resolution, draw calls,
triangles). With `?debug` the overlay starts visible, the game is exposed as `window.game`, and
`?debug&duration=N` makes solo rounds N seconds long.

## Smoke test

Runs session option checks, account checks, a two-client team session (join by code, reconnect, host
transfer) and one bot-played solo round against a running Worker:

```bash
pnpm smoke http://localhost:8787 60 --difficulty=nightmare --die   # round length in seconds
pnpm smoke http://localhost:8787 --minutes=1 --difficulty=easy      # standard round, also checks the leaderboard
```

`--die` lets the bot get knocked out once to check the penalty and respawn; `--human` and
`--still` play like a decent (kiting or stationary) player, for tuning the star scores;
`--energy=infinite` plays the solo round without capsule pickups. `--mail-log=FILE` points the bot at
the output of a local `wrangler dev`, where account mails are logged instead of sent, so it can also
confirm an account and check that its nickname is refused to everybody else.

## Accounts and mail

Accounts are optional. Passwords are stored as salted PBKDF2 hashes, sessions as an HttpOnly cookie, and
the tokens of mailed links only as hashes. The confirmation and password reset mails go out through
[Resend](https://resend.com):

```bash
npx wrangler secret put RESEND_API_KEY    # API key of the Resend account
```

and `MAIL_FROM` in `wrangler.toml` is the sender, an address on a domain verified at Resend. Without both,
no mail is sent; on `localhost` the link is written to the Worker log instead, so the flows can be tried.

## Deploy

Pushing to the repository deploys through Workers Builds (build command `pnpm run build`,
deploy command `npx wrangler deploy`). The D1 schema is applied separately, once per new migration:

```bash
npx wrangler login
npx wrangler d1 migrations apply zombie-breakout-db --remote
```

Apply new migrations before, or together with, the code that needs them.

Rounds with a non-standard test length (`?duration=N`) are stored with `duration_minutes = 0`
and never show up on leaderboards.

## Project layout

- `client/` - Three.js game, menus, HUD and leaderboard (Vite)
- `worker/` - Cloudflare Worker: HTTP API, `GameSession` Durable Object, simulation, D1 scores
- `shared/` - state schema, messages and constants used by both
- `migrations/` - D1 schema
- `scripts/fetch-assets.mjs` - downloads and optimizes third-party art (`pnpm assets`; add
  `-- --rebuild-models` to re-simplify the models from `.asset-cache` without downloading them again)
- `scripts/zombie-lods.mjs` - adds the two simplified LOD meshes to the zombie characters
  (`node scripts/zombie-lods.mjs`, safe to re-run)
- `scripts/meshy/` - generates the zombie characters, the four-legged zombies and the player skins
  with the Meshy API (costs credits; see `AGENTS.md`)
- `scripts/make-icons.mjs` - renders the PNG icons from `client/public/favicon.svg`

Art credits are listed in `client/public/assets/CREDITS.txt`.
