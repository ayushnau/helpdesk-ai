FROM oven/bun:1.2.4-alpine AS base

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock turbo.json tsconfig.json ./

# Copy all workspace packages (needed for resolution)
COPY packages/ packages/
COPY apps/server/ apps/server/

# Install dependencies (--no-frozen-lockfile for CI flexibility)
RUN bun install

# Expose port
ENV PORT=8080
EXPOSE 8080

# Default to gemini provider in production
ENV LLM_PROVIDER=gemini

# Run the server
CMD ["bun", "run", "apps/server/src/main.ts"]
