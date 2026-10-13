# Both images use Debian Trixie: PostgreSQL's complete client dependency set
# stays in the runtime, and Node/native npm modules use the same libc family.
FROM node:22.23.3-trixie-slim AS node-runtime

FROM node-runtime AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/breadloaf_build_test
ENV AUTH_SECRET=disposable-image-build-only FAMILY_PINS=Build:2468
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

FROM postgres:18.6-trixie AS runtime
# The app uses this image's pg_dump/pg_restore; it never starts a PostgreSQL
# server. Keep existing Railway startup migration/seed semantics via npm start.
ENTRYPOINT []
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=node-runtime /usr/local/ /usr/local/
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=UTC PORT=3000
ENV PG_DUMP_PATH=/usr/lib/postgresql/18/bin/pg_dump PG_RESTORE_PATH=/usr/lib/postgresql/18/bin/pg_restore
RUN node --version && "$PG_DUMP_PATH" --version && "$PG_RESTORE_PATH" --version && node -e "require('@prisma/client'); require('@napi-rs/canvas')"
EXPOSE 3000
CMD ["npm", "start"]
