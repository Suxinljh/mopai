# 墨排 / wechat-md-studio — production image.
#
# Build:  docker build -t suxinljh/mopai:latest .   (then: docker push)
# Run:    docker compose up -d          (docker-compose.yml carries env + volume)
#
# Node 22 is the floor: the app's SQLite layer is Node's built-in `node:sqlite`
# (api/queries/connection.ts). No native module is compiled, so no build
# toolchain is needed at runtime.

# ---------- build ----------
# The frontend needs Vite, so this stage needs devDependencies and the full
# source tree. Its output is dist/boot.js (self-contained) + dist/public/.
FROM node:22-slim AS build
WORKDIR /app

# Dependency layer first so source edits do not re-run the install.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.server.json vite.config.ts ./
COPY index.html postcss.config.js tailwind.config.js components.json ./
# api/ is the Hono+tRPC server, src/ the React app, db/ + contracts/ the shared
# schema and constants. scripts/ is not needed to build.
COPY api ./api
COPY src ./src
COPY db ./db
COPY contracts ./contracts
COPY public ./public

RUN npm run build

# ---------- runtime ----------
# No node_modules: `esbuild --bundle` inlines every dependency, and the only
# remaining require() calls are Node built-ins (crypto, fs, os, path). Copying
# package.json out of the build stage is avoided on purpose — it would make
# `npm ci` un-runnable and would leave a prod install with no lockfile to be
# verified against.
FROM node:22-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3100

WORKDIR /app

# SQLite lives here (DATABASE_URL=file:./data/mopai.db resolves against WORKDIR).
# The directory must exist and be owned by `node` *before* VOLUME is declared:
# Docker seeds a fresh named volume with the image's ownership, so creating it
# afterwards would leave the volume root-owned and the app unable to write.
RUN mkdir -p /app/data && chown -R node:node /app/data

COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 3100

# node:sqlite prints an ExperimentalWarning on stderr; that is expected and not a
# health signal. / is the SPA shell, which is served without touching SQLite.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3100)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

VOLUME ["/app/data"]

CMD ["node", "dist/boot.js"]
