FROM node:24-alpine AS frontend
WORKDIR /frontend
COPY transgest-bloque6-backend/transgest-frontend/package*.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY transgest-bloque6-backend/transgest-frontend/ ./
# The frontend prebuild reads the shared release catalog from its sibling.
COPY transgest-bloque6-backend/transgest-backend/src/data/productReleases.json /transgest-backend/src/data/productReleases.json
ENV CI=false DISABLE_ESLINT_PLUGIN=true GENERATE_SOURCEMAP=false
ENV REACT_APP_LOCAL_SERVER=true REACT_APP_ENVIRONMENT=staging
RUN npm run build

FROM node:24-alpine
RUN apk add --no-cache postgresql-client
WORKDIR /app
COPY transgest-bloque6-backend/transgest-backend/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY transgest-bloque6-backend/transgest-backend/src ./src
COPY transgest-bloque6-backend/transgest-backend/scripts ./scripts
COPY transgest-bloque6-backend/transgest-backend/assets ./assets
COPY --from=frontend /frontend/build ./staging-web
RUN mkdir -p /app/backups /app/logs
EXPOSE 10000
CMD ["node", "scripts/staging_start.cjs"]
