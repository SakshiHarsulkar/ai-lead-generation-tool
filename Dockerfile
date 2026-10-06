# One container serves the API and the built React app (same origin, no CORS).
FROM node:22-slim

WORKDIR /app

# Install with the lockfile first so Docker caches dependencies between deploys.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "server/src/index.js"]
