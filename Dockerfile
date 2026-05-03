FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock prisma ./
RUN bun install --frozen-lockfile
RUN bun run db:generate

FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock prisma ./
COPY . .
RUN bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL=file:/app/data/custom.db

COPY --from=deps /app/node_modules ./node_modules
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
