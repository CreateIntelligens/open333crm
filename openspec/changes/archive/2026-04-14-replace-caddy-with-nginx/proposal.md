## Why

Caddy provides automatic HTTPS out of the box but its domain config is hardcoded in `Caddyfile` — not injectable via environment variables. Replacing Caddy with nginx + certbot gives full env-driven domain config, scheduled SSL auto-renewal via cron, and a standard reverse-proxy setup that mirrors the existing routing rules.

## What Changes

- **Remove** `caddy` service, `Caddyfile`, `caddy_data` and `caddy_config` volumes from docker-compose
- **Add** `nginx` service as the new reverse proxy (ports 80/443)
- **Add** `certbot` service for Let's Encrypt SSL issuance and renewal
- **Add** `nginx/nginx.conf.template` — domain injected via `${DOMAIN}` env var at container startup
- **Add** `nginx/cron` — daily certbot renew + nginx reload schedule
- Domain configured via `DOMAIN` env var (`.env` or compose `environment:`)
- Routing rules preserved from `Caddyfile`: `/api/*`, `/socket.io/*`, `/s/*`, `/webchat/*`, `/*` → `web:3000`
- WebSocket upgrade headers retained for `/socket.io/*`
- HTTP → HTTPS redirect on port 80

## Capabilities

### New Capabilities
- `nginx-reverse-proxy`: nginx as the sole reverse proxy with env-driven domain, SSL termination via Let's Encrypt, and scheduled auto-renewal via certbot cron

### Modified Capabilities
<!-- No existing specs change requirements -->

## Impact

- `docker-compose.yml` — remove caddy service/volumes, add nginx + certbot services
- `Caddyfile` — deleted
- `nginx/` directory — new config template, entrypoint script, cron schedule
- `docker-compose.yml` nginx service `environment:` block — `DOMAIN` set directly by operator (no changes to `.env.api` or `.env.web`)
- `nginx/certs/` already in `.gitignore` — certbot writes here at runtime
