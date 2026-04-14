## ADDED Requirements

### Requirement: Domain is injected via environment variable
The system SHALL read the `DOMAIN` environment variable to configure the nginx server_name and certbot domain. The entrypoint script MUST validate that `DOMAIN` is non-empty and exit with a non-zero code if it is missing.

#### Scenario: DOMAIN is set
- **WHEN** the nginx container starts with `DOMAIN=example.com`
- **THEN** nginx serves requests for `example.com` on ports 80 and 443

#### Scenario: DOMAIN is missing
- **WHEN** the nginx container starts without `DOMAIN` set
- **THEN** the entrypoint script exits with an error message before nginx starts

### Requirement: HTTP traffic is redirected to HTTPS
The system SHALL redirect all HTTP requests (port 80) to HTTPS, except for the ACME challenge path `/.well-known/acme-challenge/`.

#### Scenario: HTTP request to root
- **WHEN** a client sends `GET http://$DOMAIN/`
- **THEN** nginx responds with HTTP 301 to `https://$DOMAIN/`

#### Scenario: ACME challenge request on port 80
- **WHEN** certbot requests `GET http://$DOMAIN/.well-known/acme-challenge/<token>`
- **THEN** nginx serves the file from the shared certbot webroot volume (no redirect)

### Requirement: Reverse proxy routing matches Caddyfile rules
The system SHALL proxy upstream requests using the same path rules as the previous Caddyfile configuration.

#### Scenario: API path proxied to api service
- **WHEN** a client requests `https://$DOMAIN/api/<path>`
- **THEN** nginx proxies the request to `http://api:3001`

#### Scenario: Socket.IO path proxied with WebSocket upgrade
- **WHEN** a client opens a WebSocket connection to `https://$DOMAIN/socket.io/<path>`
- **THEN** nginx proxies to `http://api:3001` with `Upgrade` and `Connection` headers set

#### Scenario: Shortlink path proxied to api service
- **WHEN** a client requests `https://$DOMAIN/s/<path>`
- **THEN** nginx proxies the request to `http://api:3001`

#### Scenario: Webchat and web paths proxied to web service
- **WHEN** a client requests `https://$DOMAIN/webchat/<path>` or any other path
- **THEN** nginx proxies the request to `http://web:3000`

### Requirement: SSL certificate is auto-issued via Let's Encrypt on first start
The system SHALL obtain a Let's Encrypt certificate for `$DOMAIN` using the certbot webroot challenge on the first container start when no certificate exists.

#### Scenario: No certificate exists on start
- **WHEN** the certbot service starts and `/etc/letsencrypt/live/$DOMAIN/fullchain.pem` does not exist
- **THEN** certbot runs `certonly --webroot` and writes the certificate to the shared `certbot_certs` volume

#### Scenario: Certificate already exists on start
- **WHEN** the certbot service starts and a valid certificate already exists
- **THEN** certbot skips issuance and proceeds to the renewal schedule

### Requirement: SSL certificate is automatically renewed via scheduled cron
The system SHALL check for certificate renewal daily and reload nginx after a successful renewal.

#### Scenario: Certificate is within renewal window
- **WHEN** the daily cron job runs and the certificate expires within 30 days
- **THEN** certbot renews the certificate and nginx is reloaded to apply the new cert

#### Scenario: Certificate is not within renewal window
- **WHEN** the daily cron job runs and the certificate is still valid for more than 30 days
- **THEN** certbot skips renewal and nginx is not reloaded
