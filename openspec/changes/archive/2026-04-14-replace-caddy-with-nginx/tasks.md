## 1. Remove Caddy

- [x] 1.1 Delete `Caddyfile` from repository root
- [x] 1.2 Remove `caddy` service, `caddy_data`, and `caddy_config` volumes from `docker-compose.yml`

## 2. nginx Config Template

- [x] 2.1 Create `nginx/nginx.conf.template` with `${DOMAIN}` placeholder — include HTTP→HTTPS redirect block, ACME challenge location, HTTPS server block with all 5 proxy_pass rules from Caddyfile, and WebSocket upgrade headers for `/socket.io/`
- [x] 2.2 Create `nginx/entrypoint.sh` — validate `$DOMAIN` is non-empty, run `envsubst` to generate `/etc/nginx/nginx.conf` from template, then `exec nginx -g 'daemon off;'`

## 3. Certbot Service

- [x] 3.1 Create `nginx/certbot-entrypoint.sh` — on first start issue cert with `certbot certonly --webroot -w /var/www/certbot -d $DOMAIN --non-interactive --agree-tos -m $CERTBOT_EMAIL`; if cert exists skip issuance; then start `crond -f` for renewal schedule
- [x] 3.2 Create `nginx/certbot-cron` — daily cron job running `certbot renew --webroot -w /var/www/certbot --quiet && nginx -s reload` (via `docker exec` or shared script)

## 4. docker-compose Update

- [x] 4.1 Add `nginx` service to `docker-compose.yml`: image `nginx:alpine`, ports 80/443, volumes for `nginx.conf.template`, `certbot_certs`, `certbot_www`, entrypoint pointing to `nginx/entrypoint.sh`
- [x] 4.2 Add `certbot` service to `docker-compose.yml`: image `certbot/certbot`, env vars `DOMAIN` and `CERTBOT_EMAIL`, volumes for `certbot_certs` and `certbot_www`, entrypoint pointing to `nginx/certbot-entrypoint.sh`
- [x] 4.3 Add named volumes `certbot_certs` and `certbot_www` to the volumes block
- [x] 4.4 Set `DOMAIN` and `CERTBOT_EMAIL` in the `nginx` and `certbot` service `environment:` blocks in `docker-compose.yml` as placeholder values (e.g. `DOMAIN: "your-domain.com"`) — operator fills in before running; no changes to `.env.api` or `.env.web`

## 5. Documentation & Cleanup

- [x] 5.1 Update `README.md` (or `docs/`) with nginx/certbot setup instructions: required env vars, firewall requirement (port 80 open for ACME), and rollback steps
- [x] 5.2 Verify `.gitignore` still excludes `nginx/certs/` (certs now live in Docker volumes, not local folder — confirm this path is still correct or update accordingly)
