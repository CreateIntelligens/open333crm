#!/bin/sh
set -e

if [ -z "$DOMAIN" ]; then
  echo "[nginx] ERROR: DOMAIN environment variable is not set. Exiting."
  exit 1
fi

echo "[nginx] Generating config for domain: $DOMAIN"
envsubst '${DOMAIN}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Daily reload at 04:00 to pick up renewed Let's Encrypt certs
echo "0 4 * * * nginx -s reload" > /etc/crontabs/root
crond

echo "[nginx] Starting nginx..."
exec nginx -g 'daemon off;'
