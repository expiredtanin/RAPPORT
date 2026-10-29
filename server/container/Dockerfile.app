# Multi-Stage Build für das Rapport-Frontend.
# Baut die App aus diesem Repo (Build-Kontext ist die Repo-Wurzel, siehe
# docker-compose.yml) mit Node und packt das fertige dist/ in einen schlanken
# nginx-Container.
#
# Steuerung über Build-Args:
#   --build-arg POCKETBASE_URL=https://...   Public-URL der PocketBase-Instanz (kommt in den Build)

FROM node:22-alpine AS builder
ARG POCKETBASE_URL

WORKDIR /build/app
# Erst nur die Abhängigkeiten — dieser Layer bleibt im Cache, solange sich package*.json nicht ändern
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

# .env.production wird zur Build-Zeit ausgewertet → Werte landen im Bundle
RUN if [ -n "$POCKETBASE_URL" ]; then \
      printf "VITE_POCKETBASE_URL=%s\nVITE_SERVER_MODE=1\n" "$POCKETBASE_URL" > .env.production; \
    fi

RUN npm run build

# ──────────────────────────────────────────────────────────
FROM nginx:alpine
COPY --from=builder /build/app/dist /usr/share/nginx/html
COPY server/container/rapport-admin-theme.css /usr/share/nginx/html/rapport-admin-theme.css
COPY server/container/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q --spider http://127.0.0.1/ || exit 1
