FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN pnpm install --frozen-lockfile --filter @zombies/client... --filter @zombies/server...

COPY client client
COPY server server
COPY shared shared
RUN pnpm --filter @zombies/client build \
 && pnpm --filter @zombies/server build \
 && pnpm --filter @zombies/server --prod deploy /out

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    CLIENT_DIR=/app/public \
    DATA_DIR=/data
WORKDIR /app

COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/dist ./public
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 8080
VOLUME /data
CMD ["node", "--enable-source-maps", "dist/index.js"]
