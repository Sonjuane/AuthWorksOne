# Connector Hub production image (NF-04). Build context: repo root.
# Secrets come from the runtime environment only; none are baked in.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY config ./config
COPY apps/lib ./apps/lib
COPY apps/hub ./apps/hub
USER node
EXPOSE 3030
CMD ["node", "apps/hub/server.js"]
