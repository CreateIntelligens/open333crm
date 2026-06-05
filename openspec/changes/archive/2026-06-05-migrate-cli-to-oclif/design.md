## Context

`apps/api` already has browser-oriented login at `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, and `GET /api/v1/auth/me`. That flow returns a short-lived JWT access token and uses an HttpOnly refresh-token cookie for the browser. The repo also has `PartnerApiKey` for long-lived external ingestion keys, with raw key shown once, bcrypt-hashed storage, visible prefix/suffix, expiry, active flag, and last-used tracking.

The CLI needs a different boundary. It is not a browser, cannot use HttpOnly refresh cookies ergonomically, and must store secrets locally. The first useful surface is small: `open333 login`, `open333 status`, and `open333 apis`.

## Goals / Non-Goals

**Goals:**
- Add a TypeScript CLI package at `apps/cli` with an `open333` binary.
- Let users log in with host/email/password and receive a CLI-scoped credential from the API.
- Store the CLI secret in the OS keychain where possible, with a controlled config fallback.
- Let `open333 status` verify both server health and the current authenticated identity.
- Let `open333 apis` show capabilities/routes/scopes for the current token.
- Keep CLI tokens hashed at rest, revocable, expirable, and visibly identifiable by prefix/suffix.
- Build the CLI into an npm-publishable package with a working `open333` binary.

**Non-Goals:**
- Do not replace browser JWT/refresh-cookie auth.
- Do not reuse partner API keys for human CLI login.
- Do not make every existing API route accept CLI tokens in this first change.
- Do not add CLI commands for conversations, cases, contacts, or automation yet.
- Do not introduce Socket.IO, BullMQ, or worker behavior.

## Decisions

1. Use oclif for the CLI command surface.
   - Chosen stack: `@oclif/core` for commands/options/help, `@inquirer/prompts` for interactive host/email/password, `keytar` for OS keychain, and `conf` for non-secret CLI profile metadata.
   - Rationale: although the first CLI has only three commands, `open333` is expected to grow into a product CLI and an LLM-operated API surface. oclif gives explicit command classes, topic-friendly file structure, generated command help, command metadata, and testing conventions that will scale better as business commands are added.
   - Alternative considered: `commander`. It is lighter and sufficient for a small hand-operated CLI, but command layout, metadata, documentation, and tests would become local conventions that must be reinvented once the CLI grows.
   - The migration must keep the public command surface stable: `open333 login`, `open333 status`, `open333 apis`, their options, and the installed `open333` binary name must not change.

2. Use a new `CliSession` model rather than `PartnerApiKey`.
   - Shape: `id`, `tenantId`, `agentId`, `name`, `tokenHash`, `tokenPrefix`, `tokenSuffix`, `scopes Json`, `expiresAt`, `lastUsedAt`, `revokedAt`, `createdAt`, `updatedAt`.
   - Token format: `cli_<random>`, generated with `node:crypto.randomBytes`, stored only as a hash, and returned once on login.
   - Rationale: partner keys currently represent external integration identity and synthesize a supervisor agent for ingestion. CLI sessions represent a real agent logging in from a local device and need separate expiry, revocation, display, and scope semantics.
   - Alternative considered: reuse browser JWT. That avoids schema work but gives poor revocation and pushes a refresh-cookie flow into a non-browser client.

3. Add CLI auth endpoints under the auth boundary.
   - `POST /api/v1/auth/cli/login`: validates email/password with the existing `login()` service, then creates and returns a CLI session token plus agent/profile metadata.
   - `POST /api/v1/auth/cli/logout`: revokes the current CLI session when called with a CLI token.
   - `GET /api/v1/auth/me`: accepts existing JWTs and CLI tokens for identity checks, but only after the CLI token is verified and active.
   - Rationale: login remains in the auth module, while `status` can use the same identity endpoint as the web app.

4. Add a dedicated endpoint registry for CLI discovery.
   - `GET /api/v1/cli/apis`: returns the current token's scopes plus route/capability metadata.
   - Endpoint metadata is defined in a registry so new CLI-visible APIs can be added by appending endpoint definitions instead of changing the discovery route handler.
   - Endpoint shape:

   ```ts
   type CliEndpoint = {
     name: string;
     description: string;
     method: 'GET' | 'POST' | 'PUT' | 'DELETE';
     path: string;
     params: Record<string, { desc: string; value: unknown }>;
   };
   ```

   - Response example:

   ```json
   {
     "token": {
       "id": "session-id",
       "name": "MacBook Pro",
       "scopes": ["cli:status", "cli:apis"],
       "expiresAt": "2026-07-02T00:00:00.000Z",
       "lastUsedAt": "2026-06-02T10:00:00.000Z"
     },
     "endpoints": [
       {
         "name": "Current Agent",
         "description": "Get the authenticated agent identity for the current CLI token",
         "method": "GET",
         "path": "/api/v1/auth/me",
         "params": {},
         "scopes": ["cli:status"]
       }
     ],
     "capabilities": [
       {
         "name": "identity",
         "description": "Server health and current CLI identity",
         "routes": ["GET /health", "GET /api/v1/auth/me"],
         "scopes": ["cli:status"],
         "endpoints": [
           {
             "name": "Current Agent",
             "description": "Get the authenticated agent identity for the current CLI token",
             "method": "GET",
             "path": "/api/v1/auth/me",
             "params": {}
           }
         ]
       },
       {
         "name": "api-discovery",
         "description": "CLI API discovery metadata",
         "routes": ["GET /api/v1/cli/apis"],
         "scopes": ["cli:apis"],
         "endpoints": [
           {
             "name": "List CLI APIs",
             "description": "List endpoints and capability scopes available to the current CLI token",
             "method": "GET",
             "path": "/api/v1/cli/apis",
             "params": {}
           }
         ]
       }
     ]
   }
   ```

   - Rationale: it gives the CLI a stable introspection command without exposing an unaudited complete route dump. The registry also makes future business APIs explicit and reviewable.

5. Keep the first CLI token scope narrow.
   - Initial scopes: `cli:status` and `cli:apis`.
   - The auth plugin should expose a `authenticateCliSession` preHandler for CLI-only endpoints and a `authenticateJwtOrCliSession` path only where explicitly needed.
   - Rationale: accepting CLI tokens on every existing route before route-level scope guards exist would broaden the security surface.

6. Store local CLI state as profile metadata plus keychain secret.
   - `conf` stores host, profile name, agent email/name, tenantId, and token prefix/suffix.
   - `keytar` stores the raw token under a service name such as `open333` and account key based on host/profile.
   - If keychain is unavailable, fail closed by default with an error that explains how to use an explicit insecure file fallback flag or environment token. The fallback must be obvious and opt-in.
   - Rationale: host/profile metadata is not secret; the raw token is.

7. Package the CLI for npm installation.
   - Publishable package name: prefer `@open333crm/cli` with `bin.open333` pointing to the compiled entrypoint. This avoids occupying the global `open333` package name while still installing a global `open333` command.
   - Package contents: compiled `dist`, README/license, and package metadata only. Source, tests, local config, and workspace-only files should be excluded through `files`.
   - Build flow: TypeScript compiles to ESM output with a shebang-preserving executable entrypoint and executable permissions.
   - Verification: use `npm pack --dry-run` and install/link the packed tarball locally before publishing.
   - Rationale: this supports `npm install -g @open333crm/cli` without coupling implementation work to npm account credentials.
   - Alternative considered: publish package name `open333`. That gives a shorter install command but may create namespace ownership issues and is harder to protect than a scoped organization package.

## Risks / Trade-offs

- Native keychain dependency can fail in CI or headless Linux -> Keep credential access behind a small storage adapter and add an environment-token path for tests.
- CLI token accidentally accepted by existing APIs -> Use dedicated preHandlers and do not change default `fastify.authenticate` behavior globally unless each route has scope checks.
- Capabilities drift from actual route behavior -> Keep the first endpoint as a curated metadata list and add route entries only when CLI access is implemented.
- Token theft from local machine -> Hash token server-side, support revocation/expiry, show prefix/suffix, and avoid writing raw token to config by default.
- Login brute force through CLI endpoint -> Reuse existing credential validation and add rate limiting matching web login.
- Broken npm package after publish -> Verify with `npm pack --dry-run`, tarball inspection, and local global install from the tarball before publishing.

## Migration Plan

1. Add the `CliSession` Prisma model and migration.
2. Generate Prisma client through `@open333crm/database`.
3. Add CLI session service helpers for create, verify, touch lastUsedAt, and revoke.
4. Add auth routes for CLI login/logout and update `/auth/me` to support explicitly verified CLI sessions.
5. Add `GET /api/v1/cli/apis` with curated capabilities.
6. Add `apps/cli` package, binary entrypoint, command modules, API client, config store, and credential store.
7. Add focused API and CLI tests.
8. Verify the npm package tarball with `npm pack --dry-run` and local tarball install before release.

Rollback: remove `apps/cli`, remove the new auth/CLI routes, and stop accepting `cli_` tokens. Database rollback can drop the `cli_sessions` table after revoking any issued sessions.

## Open Questions

- Should CLI sessions default to 30 days, 90 days, or no expiry with explicit revocation?
- Should admins get a web UI to view/revoke CLI sessions in the same settings area as partner API keys?
- Should future CLI business commands reuse the same curated capability endpoint or move to route-level generated metadata?
- Should the public npm package be `@open333crm/cli` only, or should the project also reserve `open333` for a shorter install path later?
