# syntax=docker/dockerfile:1.7
# ---- deps ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---- build ----
FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/* \
  && groupadd -r kasku && useradd -r -g kasku -d /app kasku
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

# Aplikasi Next.js (standalone)
COPY --from=build --chown=kasku:kasku /app/.next/standalone ./
COPY --from=build --chown=kasku:kasku /app/.next/static ./.next/static
COPY --from=build --chown=kasku:kasku /app/public ./public
# Prisma CLI, skema, migrasi, dan skrip (migrate/seed/user:create) ikut di image.
COPY --from=build --chown=kasku:kasku /app/node_modules ./node_modules
COPY --from=build --chown=kasku:kasku /app/prisma ./prisma
COPY --from=build --chown=kasku:kasku /app/scripts ./scripts
COPY --from=build --chown=kasku:kasku /app/src ./src
COPY --from=build --chown=kasku:kasku /app/package.json /app/tsconfig.json ./
COPY --chown=kasku:kasku docker/entrypoint.sh /entrypoint.sh

USER kasku
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
CMD ["node", "server.js"]
