# Open333CLI Quick Reference Card

## Installation & Setup

```bash
# Install globally
npm install -g @open333crm/cli

# Or run via pnpm (monorepo)
pnpm --filter @open333crm/cli dev -- <command>

# First login (creates profile + stores token securely)
open333 login --host https://api.example.com --email me@company.com --profile production
# Prompts for password securely via @inquirer/prompts
```

## Profiles

```bash
# List profiles
open333 login --help  # Shows profile concept

# Use specific profile
open333 status --profile staging
open333 stats --profile production --json
```

## Commands

### `open333 login`

Authenticate and store a CLI-scoped token.

```bash
open333 login [--host <url>] [--email <email>] [--profile <name>]
# All flags optional - prompts interactively if omitted

# Non-interactive (CI/CD)
open333 login --host https://api.example.com --email bot@company.com --profile ci
# Requires stdin for password or use credential store pre-population
```

**Stores:**

- Profile config: `~/.config/open333/config.json` (conf)
- Token: OS keychain (keytar) - `open333-cli` service, key=`host|profile`

---

### `open333 status`

Check API health and current identity.

```bash
open333 status [--profile <name>] [--json]

# Output (text):
Host: https://api.example.com
Health: ok
Agent: John Doe <john@company.com>
Tenant: 550e8400-e29b-41d4-a716-446655440000

# Output (--json):
{
  "host": "https://api.example.com",
  "profile": "default",
  "health": { "status": "ok", "timestamp": "..." },
  "agent": { "id": "...", "email": "...", "name": "...", "tenantId": "...", ... }
}
```

**Scope:** `cli:status`

---

### `open333 apis`

Discover available endpoints and capabilities for current token.

```bash
open333 apis [--profile <name>] [--json]

# Output (text):
Token: cli_a1b2c...f3d4
Scopes: cli:status, cli:apis, cli:analytics:read

identity
  Server health and current CLI identity
  Scopes: cli:status
  GET /health - Check whether the Open333 API is reachable
  GET /api/v1/auth/me - Get the authenticated agent identity

api-discovery
  CLI API discovery metadata
  Scopes: cli:apis
  GET /api/v1/cli/apis - List endpoints and capability scopes

statistics
  Read-only CRM analytics for CLI workflows
  Scopes: cli:analytics:read
  GET /api/v1/cli/analytics/overview - Aggregate CRM metrics
  GET /api/v1/cli/analytics/message-trend - Grouped message counts
  GET /api/v1/cli/analytics/cases - Case trends & SLA violations
  GET /api/v1/cli/analytics/channels - Channel message/conversation counts
  GET /api/v1/cli/analytics/my - Current agent performance
```

**Scope:** `cli:apis`

---

### `open333 stats`

Read-only CRM analytics dashboard.

```bash
open333 stats [--profile <name>] [--from <date>] [--to <date>] [--group-by day|week|month] [--json]

# Date formats: YYYY-MM-DD, ISO 8601, or Unix timestamp
# Default: last 30 days, grouped by day

# Output (text):
Overview
  Messages: 1234 (567 inbound, 667 outbound)
  Cases: 12 open, 5 new, 89 resolved
  SLA achievement: 94.5%
  CSAT: 4.2 (87% positive)

Trends
  Latest period: 2026-07-08 (45 messages)
  Case trend points: 30
  SLA violations: 3
  Channel messages: 1234

My Performance
  Agent: John Doe
  Cases: 23 handled, 18 resolved, 5 pending
  SLA soon expiring: 2
```

**Response Type:** `CliStatsResponse` (see types.ts)

**Scope:** `cli:analytics:read`

---

## JSON Output Pattern

All commands support `--json` for programmatic use:

```bash
open333 stats --json | jq '.overview.totalMessages'
open333 status --json | jq '.agent.tenantId'
open333 apis --json | jq '.capabilities[] | select(.name=="statistics")'
```

---

## Error Codes

| Code                 | HTTP    | Meaning                    | Resolution                                               |
| -------------------- | ------- | -------------------------- | -------------------------------------------------------- |
| `PROFILE_MISSING`    | -       | Profile not configured     | Run `open333 login`                                      |
| `INSUFFICIENT_SCOPE` | 403     | Token lacks required scope | Ask admin to grant scope or re-login with broader scopes |
| `API_ERROR`          | 4xx/5xx | API request failed         | Check host, network, token expiry                        |
| `TOKEN_EXPIRED`      | 401     | CLI token expired          | Re-run `open333 login`                                   |
| `TOKEN_REVOKED`      | 401     | CLI token revoked          | Re-run `open333 login`                                   |

---

## Token Scopes (Current)

| Scope                | Commands | Endpoints                    |
| -------------------- | -------- | ---------------------------- |
| `cli:status`         | `status` | `/health`, `/api/v1/auth/me` |
| `cli:apis`           | `apis`   | `/api/v1/cli/apis`           |
| `cli:analytics:read` | `stats`  | `/api/v1/cli/analytics/*`    |

**Default scopes on login:** `cli:status`, `cli:apis`
**Add analytics:** Admin must grant `cli:analytics:read` in DB or via future `token` command

---

## Development

```bash
# Build
pnpm --filter @open333crm/cli build

# Dev (tsx watch)
pnpm --filter @open333crm/cli dev -- stats --json

# Lint
pnpm --filter @open333crm/cli lint

# Test single file
tsx apps/cli/src/__tests__/stats-command.test.ts
```

---

## Adding a New Command (Template)

1. **Types** (`src/types.ts`):

```typescript
export interface MyResponse {
  items: Array<{ id: string; name: string }>;
}
```

2. **Command Function** (`src/commands/my-cmd.ts`):

```typescript
export async function myCmd(options, output) {
  /* ... */
}
export default class MyCmd extends Open333Command {
  /* oclif class */
}
```

3. **Register** (`src/commands.ts`):

```typescript
import MyCmd from './commands/my-cmd.js';
export default { ..., 'my-cmd': MyCmd };
```

4. **Backend**: Add scope + capability + route (see SKILL.md)

---

## Key Files

| File                                          | Purpose                   |
| --------------------------------------------- | ------------------------- |
| `src/index.ts`                                | oclif entry               |
| `src/commands.ts`                             | Command registry          |
| `src/commands/*.ts`                           | Command implementations   |
| `src/api-client.ts`                           | Authenticated fetch       |
| `src/config-store.ts`                         | Profile storage (conf)    |
| `src/credential-store.ts`                     | Token storage (keytar)    |
| `src/types.ts`                                | Shared TypeScript types   |
| `src/base-command.ts`                         | Error handling base class |
| `api/src/modules/cli/cli.routes.ts`           | CLI API routes            |
| `api/src/modules/cli/cli-endpoints.ts`        | Capability definitions    |
| `api/src/modules/auth/cli-session.service.ts` | Token management & scopes |
