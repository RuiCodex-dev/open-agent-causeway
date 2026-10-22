# Causeway: API on :8000 and the web UI on :8080 from one image.
# CPU only, no GPU, no downloads at runtime: dependencies install at build time, and the Zetaris snapshot
# (data/snapshot, read through Zetaris) ships in the image so SAMPLE_MODE works with no credentials at all.
FROM node:22-bookworm-slim AS ui
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ui/ ./
RUN npm run build

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8000 UI_PORT=8080

RUN groupadd --system causeway \
  && useradd --system --gid causeway --home-dir /app --shell /usr/sbin/nologin causeway

COPY --from=deps --chown=causeway:causeway /app/node_modules ./node_modules
COPY --chown=causeway:causeway package.json package-lock.json tsconfig.json ./
COPY --chown=causeway:causeway src ./src
COPY --chown=causeway:causeway vendor ./vendor
COPY --chown=causeway:causeway data/snapshot ./data/snapshot
COPY --chown=causeway:causeway input_examples ./input_examples
COPY --from=ui --chown=causeway:causeway /ui/dist ./ui/dist
RUN mkdir -p /app/logs /app/data/memory && chown -R causeway:causeway /app/logs /app/data/memory

USER causeway
EXPOSE 8000 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/api/server.ts"]
