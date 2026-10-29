# Rapport-Web-App Deploy

> Wer kein Tauri installieren will, kann Rapport im Browser nutzen. Diese
> Anleitung beschreibt, wie du die Web-Version auf dem Mac Mini hostest.

**Für den vollständigen Self-Host-Stack (Frontend + PocketBase-Backend als
Docker-Compose) siehe stattdessen [server/container/](server/container/)**
— das ist der empfohlene Weg für einen produktiven Server. Diese Anleitung hier
beschreibt den schlankeren Pfad: nur das Frontend statisch hosten, während ein
PocketBase-Backend (lokal per `./pocketbase serve` oder ebenfalls containerisiert)
separat läuft.

---

## Option 2 — Im LAN erreichbar (ohne SSL)

Ziel: jedes Gerät im Studio-Netz kann `http://<mac-mini.local>:8080` öffnen.

### Voraussetzungen

- Mac Mini hat OrbStack/Docker und PocketBase eingerichtet (siehe [pb/README.md](pb/README.md)).
- PocketBase läuft (`./pocketbase serve`, Standard-Port 8090).
- Der Mac Mini ist im LAN erreichbar (`mac-mini.local` per Bonjour oder feste IP).

### Schritt-für-Schritt

1. **Repo auf den Mac Mini kopieren** (falls noch nicht da).

2. **`.env.production` anlegen** (im Repo-Root):

   ```bash
   cp .env.production.example .env.production
   ```

   Dann `VITE_POCKETBASE_URL` auf die LAN-Adresse stellen, z.B.
   `http://mac-mini.local:8090`.

3. **Build:**

   ```bash
   npm install
   npm run build
   ```

   Erzeugt `dist/` mit statischen Files (~500 kB).

4. **Static-Container starten:**

   ```bash
   docker compose -f deploy/docker-compose.yml up -d
   ```

   Liefert `dist/` auf Port `8080` aus.

5. **Test:** anderes Gerät im LAN öffnet `http://<mac-mini.local>:8080`
   im Browser. Login-Screen erscheint, Cloud-Modus ist bereits korrekt
   konfiguriert (Server-URL ist gebakene `.env.production`).

### Update auf neue Version

```bash
git pull
npm run build
docker compose -f deploy/docker-compose.yml restart
```

---

## Option 3 — Auch extern erreichbar (mit SSL)

Zusätzlich zu Option 2: Nginx Proxy Manager (NPM) auf dem Mac Mini macht
Domain-Routing und holt Let's-Encrypt-Zertifikate.

### Voraussetzungen

- NPM läuft bereits auf dem Mac Mini (typisch Port 81 für UI, 80/443 für
  Traffic).
- DNS-Records `app.rapport.kgva.ch` und `api.rapport.kgva.ch` zeigen auf den
  Mac Mini (z.B. via Tailscale Funnel, DDNS oder feste IP).

### Schritt-für-Schritt

1. **In NPM-UI zwei Proxy-Hosts anlegen:**

   | Domain | Forward zu | SSL |
   |---|---|---|
   | `app.rapport.kgva.ch` | `mac-mini-ip:8080` | Force HTTPS + Let's Encrypt |
   | `api.rapport.kgva.ch` | `mac-mini-ip:8090` | Force HTTPS + Let's Encrypt |

   Beide mit «Block Common Exploits» und «Cache Assets» an. Für `api.*`
   zusätzlich Websocket-Support an (PocketBase-Realtime braucht WS).

2. **`.env.production` umstellen auf die externe URL:**

   ```env
   VITE_POCKETBASE_URL=https://api.rapport.kgva.ch
   ```

3. **Rebuild + restart:**

   ```bash
   npm run build
   docker compose -f deploy/docker-compose.yml restart
   ```

4. **Test:** von außen (Smartphone mit Mobile-Data) `https://app.rapport.kgva.ch`
   öffnen → Login funktioniert.

---

## Troubleshooting

**Other devices see "Login" without auto-filled Server-URL?**
→ `.env.production` enthält nicht den richtigen `VITE_POCKETBASE_URL`, oder das
Build wurde vor der Änderung gemacht. `npm run build` neu ausführen.

**Realtime funktioniert nicht von extern?**
→ NPM braucht «Websocket Support» an im Proxy-Host für `api.*`.

**Auth-Mails kommen nicht an?**
→ PocketBase braucht einen echten SMTP-Server, siehe PocketBase-Admin-UI
(`/_/#/settings/mail`) — ohne Konfiguration werden Mails nicht verschickt.

**Mac Mini wird neugestartet, Rapport-App weg?**
→ `restart: unless-stopped` im docker-compose sorgt für Auto-Start. Für
PocketBase (falls nicht containerisiert): als LaunchAgent registrieren, damit
`./pocketbase serve` beim Boot läuft — oder gleich die Server-App ([server/app/](server/app/))
nutzen, das das übernimmt.
