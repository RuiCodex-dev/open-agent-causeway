# Causeway API (TypeScript run directly with tsx; the vendored Meterless engines import .ts files).
# CPU only, no GPU, no downloads at runtime: dependencies install at build time and the Zetaris snapshot ships in data/.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8000

RUN groupadd --system causeway \
  && useradd --system --gid causeway --home-dir /app --shell /usr/sbin/nologin causeway

COPY --from=deps --chown=causeway:causeway /app/node_modules ./node_modules
COPY --chown=causeway:causeway package.json package-lock.json tsconfig.json ./
COPY --chown=causeway:causeway src ./src
COPY --chown=causeway:causeway vendor ./vendor
COPY --chown=causeway:causeway data ./data
RUN mkdir -p /app/logs && chown causeway:causeway /app/logs

USER causeway
EXPOSE 8000
CMD ["npx", "tsx", "src/api/server.ts"]
