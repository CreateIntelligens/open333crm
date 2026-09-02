# CLAUDE.md — Claude Code supplement

**Read [`AGENTS.md`](../AGENTS.md) first. It is the single source of truth** for this repo:
tech stack, multi-tenancy and RLS rules, which Prisma client to use, socket event routing,
CI gates, conventions, environment gotchas, and monorepo layout.

This file adds **only what is specific to Claude Code**. Do not copy project facts here.
A second copy diverges from the first, and then the two files contradict each other.

## Skills in this repo

Available under `.claude/skills/`:

| Skill | Use when |
| ----- | -------- |
| `postgres-rls-tenant-isolation` | You work on Postgres RLS: you add a table, you wire a route or service to the correct Prisma client, or you debug a query that returns empty or 403. **This skill exists only here, not in the other tool directories.** |
| `simplified-technical-chinese` | You write or revise a Traditional Chinese technical document. Apply it before you finalize the text. |
| `open333crm-cli` | You build, test or extend the `open333` CLI (`apps/cli`). |
| `openspec-propose` / `openspec-apply-change` / `openspec-archive-change` / `openspec-explore` | You run the OpenSpec propose, apply or archive cycle. |

`.claude/commands/opsx/` contains the slash commands for the same OpenSpec cycle:
`/opsx:propose`, `/opsx:apply`, `/opsx:archive`, `/opsx:explore`.

## Working style in this repo

- Traditional Chinese technical documents must pass through the `simplified-technical-chinese`
  skill before you finalize them. This covers READMEs, design documents, PR descriptions, code
  review comments and OpenSpec documents.
- `CHANGELOG.md` is mandatory for every `feat` / `fix` / architecture change — see AGENTS.md.
