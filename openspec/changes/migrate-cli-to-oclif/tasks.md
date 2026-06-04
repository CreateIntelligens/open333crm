## 1. Database And Session Service

- [x] 1.1 Add a `CliSession` Prisma model with tenant, agent, hashed token, prefix/suffix, scopes, expiry, revocation, and last-used fields.
- [x] 1.2 Create a Prisma migration for `cli_sessions` and add indexes for token prefix, tenant/agent lookup, and active session filtering.
- [x] 1.3 Regenerate the Prisma client from `@open333crm/database`.
- [x] 1.4 Add `apps/api/src/modules/auth/cli-session.service.ts` with create, verify, touch lastUsedAt, and revoke helpers.
- [x] 1.5 Generate raw tokens with `node:crypto.randomBytes`, prefix them with `cli_`, and store only hashes using the existing password/hash utilities.
- [x] 1.6 Add focused unit tests for raw-token one-time return, hash verification, expiry rejection, revoked-token rejection, and last-used updates.

## 2. API Auth And Capabilities

- [x] 2.1 Add request/response Zod schemas for CLI login/logout and CLI capability discovery.
- [x] 2.2 Add `POST /api/v1/auth/cli/login` that reuses existing credential validation and creates a CLI session.
- [x] 2.3 Add `POST /api/v1/auth/cli/logout` that revokes the current CLI session.
- [x] 2.4 Add auth plugin preHandlers for `authenticateCliSession` and `authenticateJwtOrCliSession` without broadening the existing default `authenticate` behavior.
- [x] 2.5 Update `GET /api/v1/auth/me` to accept existing JWTs and explicitly verified CLI sessions.
- [x] 2.6 Add `GET /api/v1/cli/apis` that requires `cli:apis` and returns registry-defined endpoints, capabilities, routes, scopes, params, example values, and token metadata.
- [x] 2.7 Add rate limiting to CLI login consistent with the web login risk profile.
- [x] 2.8 Add API tests for successful login, invalid credentials, status identity via CLI token, revoked/expired token rejection, and insufficient discovery scope.

## 3. CLI Package

- [x] 3.1 Create `apps/cli` with `package.json`, TypeScript config, build/dev scripts, and `bin.open333`.
- [x] 3.2 Add CLI dependencies: `@oclif/core`, `@inquirer/prompts`, `keytar`, and `conf`.
- [x] 3.3 Add a small API client using Node fetch with timeout/error handling and consistent Open333 response parsing.
- [x] 3.4 Add a config store for non-secret host/profile/agent metadata.
- [x] 3.5 Add a credential store adapter that writes raw tokens to keychain and supports an explicit test/env-token path.
- [x] 3.6 Implement `open333 login` with `--host`, `--email`, `--profile`, interactive prompts, password masking, and keychain storage.
- [x] 3.7 Implement `open333 status` to call `/health` first and then `/api/v1/auth/me`.
- [x] 3.8 Implement `open333 apis` to call `/api/v1/cli/apis` and print endpoints/capabilities/routes/scopes in a readable format or compact JSON with `--json`.
- [x] 3.9 Implement clear CLI errors for unreachable host, invalid credentials, missing local token, expired token, and insufficient scope.

## 4. Workspace Integration And Packaging

- [x] 4.1 Add `apps/cli` to pnpm workspace and Turborepo build/lint coverage.
- [x] 4.2 Add root/package scripts or documented commands for building and running the CLI locally.
- [x] 4.3 Ensure the CLI package uses ESM consistently with the repo and emits executable output with a shebang.
- [x] 4.4 Configure publishable npm package metadata for `@open333crm/cli`, including `bin.open333`, license, README, repository, keywords, engines, and `publishConfig`.
- [x] 4.5 Configure the package `files` allowlist so npm includes compiled runtime output and excludes tests, source-only fixtures, local credentials, and workspace-only artifacts.
- [x] 4.6 Add README or docs snippet showing `npm install -g @open333crm/cli`, `open333 login`, `open333 status`, and `open333 apis`.
- [x] 4.7 Add release documentation for `pnpm --filter @open333crm/cli build`, `npm pack --dry-run`, local tarball install, and `npm publish --access public`.

## 5. Verification

- [x] 5.1 Run `pnpm --filter @open333crm/database db:generate`.
- [x] 5.2 Run focused API tests for CLI session auth.
- [x] 5.3 Run `pnpm --filter @open333crm/api build`.
- [x] 5.4 Run `pnpm --filter @open333crm/cli build`.
- [x] 5.5 Run `pnpm --filter @open333crm/cli exec npm pack --dry-run` and inspect the package file list.
- [x] 5.6 Install the packed tarball locally and verify `open333 --help`, `open333 login`, `open333 status`, and `open333 apis` resolve from the installed binary.
- [ ] 5.7 Manually verify local CLI flow against a dev API: login, status, apis, logout/revocation.
- [ ] 5.8 Verify existing browser login/refresh/logout behavior still works.
- [ ] 5.9 Verify partner API key ingestion auth still works.

## 6. Oclif Migration

- [x] 6.1 Replace the CLI runtime dependency from `commander` to `@oclif/core` and update the pnpm lockfile.
- [x] 6.2 Convert the `open333` entrypoint to run oclif while preserving the package `bin.open333` executable.
- [x] 6.3 Convert `login`, `status`, and `apis` command modules into oclif command classes.
- [x] 6.4 Preserve existing command options, prompts, output shape, JSON behavior, and error formatting.
- [x] 6.5 Reuse the existing API client, config store, credential store, and shared CLI types instead of duplicating runtime helpers.
- [x] 6.6 Update README, release notes, and sandbox install docs to describe oclif-based local testing and publishing.
- [x] 6.7 Verify `open333 --help`, `open333 login --help`, `open333 status --help`, and `open333 apis --help` from compiled output.
- [x] 6.8 Verify `pnpm cli:sandbox` installs the packed tarball and resolves the installed oclif binary.
