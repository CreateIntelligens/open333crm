## Context

Currently Open333 CRM uses Caddy as its reverse proxy and TLS termination layer. Caddy is convenient for development (automatic HTTPS, zero config) but the `Caddyfile` has a hardcoded `:80` server block with no support for domain injection via environment variables. In production and UAT environments the domain must be configurable without rebuilding or editing tracked config files.

The `nginx/` directory already exists with a `certs/` folder (gitignored). The routing rules in the `Caddyfile` define five upstream paths: `/api/*` and `/socket.io/*` → `api:3001`, `/s/*` → `api:3001`, `/webchat/*` → `web:3000`, `/*` → `web:3000`.

## Goals / Non-Goals

**Goals:**
- Replace Caddy with nginx as the reverse proxy
- Domain name driven by `DOMAIN` env var — no file edits needed per environment
- Let's Encrypt SSL auto-issued via certbot on first start
- Scheduled auto-renewal (daily cron) with nginx reload
- All existing routing rules preserved exactly
- WebSocket upgrade support for `/socket.io/*`

**Non-Goals:**
- Multi-domain or wildcard certificate support
- Replacing certbot with acme.sh or other ACME clients
- Changing upstream service ports or routing logic
- Supporting self-signed certs for local development (Caddy stays available via dev override)

## Decisions

### 1. nginx:alpine + certbot:latest as separate services
**Rationale**: Keeps concerns separated — nginx handles traffic, certbot handles cert lifecycle. Certbot container runs `certbot certonly --webroot` on start then exits; a cron schedule inside a lightweight `certbot` service (or sidecar) handles renewal. Alternative of using a single `nginx-certbot` combined image (e.g. `staticfloat/nginx-certbot`) was considered but adds an unmaintained third-party image dependency.

### 2. `envsubst` in nginx entrypoint to inject `$DOMAIN`
**Rationale**: nginx does not natively read env vars in config files. Using `envsubst` on `nginx.conf.template` at container startup is the standard, dependency-free approach. The processed config is written to `/etc/nginx/nginx.conf` before nginx starts.

### 3. Certbot webroot challenge
**Rationale**: Webroot challenge requires no DNS API credentials and works with any registrar. nginx serves `/.well-known/acme-challenge/` from a shared volume (`certbot_www`) that certbot writes to. Alternative: standalone mode would require stopping nginx, causing downtime on renewal.

### 4. Cron in certbot service for renewal
**Rationale**: A separate `certbot` service with `command: /bin/sh -c "certbot certonly ... && crond -f"` handles initial issuance + renewal in one container. nginx reload after renewal is triggered via a shared script that runs `docker exec` or via a bind-mounted reload hook. Simpler alternative: add `certbot renew` to host cron — but that requires host access not available in all deploy environments.

### 5. HTTP → HTTPS redirect on port 80
**Rationale**: Port 80 is kept open for ACME webroot challenge at `/.well-known/acme-challenge/`. All other HTTP traffic is 301-redirected to HTTPS.

## Risks / Trade-offs

- **[Risk] First-start chicken-and-egg**: nginx needs the cert to start TLS, certbot needs nginx to serve the ACME challenge. → **Mitigation**: nginx starts with HTTP-only config first (port 80 only), certbot issues cert, then nginx is reloaded with HTTPS config. Implemented via entrypoint script that checks cert existence.
- **[Risk] Cert not issued if port 80 is blocked**: Firewall rules must allow inbound 80 for ACME challenge. → **Mitigation**: Document in README; not a code concern.
- **[Risk] `DOMAIN` not set**: `envsubst` silently produces empty string. → **Mitigation**: Entrypoint script validates `DOMAIN` is non-empty and exits with error if missing.
- **[Risk] Caddy volumes left behind**: `caddy_data` and `caddy_config` volumes remain in Docker after removal. → **Mitigation**: Note in migration plan to prune volumes; no functional impact.

## Migration Plan

1. Add `DOMAIN=<your-domain>` to environment (`.env` or shell)
2. `docker compose down` — stop all services
3. `docker volume rm open333crm_caddy_data open333crm_caddy_config` (optional cleanup)
4. `docker compose up -d` — nginx starts HTTP-only, certbot issues cert, nginx reloads HTTPS
5. Verify: `curl -I https://$DOMAIN/api/health`

**Rollback**: restore `Caddyfile`, revert `docker-compose.yml`, `docker compose up -d caddy`

## Open Questions

- Should `DOMAIN` default to `localhost` for local dev (self-signed), or should Caddy be retained in a `docker-compose.override.yml` for local? → Recommend keeping Caddy as dev override for now (out of scope for this change).
