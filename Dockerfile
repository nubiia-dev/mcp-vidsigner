# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
# --ignore-scripts: husky does not apply inside the image
RUN npm ci --ignore-scripts && npm run build && npm prune --omit=dev --ignore-scripts

# Stage 2: runtime (stdio transport; run with `docker run -i`)
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
USER node
CMD ["node", "dist/index.js"]
