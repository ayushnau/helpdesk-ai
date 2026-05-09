FROM oven/bun:1.2.4-alpine AS base

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock turbo.json tsconfig.json ./

# Copy all workspace packages (needed for resolution)
COPY packages/ packages/
COPY apps/server/ apps/server/

# Install dependencies
RUN bun install --frozen-lockfile

# Expose port
ENV PORT=8080
EXPOSE 8080

# Run the server
CMD ["bun", "run", "apps/server/src/main.ts"]
