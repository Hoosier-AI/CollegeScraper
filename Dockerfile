FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY ui/package.json ui/package-lock.json ./ui/
RUN npm ci --ignore-scripts && npm --prefix ui ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY ui ./ui
RUN npx tsc -p tsconfig.json && npm --prefix ui run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/ui/dist ./ui/dist
# Curated aliases and the conference-site registry are read at runtime.
COPY data ./data
COPY package.json ./
EXPOSE 8080
CMD ["node", "dist/server.js"]
