import { existsSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GAME_ROOM } from "@zombies/shared";
import { config } from "./config.ts";
import { GameRoom } from "./rooms/GameRoom.ts";

const server = defineServer({
  transport: new WebSocketTransport(),
  greet: false,
  rooms: {
    [GAME_ROOM]: defineRoom(GameRoom),
  },
  express: (app) => {
    app.set("trust proxy", true);
    app.disable("x-powered-by");

    app.get("/api/health", (_req, res) => {
      res.json({ ok: true });
    });

    if (existsSync(config.clientDir)) {
      const indexHtml = join(config.clientDir, "index.html");
      app.use("/build", express.static(join(config.clientDir, "build"), { immutable: true, maxAge: "1y" }));
      app.use(express.static(config.clientDir, { index: false, maxAge: "1h" }));
      app.get("/", (_req, res) => res.sendFile(indexHtml));
      app.use((req, res, next) => {
        if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
        res.sendFile(indexHtml);
      });
    }
  },
});

await server.listen(config.port, config.host);
console.log(`Zombie server listening on http://${config.host}:${config.port}`);
