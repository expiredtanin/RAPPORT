# PocketBase-Backend für den Rapport-Server-Stack.
# Schema, Regeln und Hooks kommen aus pb/ in diesem Repo (Build-Kontext ist die
# Repo-Wurzel, siehe docker-compose.yml), dazu das passende PocketBase-Binary.
# Kein Build-Schritt nötig (kein npm/go) — PocketBase ist ein einzelnes Binary,
# Hooks/Migrations sind reines JS.
#
# Steuerung über Build-Args:
#   --build-arg POCKETBASE_VERSION=0.39.11   PocketBase-Release-Version
#   --build-arg POCKETBASE_SHA256_AMD64=… / POCKETBASE_SHA256_ARM64=…
#       SHA-256 der Release-Zips aus checksums.txt des Releases. Beim Wechsel der Version beide
#       mitändern — der Build bricht ab, wenn die Prüfsumme nicht passt (Schutz vor manipulierten
#       oder beschädigten Downloads).

FROM alpine:3.20
ARG POCKETBASE_VERSION=0.39.11
ARG POCKETBASE_SHA256_AMD64=08b9fcda0d5fd42cb315dc15a36dfa121c993855bd635f01d347c31b4328ec34
ARG POCKETBASE_SHA256_ARM64=8c785618840df7ebba795fdf4eba33a5fed64ac5307ad8023b955b4ebb82048b
ARG TARGETARCH

RUN apk add --no-cache curl unzip ca-certificates

WORKDIR /pb
COPY pb/pb_hooks ./pb_hooks
COPY pb/pb_migrations ./pb_migrations

# TARGETARCH ist "amd64" oder "arm64" — passt zu den PocketBase-Release-Namen.
RUN case "${TARGETARCH}" in \
      amd64) SHA="${POCKETBASE_SHA256_AMD64}" ;; \
      arm64) SHA="${POCKETBASE_SHA256_ARM64}" ;; \
      *) echo "Keine Prüfsumme für Architektur ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_${TARGETARCH}.zip" \
    && echo "${SHA}  pb.zip" | sha256sum -c - \
    && unzip pb.zip pocketbase -d . \
    && rm pb.zip \
    && chmod +x pocketbase

COPY server/container/pb-entrypoint.sh /pb/entrypoint.sh
RUN chmod +x /pb/entrypoint.sh

EXPOSE 8090
VOLUME /pb/pb_data
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s CMD wget -q --spider http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["/pb/entrypoint.sh"]
