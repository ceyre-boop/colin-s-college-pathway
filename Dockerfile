# Bun web service for Render: build the Vite SPA, then serve it + the /api/essay endpoint.
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1
WORKDIR /app
# Only what the server needs at runtime.
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/package.json ./package.json
# Render injects PORT; server.ts reads process.env.PORT (falls back to 3000).
CMD ["bun", "run", "server.ts"]
