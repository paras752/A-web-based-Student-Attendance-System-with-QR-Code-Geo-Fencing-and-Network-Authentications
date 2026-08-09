# Single-service image: the API also serves the built SPA, so the whole system deploys as one
# container on one HTTPS origin. Same-origin also means the refresh cookie needs no cross-site
# handling, which browsers increasingly restrict.
#
# Debian slim rather than Alpine: bcrypt is a native module and ships prebuilt binaries for
# glibc. On musl it would have to compile from source, pulling python3/make/g++ into the image.

# ---------- stage 1: build the client ----------
FROM node:22-bookworm-slim AS client-build
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# ---------- stage 2: runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production

# mysqldump, for the NFR10 automated backups. Without it the backup service logs a failure and
# the app carries on, so this is what makes the requirement actually work in the container.
RUN apt-get update \
 && apt-get install -y --no-install-recommends default-mysql-client tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/ ./
COPY --from=client-build /app/client/dist /app/client/dist

# Drop privileges. The node image already provides an unprivileged `node` user.
RUN mkdir -p /app/server/backups && chown -R node:node /app
USER node

EXPOSE 5000

# tini as PID 1 so signals reach node and the container stops cleanly rather than being killed.
ENTRYPOINT ["/usr/bin/tini", "--"]

# Migrations run inside server.js before the port opens, so a deploy can never serve traffic
# against a schema the code does not expect.
CMD ["node", "src/server.js"]
