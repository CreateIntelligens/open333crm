# open333crm Web E2E Tests

Playwright end-to-end tests for the web app, with HTML report (screenshots + trace).

## Prerequisites

- Docker services running: `docker compose up -d` (Postgres on 5433, Redis on 6380, Ollama, MinIO)
- API running: `pnpm --filter @open333crm/api dev` (port 3001)
- Demo seed data loaded: `pnpm db:seed`

The test runner spawns its own Next.js dev server on **port 3020** (override with `E2E_PORT`).

## Run

```bash
# install browsers (first time)
pnpm --filter @open333crm/web-e2e install:browsers

# run all tests
pnpm --filter @open333crm/web-e2e test

# UI mode (interactive)
pnpm --filter @open333crm/web-e2e test:ui

# headed mode (watch tests run in real browser)
pnpm --filter @open333crm/web-e2e test:headed

# open the last HTML report
pnpm --filter @open333crm/web-e2e report
```

## Report

After a run, the HTML report is written to `playwright-report/index.html` and contains:

- Pass/fail summary per spec
- Per-test step trace
- **Success snapshots** (every test takes a final screenshot via `snap()`)
- **Failure traces** (full DOM snapshot + network log + video on failure)

## Coverage

Tests cover all 11 dashboard pages plus auth:

| Spec | Pages / flows |
|---|---|
| `auth.spec.ts` | login fail / success, session persistence |
| `inbox.spec.ts` | conversation list, select, send message, AI suggest, create case |
| `cases.spec.ts` | list, filters, tabs, search, detail navigation |
| `contacts.spec.ts` | list, search, detail navigation |
| `automation.spec.ts` | rule list |
| `marketing.spec.ts` | template / campaign list |
| `knowledge.spec.ts` | article list, settings |
| `analytics.spec.ts` | charts load |
| `notifications.spec.ts` | notification list |
| `portal.spec.ts` | activity list |
| `shortlinks.spec.ts` | link list |
| `settings.spec.ts` | each tab |

## Demo credentials

Hardcoded in `tests/helpers/auth.ts`:
- `admin@demo.com` / `admin123`

Make sure `pnpm db:seed` has been run.
