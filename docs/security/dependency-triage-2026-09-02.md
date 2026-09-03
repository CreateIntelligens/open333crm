# Dependency Security Triage — 2026-09-02

The dependency graph was scanned with `pnpm audit --audit-level high` after installation. The triage below separates production-reachable runtime paths from development and build tooling.

| Package/path | Reachability | Result | Verification |
| --- | --- | --- | --- |
| `xlsx@0.18.5` in API knowledge uploads | Production, untrusted spreadsheet input | Replaced with `@e965/xlsx@0.20.3`, which supplies the maintained SheetJS-compatible API | `knowledge-file-parser.test.ts` and API build |
| `engine.io@6.6.6` through API Socket.IO | Production, polling transport | Locked to `6.6.9` through the root override | Socket authorization tests, API build, post-change audit |
| `socket.io-parser@4.2.6` through API Socket.IO | Production realtime transport | Locked to `4.2.7` through the root override | Socket authorization tests, API build, post-change audit |
| `sharp@0.34.5` in API/storage and Next image tooling | Production upload/image paths and web build | Upgraded/locked to `0.35.4` | API build, web build, post-change audit |
| `postcss` under Next and web tooling | Build-time CSS processing | Locked to `8.5.26` | Web build, post-change audit |
| `find-my-way`, `fast-uri`, `nanoid` | API/build transitive paths | Locked to patched compatible versions where applicable | API build, post-change audit |
| Vite, ESLint, Tailwind `picomatch`/`brace-expansion`, Browserslist, Prisma CLI `deepmerge-ts` | Development or build tooling; no production request path | Tracked for the next tooling refresh; no runtime exposure established | `pnpm audit` path evidence and package usage review |

The remaining high-severity count is not zero because the advisory database includes development/build dependencies without a compatible minimal patch in the current major lines. No reachable high-severity upload-parser, Socket.IO transport, sharp, or PostCSS finding is accepted silently. Any future deferral must add an owner, compensating control, and review date here.
