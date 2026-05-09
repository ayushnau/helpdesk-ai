FROM node:20-alpine AS base

# Install bun for workspace resolution during build
RUN corepack enable && npm install -g bun

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock turbo.json tsconfig.json ./

# Copy all workspace packages and the web app
COPY packages/ packages/
COPY apps/web/ apps/web/

# Install dependencies
RUN bun install --frozen-lockfile

# Build Next.js
WORKDIR /app/apps/web
RUN npx next build

# Production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

# Copy standalone output
COPY --from=base /app/apps/web/.next/standalone ./
COPY --from=base /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=base /app/apps/web/public ./apps/web/public 2>/dev/null || true

EXPOSE 8080

CMD ["node", "apps/web/server.js"]
