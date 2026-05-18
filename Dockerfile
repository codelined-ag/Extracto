ARG BUN_IMAGE=oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4

FROM ${BUN_IMAGE} AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile
RUN bun run db:generate

FROM ${BUN_IMAGE} AS builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY prisma ./prisma
COPY . .
RUN node node_modules/.bin/next build \
  && cp -r .next/static .next/standalone/.next/ \
  && cp -r public .next/standalone/

FROM ${BUN_IMAGE} AS runtime-deps
WORKDIR /app

COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile --production
RUN bun run db:generate

FROM ${BUN_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL=file:/app/data/custom.db

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY --from=builder /app/prisma ./prisma

COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src/lib ./src/lib
RUN chmod +x ./docker-entrypoint.sh

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=10 \
  CMD ["bun", "-e", "const res = await fetch('http://127.0.0.1:3000/api/health'); process.exit(res.ok ? 0 : 1)"]

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["bun", "server.js"]
