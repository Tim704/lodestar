# Lodestar — single multi-stage image (amd64 + arm64; runs on a Pi 4/5).
# Build: docker build -t lodestar .
# The final image is one Node process serving API + web + WebSockets.

FROM node:22-alpine AS build
RUN corepack enable pnpm
WORKDIR /app

# manifests first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

COPY shared/ shared/
COPY server/ server/
COPY web/ web/
RUN pnpm -r run build

# prod deps only, per-package
RUN pnpm --filter @lodestar/server --prod deploy --legacy /out/server

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /out/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/migrations ./migrations
COPY --from=build /app/shared/dist ./node_modules/@lodestar/shared/dist
COPY --from=build /app/shared/package.json ./node_modules/@lodestar/shared/package.json
COPY --from=build /app/web/dist ./public

EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "dist/index.js"]
