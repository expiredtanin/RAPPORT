#!/bin/sh
# Entrypoint für den pb-Service. Zwei Aufgaben:
#  1. Superuser idempotent anlegen/aktualisieren (SUPERUSER_EMAIL/PASSWORD).
#  2. Falls APP_URL gesetzt ist: die PocketBase-Einstellung meta.appURL
#     darauf setzen. Das ist die URL, die PocketBase in {APP_URL}-Platzhaltern
#     von Mail-Templates einsetzt (Passwort-Reset-Link zeigt sonst ins Leere,
#     siehe pb/pb_migrations/*_password_reset_email_template.js).
#     Läuft im Hintergrund NACH dem Start, weil PocketBase dafür schon
#     erreichbar sein muss — best-effort, blockiert den Start nicht und
#     bricht bei Fehlern (z.B. noch keine Netzwerkroute) still ab. Wer will,
#     kann appURL auch manuell im Admin-Dashboard (/_/) nachtragen.
set -e

if [ -n "$SUPERUSER_EMAIL" ] && [ -n "$SUPERUSER_PASSWORD" ]; then
  /pb/pocketbase superuser upsert "$SUPERUSER_EMAIL" "$SUPERUSER_PASSWORD"
fi

if [ -n "$APP_URL" ] && [ -n "$SUPERUSER_EMAIL" ] && [ -n "$SUPERUSER_PASSWORD" ]; then
  (
    for i in $(seq 1 30); do
      curl -sf -o /dev/null http://127.0.0.1:8090/api/health && break
      sleep 1
    done
    TOKEN=$(curl -sf -X POST http://127.0.0.1:8090/api/collections/_superusers/auth-with-password \
      -H "Content-Type: application/json" \
      -d "{\"identity\":\"$SUPERUSER_EMAIL\",\"password\":\"$SUPERUSER_PASSWORD\"}" \
      | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
    if [ -n "$TOKEN" ]; then
      curl -sf -X PATCH http://127.0.0.1:8090/api/settings \
        -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
        -d "{\"meta\":{\"appURL\":\"$APP_URL\"}}" >/dev/null \
        && echo "pb-entrypoint: meta.appURL gesetzt auf $APP_URL" \
        || echo "pb-entrypoint: konnte meta.appURL nicht setzen (PATCH fehlgeschlagen)"
    else
      echo "pb-entrypoint: konnte meta.appURL nicht setzen (Superuser-Login fehlgeschlagen)"
    fi
  ) &
fi

exec /pb/pocketbase serve --http=0.0.0.0:8090
