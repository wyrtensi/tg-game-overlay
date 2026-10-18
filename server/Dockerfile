FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8790 \
    DATA_DIR=/data \
    NODE_OPTIONS=--max-old-space-size=96

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

# Create the data directory owned by the unprivileged user before declaring the
# volume, so a fresh named volume inherits that ownership.
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 8790
VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "src/index.js"]
