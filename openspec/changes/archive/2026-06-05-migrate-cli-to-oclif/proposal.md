## Why

Open333 currently has web login and partner API keys, but no first-class local CLI identity flow. A supported `open333` CLI needs a secure way to log in, persist local credentials, verify the current server/user, and discover which API capabilities the token can use.

The CLI is also expected to become a larger LLM-operated surface as API capabilities expand. Using a product CLI framework now avoids reworking command layout, help metadata, and testing conventions after more commands are added.

## What Changes

- Add a new `apps/cli` workspace package that exposes an `open333` binary with `login`, `status`, and `apis` commands.
- Build the CLI command surface on oclif instead of commander, while preserving the existing command names, options, and output behavior.
- Add a CLI-specific auth flow that accepts host/email/password, validates against the API, and returns a CLI-scoped credential suitable for local non-browser use.
- Store CLI credentials in the OS keychain when available, with a local config fallback that stores only non-secret metadata unless explicitly configured.
- Add `open333 status` behavior that checks `{host}/health` and then `/api/v1/auth/me` using the stored credential.
- Add `open333 apis` behavior that lists the current credential's capabilities, routes, and scopes.
- Add API endpoints/services for issuing, verifying, listing capabilities for, and revoking CLI-scoped sessions/tokens.
- Package the CLI as an npm-publishable package with a runnable `open333` binary.
- Preserve existing web auth, refresh-token cookie behavior, and partner API key behavior.

## Capabilities

### New Capabilities
- `open333-cli-auth`: CLI login, local credential storage, status checks, and API capability discovery.

### Modified Capabilities
- None.

## Impact

- New workspace app: `apps/cli`.
- Backend API: `apps/api/src/modules/auth`, auth plugin credential verification, and a new capability endpoint under `/api/v1`.
- Database: new CLI token/session persistence, hashed secret storage, metadata, expiry/revocation, and last-used tracking.
- Dependencies: oclif command framework, prompt/input handling, HTTP client, keychain integration, local config fallback, and test/build tooling for the CLI package.
- Packaging/release: npm package metadata, `bin.open333`, publish-safe files list, npm dry-run verification, and release documentation.
- Security: CLI tokens must be scoped, revocable, hashed at rest, and must not reuse browser refresh-token cookies.
