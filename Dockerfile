# Hugging Face Space (Docker SDK).
#
# The Space serves on 7860 and runs the container as uid 1000 -- both are HF
# requirements, not preferences; on any other container host, change PORT.
#
# /app/storage is the working copy of generated avatars. It is wiped on every
# restart, and lib/store/remote.ts is what makes that survivable by mirroring it
# to a Supabase Storage bucket.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Dev deps are needed to build (typescript, tailwind); the runner stage takes
# only .next/standalone, so none of them reach the final image.
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=7860 \
    HOSTNAME=0.0.0.0 \
    STORAGE_DIR=/app/storage \
    ASSETS_DIR=/app/assets

# node:22-slim already ships a `node` user at uid 1000, which is the uid HF runs.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

RUN mkdir -p /app/storage /app/assets && chown -R node:node /app/storage /app/assets
USER node

EXPOSE 7860
CMD ["node", "server.js"]
