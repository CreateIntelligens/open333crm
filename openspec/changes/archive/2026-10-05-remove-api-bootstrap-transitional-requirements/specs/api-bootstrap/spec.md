## REMOVED Requirements

### Requirement: Transitional Entrypoints Must Delegate

**Reason**: No transitional bootstrap file remains. Commit `10a80f8c` (2026-03-31) deleted `apps/api/src/main.ts`, and no other file under `apps/api/src/` constructs a Fastify server. The requirement describes a file that does not exist.

**Migration**: None. "Single Authoritative API Entrypoint" still requires `apps/api/src/index.ts` to be the only bootstrap. A new bootstrap file would violate that requirement.

### Requirement: Bootstrap Consolidation Preserves Active Runtime Behavior

**Reason**: The requirement records a one-time consolidation of the bootstrap into `apps/api/src/index.ts`. The consolidation is complete, so the requirement describes no behavior that the system keeps.

**Migration**: None. Route, plugin, channel and worker registration stays in `apps/api/src/index.ts` under "Single Authoritative API Entrypoint".
