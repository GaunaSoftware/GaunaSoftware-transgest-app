FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --only=production --no-audit --no-fund

COPY src/ ./src/
COPY scripts/ ./scripts/

EXPOSE 3011

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:3011/health || exit 1

CMD ["node", "src/server.js"]
