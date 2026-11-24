#!/bin/sh
# Entrypoint für den pb-Service. Aufgaben:
#  1. Superuser idempotent anlegen/aktualisieren (SUPERUSER_EMAIL/PASSWORD).
#  2. Einstellungen nach dem Start setzen (best-effort, im Hintergrund, weil
#     PocketBase dafür schon erreichbar sein muss; blockiert den Start nicht und
#     bricht bei Fehlern still ab — alles lässt sich auch im Admin-Dashboard /_/ setzen):
#     - APP_URL → meta.appURL: URL, die PocketBase in {APP_URL}-Platzhaltern von
#       Mail-Templates einsetzt (Passwort-Reset-Link zeigt sonst ins Leere, siehe
#       pb/pb_migrations/*_password_reset_email_template.js).
#     - TRUSTED_PROXY_HEADER (z.B. X-Forwarded-For) → trustedProxy.headers: läuft
#       PocketBase hinter einem Reverse-Proxy (nginx im app-Container, Caddy …), sieht
#       es sonst nur dessen IP — die Rate-Limits (Login 2 pro 3 s, Batch 3 pro s …)
#       gelten dann für ALLE Nutzer gemeinsam. Nur setzen, wenn Port 8090 nicht direkt
#       aus dem Netz erreichbar ist (sonst kann ein Client den Header fälschen).
set -e

# Wert für JSON-Strings escapen (Backslash, Anführungszeichen) — Passwörter mit " oder \
# brachen vorher den Superuser-Login und damit das Setzen der Einstellungen.
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# Kein Start mit dem Platzhalter aus .env.example oder einem kurzen Passwort: der Superuser hat Vollzugriff auf
# alle Büros, und das Admin-Dashboard /_/ ist über nginx erreichbar (Audit 24.11.2026).
if [ -n "$SUPERUSER_PASSWORD" ]; then
  case "$SUPERUSER_PASSWORD" in
    *CHANGE-ME*|*change-me*) echo "pb-entrypoint: SUPERUSER_PASSWORD ist noch der Platzhalter aus .env.example — bitte ein eigenes Passwort setzen." >&2; exit 1 ;;
  esac
  if [ "${#SUPERUSER_PASSWORD}" -lt 12 ]; then
    echo "pb-entrypoint: SUPERUSER_PASSWORD ist zu kurz (mindestens 12 Zeichen)." >&2; exit 1
  fi
fi

if [ -n "$SUPERUSER_EMAIL" ] && [ -n "$SUPERUSER_PASSWORD" ]; then
  /pb/pocketbase superuser upsert "$SUPERUSER_EMAIL" "$SUPERUSER_PASSWORD"
fi

SETTINGS=""
if [ -n "$APP_URL" ]; then
  SETTINGS="\"meta\":{\"appURL\":\"$(json_escape "$APP_URL")\"}"
fi
if [ -n "$TRUSTED_PROXY_HEADER" ]; then
  [ -n "$SETTINGS" ] && SETTINGS="$SETTINGS,"
  SETTINGS="$SETTINGS\"trustedProxy\":{\"headers\":[\"$(json_escape "$TRUSTED_PROXY_HEADER")\"],\"useLeftmostIP\":false}"
fi

if [ -n "$SETTINGS" ] && [ -n "$SUPERUSER_EMAIL" ] && [ -n "$SUPERUSER_PASSWORD" ]; then
  (
    for i in $(seq 1 30); do
      curl -sf -o /dev/null http://127.0.0.1:8090/api/health && break
      sleep 1
    done
    TOKEN=$(curl -sf -X POST http://127.0.0.1:8090/api/collections/_superusers/auth-with-password \
      -H "Content-Type: application/json" \
      -d "{\"identity\":\"$(json_escape "$SUPERUSER_EMAIL")\",\"password\":\"$(json_escape "$SUPERUSER_PASSWORD")\"}" \
      | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
    if [ -n "$TOKEN" ]; then
      curl -sf -X PATCH http://127.0.0.1:8090/api/settings \
        -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
        -d "{$SETTINGS}" >/dev/null \
        && echo "pb-entrypoint: Einstellungen gesetzt (${APP_URL:+appURL=$APP_URL }${TRUSTED_PROXY_HEADER:+trustedProxy=$TRUSTED_PROXY_HEADER})" \
        || echo "pb-entrypoint: konnte Einstellungen nicht setzen (PATCH fehlgeschlagen)"
    else
      echo "pb-entrypoint: konnte Einstellungen nicht setzen (Superuser-Login fehlgeschlagen)"
    fi
  ) &
fi

# Einrichtungscode für die Ersteinrichtung (Konto + erstes Büro, siehe pb/pb_hooks/signup.pb.js): einmal zufällig
# erzeugt und im Datenvolume abgelegt; ohne Code kann niemand den frisch gestarteten Server übernehmen.
if [ -z "$RAPPORT_SETUP_TOKEN" ]; then
  TOKEN_FILE=/pb/pb_data/.setup-token
  if [ ! -s "$TOKEN_FILE" ]; then
    (umask 077; head -c 15 /dev/urandom | base64 | tr -d '/+=' | cut -c1-16 > "$TOKEN_FILE")
    # nur beim Erzeugen ins Log (Logs landen in Diagnosen/Support-Dateien); später steht er in der Datei
    echo "pb-entrypoint: Einrichtungscode (nur für die Ersteinrichtung in der App nötig): $(cat "$TOKEN_FILE")"
  else
    echo "pb-entrypoint: Einrichtungscode für die Ersteinrichtung: docker compose exec pb cat $TOKEN_FILE"
  fi
  RAPPORT_SETUP_TOKEN="$(cat "$TOKEN_FILE")"
  export RAPPORT_SETUP_TOKEN
fi

exec /pb/pocketbase serve --http=0.0.0.0:8090
