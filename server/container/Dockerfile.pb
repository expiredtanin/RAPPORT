# PocketBase-Backend für den Rapport-Server-Stack.
# Schema, Regeln und Hooks kommen aus pb/ in diesem Repo (Build-Kontext ist die
# Repo-Wurzel, siehe docker-compose.yml), dazu das passende PocketBase-Binary.
# Kein Build-Schritt nötig (kein npm/go) — PocketBase ist ein einzelnes Binary,
# Hooks/Migrations sind reines JS.
#
# Steuerung über Build-Args:
#   --build-arg POCKETBASE_VERSION=0.39.11   PocketBase-Release-Version

FROM alpine:3.20
ARG POCKETBASE_VERSION=0.39.11
ARG TARGETARCH

RUN apk add --no-cache curl unzip ca-certificates

WORKDIR /pb
COPY pb/pb_hooks ./pb_hooks
COPY pb/pb_migrations ./pb_migrations

# TARGETARCH ist "amd64" oder "arm64" — passt zu den PocketBase-Release-Namen.
RUN curl -sL -o pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_${TARGETARCH}.zip" \
    && unzip pb.zip pocketbase -d . \
    && rm pb.zip \
    && chmod +x pocketbase

COPY server/container/pb-entrypoint.sh /pb/entrypoint.sh
RUN chmod +x /pb/entrypoint.sh

EXPOSE 8090
VOLUME /pb/pb_data
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s CMD wget -q --spider http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["/pb/entrypoint.sh"]
