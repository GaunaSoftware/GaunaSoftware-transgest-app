FROM node:20-alpine

# Install pg_dump for backups (use postgresql-client, available in Alpine)
RUN apk add --no-cache postgresql-client

WORKDIR /app

# Copy package file and install dependencies
COPY package.json ./
RUN npm install --only=production --no-audit --no-fund

# Copy source code
COPY src/ ./src/
COPY scripts/ ./scripts/

# Create required directories
RUN mkdir -p /app/backups /app/logs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "src/server.js"]
