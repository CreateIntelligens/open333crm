# GitHub Copilot supplement

**Read [`AGENTS.md`](../AGENTS.md) first. It is the single source of truth** for this repo:
tech stack, multi-tenancy and RLS rules, which Prisma client to use, socket event routing,
CI gates, conventions, environment gotchas, and monorepo layout.

This file adds **only what is specific to GitHub Copilot**. Do not copy project facts here.
A second copy diverges from the first, and then the two files contradict each other.

## Commit trailer

Commits authored with Copilot must include:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Copilot assets in this repo

- `.github/prompts/` — OpenSpec prompt files (`opsx-propose`, `opsx-apply`, `opsx-archive`, `opsx-explore`).
- `.github/skills/` — the four OpenSpec skills. The `postgres-rls-tenant-isolation` and
  `open333crm-cli` skills exist only under `.claude/skills/`. To work on RLS or the CLI, read that
  skill directory directly.

## CI

`.github/workflows/ci.yml` runs the build and two `--strict` tenant-isolation gates.
`.github/workflows/deploy.yml` deploys to UAT on every push to `main`. `AGENTS.md` describes both
workflows.
