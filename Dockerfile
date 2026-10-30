FROM node:24-bookworm-slim AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

COPY . .

ENV APP_ENV=local \
    API_INTERNAL_URL=http://api:4000 \
    API_PUBLIC_ORIGIN=http://127.0.0.1:4000

RUN pnpm install --frozen-lockfile \
    && pnpm --filter @digital-autograph/api build \
    && pnpm --filter @digital-autograph/worker build \
    && pnpm --filter @digital-autograph/web build \
    && pnpm --filter @digital-autograph/api deploy --legacy --prod /out/api \
    && pnpm --filter @digital-autograph/worker deploy --legacy --prod /out/worker

FROM node:24-bookworm-slim AS api
ARG SOURCE_SHA=unverified
LABEL org.opencontainers.image.revision=$SOURCE_SHA
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api/ ./
COPY --from=build --chown=node:node /workspace/docs/legal/public/ ./docs/legal/public/
COPY --from=build --chown=node:node /workspace/docs/legal/security/ ./docs/legal/security/
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]

FROM node:24-bookworm-slim AS worker
ARG SOURCE_SHA=unverified
LABEL org.opencontainers.image.revision=$SOURCE_SHA
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/worker/ ./
USER node
CMD ["node", "dist/main.js"]

FROM node:24-bookworm-slim AS web
ARG SOURCE_SHA=unverified
LABEL org.opencontainers.image.revision=$SOURCE_SHA
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone/ ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM build AS migration
ARG SOURCE_SHA=unverified
LABEL org.opencontainers.image.revision=$SOURCE_SHA
ENV NODE_ENV=production
WORKDIR /workspace/packages/db
CMD ["./node_modules/.bin/drizzle-kit", "migrate"]
