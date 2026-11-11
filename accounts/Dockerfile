# Maximus accounts service: the control-plane routes as a Node process on
# Postgres. Railway builds this with the repository root as context:
#   docker build -f accounts/Dockerfile -t maximus-accounts .
FROM node:24-bookworm-slim AS build
WORKDIR /src
RUN npm install -g pnpm@10.33.0
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY accounts/package.json ./accounts/package.json
COPY apps/docs/package.json ./apps/docs/package.json
COPY cloudflare/control-plane/package.json ./cloudflare/control-plane/package.json
COPY scripts/install-git-hooks.mjs ./scripts/install-git-hooks.mjs
RUN pnpm install --frozen-lockfile
COPY accounts ./accounts
RUN pnpm --filter @maximus/accounts deploy --prod --legacy /app

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
RUN useradd --create-home --shell /bin/bash maximus && chown -R maximus:maximus /app
USER maximus
EXPOSE 8791
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'8791')+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--experimental-strip-types", "src/server.ts"]
