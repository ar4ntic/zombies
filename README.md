# Zombie Breakout

A first-person co-op zombie shooter that runs in the browser. Play solo or create a private
team session and share the link with friends.

## Run with Docker (production)

```bash
cp .env.example .env      # optional, change PORT if needed
docker compose up -d --build
```

The game is then available at `http://<vm-ip>:8080`. Player data lives in the `zombies-data` volume.

To put it behind your own reverse proxy, forward that single port and allow WebSocket upgrades
(`Upgrade` / `Connection` headers). The server trusts `X-Forwarded-*` headers.

## Develop

Requires Node 22 and pnpm (`corepack enable`).

```bash
pnpm install
pnpm dev                  # client on :5173, game server on :2567
pnpm typecheck
```

Append `?quality=low|medium|high|ultra` to the URL to override the graphics preset.

## Project layout

- `client/` - Three.js game, menus and HUD (Vite)
- `server/` - Colyseus game server + Express API
- `shared/` - state schema, messages and constants used by both
- `scripts/fetch-assets.mjs` - downloads and optimizes third-party art (`pnpm assets`)

Art credits are listed in `client/public/assets/CREDITS.txt`.
