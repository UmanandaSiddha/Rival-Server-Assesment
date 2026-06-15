# ---- builder: install everything + compile TS → dist/ ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime: minimal image with only prod deps + compiled JS ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
# Installs prod deps incl. dbmate (used for migrations on container start); drop the cache to slim the image.
RUN npm ci --omit=dev && npm cache clean --force

# Compiled app + migration files + entrypoint.
COPY --from=builder /app/dist ./dist
COPY db ./db
COPY docker-entrypoint.sh ./
# Run as the unprivileged `node` user. Pre-create the uploads dir owned by node so the named volume
# inherits writable ownership (a fresh volume copies the mount point's perms from the image).
RUN chmod +x docker-entrypoint.sh \
    && mkdir -p /app/uploads \
    && chown -R node:node /app
USER node

# Informational only — the actual listen port is read from the PORT env var.
EXPOSE 4000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
