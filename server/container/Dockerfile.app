# Multi-Stage Build für das Rapport-Frontend.
# Baut die App aus diesem Repo (Build-Kontext ist die Repo-Wurzel, siehe
# docker-compose.yml) mit Node und packt das fertige dist/ in einen schlanken
# nginx-Container.
#
# Steuerung über Build-Args:
#   (ohne)                                   Standard: die App spricht PocketBase unter ihrer EIGENEN Adresse an
#                                            (/api/ leitet nginx.conf an den pb-Container weiter). So läuft das
#                                            fertige Image aus der Registry ohne Neubau, egal unter welcher Adresse.
#   --build-arg POCKETBASE_URL=https://...   nur für eine eigene API-Adresse (z.B. https://api.buero.ch); kommt in den
#                                            Build und in die CSP.

FROM node:22-alpine AS builder
ARG POCKETBASE_URL=

WORKDIR /build/app
# Erst nur die Abhängigkeiten — dieser Layer bleibt im Cache, solange sich package*.json nicht ändern
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

# .env.production wird zur Build-Zeit ausgewertet → Werte landen im Bundle. Immer Server-Modus (fest auf diesen Server,
# keine Wahl «Lokal»); leere URL = dieselbe Herkunft wie die Seite (src/storage/adapter.ts).
RUN printf "VITE_POCKETBASE_URL=%s\nVITE_SERVER_MODE=1\n" "$POCKETBASE_URL" > .env.production

RUN npm run build

# ──────────────────────────────────────────────────────────
FROM nginx:alpine
COPY --from=builder /build/app/dist /usr/share/nginx/html
COPY server/container/rapport-admin-theme.css /usr/share/nginx/html/rapport-admin-theme.css
COPY server/container/nginx.conf /etc/nginx/conf.d/default.conf
# CSP in nginx.conf: Herkunft der PocketBase-URL einsetzen (z.B. https://api.buero.ch), leer = nur eigene Adresse
ARG POCKETBASE_URL=
RUN ORIGIN="$(printf '%s' "$POCKETBASE_URL" | sed -E 's#^(https?://[^/]+).*#\1#; t; s#.*##')" \
 && sed -i "s#__API_ORIGIN__#${ORIGIN}#g" /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q --spider http://127.0.0.1/ || exit 1
