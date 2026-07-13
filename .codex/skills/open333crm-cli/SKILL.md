---
name: open333crm-cli
description: Comprehensive guide for working with Open333CRM CLI (open333). Covers architecture, existing commands, API endpoints, scopes, command patterns, and LLM-friendly workflows for extending CLI capabilities. Use when building, testing, or extending the Open333 CRM command-line interface.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.2.0"
---

# Open333CRM CLI Skill

**Package**: `@open333crm/cli` | **Binary**: `open333` | **Framework**: oclif v4 + TypeScript (ESM)

## Quick Reference

| Command          | Description                                                     | Required Scope       |
| ---------------- | --------------------------------------------------------------- | -------------------- |
| `open333 login`  | Authenticate and store CLI-scoped token                         | —                    |
| `open333 status` | Check server health and current identity                        | `cli:status`         |
| `open333 stats`  | Show CRM analytics (messages, cases, SLA, CSAT, my performance) | `cli:analytics:read` |
| `open333 apis`   | List CLI token endpoints, capabilities, and scopes              | `cli:apis`           |

---

## Architecture Overview

### CLI Project Structure

```
apps/cli/
├── src/
│   ├── index.ts              # oclif entry point
│   ├── commands.ts           # Command registry
│   ├── base-command.ts       # Open333Command base class
│   ├── api-client.ts         # Authenticated API client
│   ├── config-store.ts       # Local profile storage (conf)
│   ├── credential-store.ts   # Secure token storage (keytar)
│   ├── output.ts             # Console output abstraction
│   ├── errors.ts             # CliError with codes
│   ├── types.ts              # TypeScript interfaces
│   └── commands/
│       ├── login.ts          # Authentication
│       ├── status.ts         # Health + identity
│       ├── stats.ts          # Analytics dashboard
│       └── apis.ts           # API discovery
├── package.json
├── tsconfig.json
└── README.md
```

### Authentication Flow

```
open333 login
  ├─ Prompts: host, email, password, profile name
  ├─ POST /api/v1/auth/cli/login → { token, session, agent }
  ├─ Store token in keytar (key: host+profile)
  └─ Save profile in conf (host, profile, agentId, tenantId, tokenPrefix/Suffix, expiresAt)
```

### Token Scopes (from `apps/api/src/modules/auth/cli-session.service.ts`)

| Scope                | Constant                   | Description                                 |
| -------------------- | -------------------------- | ------------------------------------------- |
| `cli:status`         | `CLI_STATUS_SCOPE`         | Health check + current agent identity       |
| `cli:apis`           | `CLI_APIS_SCOPE`           | List available CLI endpoints & capabilities |
| `cli:analytics:read` | `CLI_ANALYTICS_READ_SCOPE` | Read-only analytics endpoints               |

**Default scopes**: `cli:status`, `cli:apis` (granted on login unless overridden)

---

## Current CLI Commands

### `open333 login`

```bash
open333 login [--host <url>] [--email <email>] [--profile <name>]
```

**Interactive prompts** if flags omitted:

- Host (default: `http://localhost:3001`)
- Email
- Password (masked)
- Profile name (default: `default`)

**API Call**: `POST /api/v1/auth/cli/login`

```json
{ "email": "...", "password": "...", "profile": "default", "name": "default" }
```

**Response Types** (`src/types.ts`):

```typescript
interface CliLoginResponse {
  token: string; // Full token (cli_xxx...)
  session: {
    id: string;
    name: string;
    tokenPrefix: string; // e.g., "cli_abcde"
    tokenSuffix: string; // e.g., "fghij"
    scopes: string[];
    expiresAt: string;
    lastUsedAt: string | null;
  };
  agent: AgentIdentity;
}
```

---

### `open333 status`

```bash
open333 status [--profile <name>] [--json]
```

**Checks**:

1. `GET /health` (unauthenticated)
2. `GET /api/v1/auth/me` (authenticated with stored token)

**Output** (text):

```
Host: http://localhost:3001
Health: ok
Agent: John Doe <john@example.com>
Tenant: 550e8400-e29b-41d4-a716-446655440000
```

**Output** (`--json`):

```json
{
  "host": "http://localhost:3001",
  "profile": "default",
  "health": { "status": "ok", "timestamp": "..." },
  "agent": {
    "id": "...",
    "email": "...",
    "name": "...",
    "role": "ADMIN",
    "tenantId": "..."
  }
}
```

---

### `open333 stats`

```bash
open333 stats [--profile <name>] [--from <date>] [--to <date>] [--group-by day|week|month] [--json]
```

**Aggregates 5 API calls in parallel**:

- `GET /api/v1/cli/analytics/overview` — aggregate metrics
- `GET /api/v1/cli/analytics/message-trend` — time-series message counts
- `GET /api/v1/cli/analytics/cases` — case trends, distributions, SLA violations
- `GET /api/v1/cli/analytics/channels` — channel breakdown
- `GET /api/v1/cli/analytics/my` — current agent performance

**Date params**: ISO 8601 or relative (e.g., `2026-01-01`, `7d ago`)

**Output** (text):

```
Overview
  Messages: 1,234 (800 inbound, 434 outbound)
  Cases: 42 open, 15 new, 38 resolved
  SLA achievement: 92.5%
  CSAT: 4.7 (94% positive)

Trends
  Latest period: 2026-07-08 (45 messages)
  Case trend points: 30
  SLA violations: 3
  Channel messages: 1,234

My Performance
  Agent: John Doe
  Cases: 12 handled, 10 resolved, 2 pending
  SLA soon expiring: 1
```

---

### `open333 apis`

```bash
open333 apis [--profile <name>] [--json]
```

**Discovers CLI capabilities** from token scopes. Returns:

- Token metadata (scopes, expiry, prefix/suffix)
- Endpoints grouped by capability with required scopes
- Human-readable route list per capability

**Output** (text):

```
Token: cli_abcde...fghij
Scopes: cli:status, cli:apis, cli:analytics:read

identity (scopes: cli:status)
  GET /health - Check whether the Open333 API is reachable
  GET /api/v1/auth/me - Get the authenticated agent identity for the current CLI token

api-discovery (scopes: cli:apis)
  GET /api/v1/cli/apis - List endpoints and capability scopes available to the current CLI token

statistics (scopes: cli:analytics:read)
  GET /api/v1/cli/analytics/overview - Get aggregate CRM message, case, SLA, and CSAT metrics
  ...
```

---

## API Endpoints Reference

### Identity Capability (`cli:status`)

| Method | Path              | Description                   |
| ------ | ----------------- | ----------------------------- |
| GET    | `/health`         | Server health check (no auth) |
| GET    | `/api/v1/auth/me` | Current agent identity        |

### API Discovery Capability (`cli:apis`)

| Method | Path               | Description                                     |
| ------ | ------------------ | ----------------------------------------------- |
| GET    | `/api/v1/cli/apis` | List endpoints & capabilities for current token |

### Statistics Capability (`cli:analytics:read`)

| Method | Path                                  | Params                  | Description                                 |
| ------ | ------------------------------------- | ----------------------- | ------------------------------------------- |
| GET    | `/api/v1/cli/analytics/overview`      | `from`, `to`            | Aggregate message, case, SLA, CSAT metrics  |
| GET    | `/api/v1/cli/analytics/message-trend` | `from`, `to`, `groupBy` | Message counts grouped by day/week/month    |
| GET    | `/api/v1/cli/analytics/cases`         | `from`, `to`            | Case trends, distributions, SLA violations  |
| GET    | `/api/v1/cli/analytics/channels`      | `from`, `to`            | Channel message/conversation/contact counts |
| GET    | `/api/v1/cli/analytics/my`            | —                       | Current agent performance metrics           |

---

## TypeScript Types (from `src/types.ts`)

```typescript
// Analytics
interface CliAnalyticsOverview {
  totalMessages: number;
  inboundMessages: number;
  outboundMessages: number;
  openCases: number;
  newCases: number;
  resolvedCases: number;
  slaAchievementRate: number | null;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  csatAvg: number | null;
  csatPositiveRate: number | null;
}

interface CliMessageTrendPoint {
  date: string;
  total: number;
  [channel: string]: string | number;
}

interface CliCaseStats {
  trend: Array<{ date: string; opened: number; closed: number }>;
  categoryDistribution: CliDistributionPoint[];
  priorityDistribution: CliDistributionPoint[];
  statusDistribution: CliDistributionPoint[];
  escalationRate: number;
  slaViolationCount: number;
}

interface CliChannelAnalytics {
  messagesByChannel: CliDistributionPoint[];
  conversationsByChannel: CliDistributionPoint[];
  botVsHuman: CliDistributionPoint[];
  newContactsByChannel: CliDistributionPoint[];
}

interface CliAgentPerformance {
  agentId: string;
  name: string;
  role: string;
  casesHandled: number;
  casesResolved: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  csatAvg: number | null;
  slaAchievementRate: number | null;
  pendingCases: number;
  slaSoonExpiring: number;
}

interface CliStatsResponse {
  overview: CliAnalyticsOverview;
  messageTrend: CliMessageTrendPoint[];
  cases: CliCaseStats;
  channels: CliChannelAnalytics;
  my: CliAgentPerformance;
}

// API Discovery
interface CliEndpoint {
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  params: Record<string, { desc: string; value: unknown }>;
}

interface CliApisResponse {
  token: { id: string; name: string; scopes: string[]; expiresAt: string; ... };
  endpoints: Array<CliEndpoint & { scopes: string[] }>;
  capabilities: Array<{
    name: string;
    description: string;
    scopes: string[];
    routes: string[];
    endpoints: CliEndpoint[];
  }>;
}
```

---

## Command Implementation Patterns

### 1. Command Function (Testable, Reusable)

```typescript
// src/commands/stats.ts
export async function statsCommand(
  options: StatsOptions,
  output: CliOutput = consoleOutput,
): Promise<void> {
  const profileName = resolveProfileName(options.profile);
  const profile = getProfile(profileName);
  if (!profile)
    throw new CliError(
      `Profile "${profileName}" not configured. Run open333 login first.`,
      "PROFILE_MISSING",
    );

  const token = await readToken(profile.host, profile.profile);
  const client = new ApiClient({ host: profile.host, token });

  let data: CliStatsResponse;
  try {
    data = await fetchStats(client, options);
  } catch (err) {
    if (err instanceof CliError && err.status === 403) {
      throw new CliError(
        "Current CLI token cannot read analytics. Required scope: cli:analytics:read.",
        "INSUFFICIENT_SCOPE",
        403,
      );
    }
    throw err;
  }

  if (options.json) {
    output.log(JSON.stringify(data, null, 2));
    return;
  }
  for (const line of formatStatsText(data)) output.log(line);
}
```

### 2. Command Class (oclif Integration)

```typescript
export default class Stats extends Open333Command {
  static id = "stats";
  static description =
    "Show read-only CRM statistics for the current CLI profile";

  static flags = {
    help: Flags.help({ char: "h" }),
    profile: Flags.string({ description: "local profile name" }),
    from: Flags.string({ description: "start date or timestamp" }),
    to: Flags.string({ description: "end date or timestamp" }),
    "group-by": Flags.string({
      options: ["day", "week", "month"],
      default: "day",
      aliases: ["groupBy"],
    }),
    json: Flags.boolean({ description: "print JSON output" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Stats);
    await statsCommand(
      {
        profile: flags.profile,
        from: flags.from,
        to: flags.to,
        groupBy: flags["group-by"] as StatsOptions["groupBy"],
        json: flags.json,
      },
      { log: this.log.bind(this) },
    );
  }
}
```

### 3. Base Command Class

```typescript
// src/base-command.ts
export abstract class Open333Command extends Command {
  protected async catch(err: Error): Promise<void> {
    console.error(formatCliError(err));
    process.exitCode = 1;
  }
}
```

### 4. API Client

```typescript
// src/api-client.ts
export class ApiClient {
  constructor(private config: { host: string; token?: string }) {}

  async get<T>(path: string): Promise<T> {
    return this.request("GET", path);
  }
  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request("POST", path, body);
  }
  async health(): Promise<{ status: string; timestamp: string }> {
    return this.get("/health");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.config.host}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.config.token
          ? { Authorization: `Bearer ${this.config.token}` }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new CliError(await res.text(), "API_ERROR", res.status);
    return res.json();
  }
}
```

### 5. Config Store (Profiles)

```typescript
// src/config-store.ts
import { Conf } from "conf";

interface CliProfile {
  host: string;
  profile: string;
  agentId: string;
  agentEmail: string;
  agentName: string;
  tenantId: string;
  tokenPrefix: string;
  tokenSuffix: string;
  expiresAt: string;
}

const store = new Conf<Record<string, CliProfile>>({
  projectName: "open333",
  migrations: {},
});

export function getProfile(name: string): CliProfile | undefined {
  return store.get(name);
}
export function saveProfile(profile: CliProfile): void {
  store.set(profile.profile, profile);
}
export function deleteProfile(name: string): void {
  store.delete(name);
}
export function listProfiles(): CliProfile[] {
  return Object.values(store.store);
}
export function resolveProfileName(name?: string): string {
  return name ?? "default";
}
```

### 6. Credential Store (Secure Tokens)

```typescript
// src/credential-store.ts
import { setPassword, getPassword, deletePassword } from "keytar";
const SERVICE = "open333-cli";

export async function storeToken(
  host: string,
  profile: string,
  token: string,
): Promise<void> {
  await setPassword(SERVICE, `${host}|${profile}`, token);
}
export async function readToken(
  host: string,
  profile: string,
): Promise<string | null> {
  return getPassword(SERVICE, `${host}|${profile}`);
}
export async function deleteToken(
  host: string,
  profile: string,
): Promise<void> {
  await deletePassword(SERVICE, `${host}|${profile}`);
}
```

---

## Extending the CLI (Adding New Commands)

### Step 1: Define Types

Add response types to `src/types.ts`:

```typescript
export interface MyNewResponse {
  items: Array<{ id: string; name: string; status: string }>;
  total: number;
}
```

### Step 2: Create Command Function

```typescript
// src/commands/my-command.ts
import { Flags } from "@oclif/core";
import { ApiClient } from "../api-client.js";
import { Open333Command } from "../base-command.js";
import { getProfile, resolveProfileName } from "../config-store.js";
import { readToken } from "../credential-store.js";
import { CliError } from "../errors.js";
import { consoleOutput, type CliOutput } from "../output.js";
import type { MyNewResponse } from "../types.js";

export interface MyCommandOptions {
  profile?: string;
  json?: boolean;
  filter?: string;
}

export async function myCommand(
  options: MyCommandOptions,
  output: CliOutput = consoleOutput,
): Promise<void> {
  const profileName = resolveProfileName(options.profile);
  const profile = getProfile(profileName);
  if (!profile)
    throw new CliError(
      `Profile "${profileName}" not configured. Run open333 login first.`,
      "PROFILE_MISSING",
    );

  const token = await readToken(profile.host, profile.profile);
  const client = new ApiClient({ host: profile.host, token });
  const data = await client.get<MyNewResponse>(
    `/api/v1/cli/my-endpoint?filter=${options.filter ?? ""}`,
  );

  if (options.json) {
    output.log(JSON.stringify(data, null, 2));
    return;
  }
  // Format text output
  for (const item of data.items)
    output.log(`${item.id}  ${item.name}  ${item.status}`);
}

export default class MyCommand extends Open333Command {
  static id = "my-command";
  static description = "Description of what this command does";

  static flags = {
    help: Flags.help({ char: "h" }),
    profile: Flags.string({ description: "local profile name" }),
    json: Flags.boolean({ description: "print JSON output" }),
    filter: Flags.string({ description: "filter items by name" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MyCommand);
    await myCommand(flags, { log: this.log.bind(this) });
  }
}
```

### Step 3: Register Command

```typescript
// src/commands.ts
import MyCommand from "./commands/my-command.js";

export default {
  apis: Apis,
  login: Login,
  stats: Stats,
  status: Status,
  "my-command": MyCommand, // Add here
} satisfies Record<string, Command.Class>;
```

### Step 4: Add API Endpoint (Backend)

In `apps/api/src/modules/cli/cli-endpoints.ts`, add to `cliCapabilities`:

```typescript
{
  name: 'my-feature',
  description: 'Description of capability',
  scopes: ['cli:my-feature:read'],  // Add new scope to cli-session.service.ts
  endpoints: [
    {
      name: 'List Items',
      description: 'Get paginated list of items',
      method: 'GET',
      path: '/api/v1/cli/my-endpoint',
      params: {
        filter: { desc: 'Filter by name', value: 'example' },
        page: { desc: 'Page number', value: 1 },
        limit: { desc: 'Items per page', value: 20 },
      },
    },
  ],
}
```

Add scope constant to `cli-session.service.ts`:

```typescript
export const CLI_MY_FEATURE_READ_SCOPE = "cli:my-feature:read";
export const DEFAULT_CLI_SCOPES = [CLI_STATUS_SCOPE, CLI_APIS_SCOPE] as const;
```

Add route to `cli.routes.ts`:

```typescript
fastify.get(
  "/my-endpoint",
  {
    preHandler: [fastify.authenticateCliSession],
  },
  async (request, reply) => {
    if (!hasCurrentCliScope(request, CLI_MY_FEATURE_READ_SCOPE)) {
      return sendInsufficientScope(reply, CLI_MY_FEATURE_READ_SCOPE);
    }
    // ... query DB, return data
  },
);
```

---

## Development Commands

```bash
# Install deps (from monorepo root)
pnpm install

# Build CLI
pnpm --filter @open333crm/cli build

# Dev mode (tsx watch)
pnpm --filter @open333crm/cli dev

# Lint (TypeScript check)
pnpm --filter @open333crm/cli lint

# Run CLI locally
pnpm --filter @open333crm/cli dev -- login
pnpm --filter @open333crm/cli dev -- stats --json
```

---

## Testing

```bash
# Single test file (uses tsx directly, no vitest config)
tsx apps/cli/src/__tests__/stats-command.test.ts
```

Test pattern (from `stats-command.test.ts`):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { statsCommand } from "../commands/stats.js";
import { CliError } from "../errors.js";

// Mock dependencies
vi.mock("../config-store.js", () => ({
  getProfile: vi.fn(),
  resolveProfileName: vi.fn(),
}));
vi.mock("../credential-store.js", () => ({ readToken: vi.fn() }));
vi.mock("../api-client.js", () => ({
  ApiClient: vi.fn().mockImplementation(() => ({ get: vi.fn() })),
}));

describe("statsCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws PROFILE_MISSING when profile not configured", async () => {
    const { getProfile } = await import("../config-store.js");
    vi.mocked(getProfile).mockReturnValue(undefined);

    await expect(statsCommand({})).rejects.toThrow(CliError);
  });
});
```

---

## LLM Usage Patterns

### For LLM Agents Using This CLI

**Authentication**:

```bash
# One-time setup
open333 login --host https://api.example.com --email agent@company.com --profile production
# (will prompt for password securely)
```

**Read-only operations** (safe for automation):

```bash
open333 status --json                    # Health + identity check
open333 stats --from 2026-07-01 --to 2026-07-08 --json  # Weekly report
open333 stats --group-by week --json     # Trend analysis
open333 apis --json                      # Discover available endpoints
```

**Profile management**:

```bash
open333 login --profile staging          # Add second environment
open333 status --profile staging         # Use specific profile
```

### For LLMs Extending This CLI

1. **Follow existing patterns**: Separate pure function (`xxxCommand`) from oclif class
2. **Always handle errors**: Use `CliError` with codes (`PROFILE_MISSING`, `INSUFFICIENT_SCOPE`, `API_ERROR`)
3. **Support `--json` flag**: Enable programmatic consumption
4. **Use `config-store.ts` / `credential-store.ts`**: Never handle tokens directly
5. **Add backend scope + route**: CLI commands need matching API endpoints with scope checks
6. **Update `cli-endpoints.ts`**: Makes `open333 apis` auto-discover new commands

---

## Common Pitfalls

| Issue                             | Solution                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `PROFILE_MISSING`                 | Run `open333 login` first or specify `--profile`                                                           |
| `INSUFFICIENT_SCOPE`              | Token needs additional scope; re-login with admin-granted scopes or ask admin to update token scopes in DB |
| Token expired                     | Re-run `open333 login` (tokens expire in 30 days by default)                                               |
| `ECONNREFUSED`                    | Check `--host` value; API runs on port 3001 by default                                                     |
| TypeScript errors on Prisma enums | Use string literals (`role: { in: ['ADMIN'] }`) not Prisma enum imports                                    |

---

## Related Files

| File                                               | Purpose                              |
| -------------------------------------------------- | ------------------------------------ |
| `apps/cli/src/index.ts`                            | oclif entry point                    |
| `apps/cli/src/commands.ts`                         | Command registry                     |
| `apps/cli/src/commands/*.ts`                       | Individual command implementations   |
| `apps/cli/src/api-client.ts`                       | Authenticated fetch wrapper          |
| `apps/cli/src/config-store.ts`                     | Profile persistence (conf)           |
| `apps/cli/src/credential-store.ts`                 | Token storage (keytar)               |
| `apps/cli/src/types.ts`                            | Shared TypeScript interfaces         |
| `apps/api/src/modules/cli/cli.routes.ts`           | CLI API routes                       |
| `apps/api/src/modules/cli/cli-endpoints.ts`        | Capability/endpoint definitions      |
| `apps/api/src/modules/auth/cli-session.service.ts` | Token creation, verification, scopes |
| `packages/database/prisma/schema.prisma`           | `CliSession` model                   |

---

## Version & Publishing

```bash
# Version bump + publish (from apps/cli)
npm version patch|minor|major
npm publish --access public
```

Published as `@open333crm/cli` on npm (GPL-3.0-only).