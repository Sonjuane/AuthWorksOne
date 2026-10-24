# Connector Hub production image (NF-04). Build context: repo root.
# Stage 1 builds the Vue UI (dev dependencies); stage 2 ships runtime dependencies + built assets.
# Secrets come from the runtime environment only; none are baked in.
FROM node:24-alpine AS ui
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY apps/hub/vite.config.js ./apps/hub/vite.config.js
COPY apps/hub/ui ./apps/hub/ui
RUN npm run hub:ui:build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY config ./config
COPY apps/lib ./apps/lib
COPY apps/hub ./apps/hub
COPY --from=ui /app/apps/hub/ui/dist ./apps/hub/ui/dist
USER node
EXPOSE 3030
CMD ["node", "apps/hub/server.js"]
