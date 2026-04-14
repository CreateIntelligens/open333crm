#!/bin/sh
set -e

if [ -z "$DOMAIN" ]; then
  echo "[certbot] ERROR: DOMAIN is not set. Exiting."
  exit 1
fi

if [ -z "$CERTBOT_EMAIL" ]; then
  echo "[certbot] ERROR: CERTBOT_EMAIL is not set. Exiting."
  exit 1
fi

CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"

if [ ! -f "$CERT_PATH" ]; then
  echo "[certbot] Certificate not found. Issuing new cert for $DOMAIN..."
  certbot certonly \
    --webroot \
    -w /var/www/certbot \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    -m "$CERTBOT_EMAIL"
  echo "[certbot] Certificate issued successfully."
else
  echo "[certbot] Certificate already exists at $CERT_PATH. Skipping issuance."
fi

echo "[certbot] Starting cron for scheduled renewal..."
crond -f
