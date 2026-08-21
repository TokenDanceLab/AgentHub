# AgentHub Web — Dockerfile
# Multistage build: pnpm workspace → Vite SPA → nginx
# Build context: app/
# tsc typecheck is handled by CI (cd-pr-check.yml); Docker build
# runs only vite build for production optimised output.

FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json ./shared/package.json
COPY workbench/package.json ./workbench/package.json
COPY web/package.json ./web/package.json
RUN pnpm install --frozen-lockfile

# Copy source and build (vite only — tsc runs in CI)
COPY shared ./shared
COPY workbench ./workbench
COPY web ./web
RUN pnpm --filter agenthub-web exec vite build

FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/web/dist /usr/share/nginx/html
# Vite base=/workbench/ prefix stripping + SPA fallback (see web/nginx.conf)
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
