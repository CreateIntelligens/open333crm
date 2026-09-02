# Agent runner supplement

**Read [`AGENTS.md`](../AGENTS.md) first. It is the single source of truth** for this repo:
tech stack, multi-tenancy and RLS rules, which Prisma client to use, socket event routing,
CI gates, conventions, environment gotchas, and monorepo layout.

This file adds **only what is specific to generic agent runners reading `.agent/`**. Do not copy
project facts here. A second copy diverges from the first, and then the two files contradict
each other.

## Assets in this directory

- `.agent/workflows/` — OpenSpec workflows (`opsx-propose`, `opsx-apply`, `opsx-archive`, `opsx-explore`).
- `.agent/skills/` — the four OpenSpec skills. `.claude/skills/` holds further project skills
  that this directory does not mirror. Read that directory as well before you start work.
