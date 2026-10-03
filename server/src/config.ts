import { resolve } from "node:path";

export const config = {
  port: Number(process.env.PORT ?? 2567),
  host: process.env.HOST ?? "0.0.0.0",
  clientDir: resolve(process.env.CLIENT_DIR ?? "../client/dist"),
  dataDir: resolve(process.env.DATA_DIR ?? "./data"),
};
