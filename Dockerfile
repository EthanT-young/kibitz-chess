# Kibitz: build the static site with Node, then serve it with Caddy.
# Both base images are multi-arch (amd64 + arm64) and pinned by digest.

# 1. Build.
FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Dependency install scripts are skipped; our own engine copy step runs explicitly.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN node scripts/copy-engine.mjs && npm run build && node scripts/precompress.mjs

# 2. Take the Caddy binary from the official image. Copying it drops the
# cap_net_bind_service file capability, which a container with every
# capability dropped refuses to exec (port 8080 doesn't need it).
FROM caddy:2.11.4@sha256:844f60b64e4724a5aa8245e019dace0d3f199f7433ce6c57676cb30a920dbad9 AS caddy
RUN cp /usr/bin/caddy /caddy

# 3. Serve. The image holds only the static Caddy binary, the MIME table, its
# config and the site: no shell or other tools. See deploy/Caddyfile.
FROM scratch
COPY --from=caddy /caddy /caddy
COPY --from=caddy /etc/mime.types /etc/mime.types
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist/ /srv/
# The root filesystem is read-only at runtime; Caddy's data/config dirs go to tmpfs.
ENV XDG_DATA_HOME=/tmp/data XDG_CONFIG_HOME=/tmp/config
USER 65534:65534
EXPOSE 8080
ENTRYPOINT ["/caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
