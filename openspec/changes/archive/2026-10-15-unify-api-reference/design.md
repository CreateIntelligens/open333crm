# Design

## Context

Fastify route modules are mounted in `apps/api/src/index.ts`. Route files use a mix of inline validation and Zod parsing, so the current code does not expose complete OpenAPI request and response schemas. Redoc renders an OpenAPI document; it does not infer the contract from Fastify handlers.

## Approach

- Generate the initial OpenAPI path inventory from the registered Fastify route declarations and their mount prefixes.
- Keep generated route inventory separate from authored descriptions and schemas so regeneration cannot erase human-authored details.
- Render the bundled OpenAPI document from a dedicated Next.js API reference page using Redoc.
- Add a clear `x-contract-status` marker for operations whose request or response schema is not yet documented.
- Include the MCP Streamable HTTP transport path and identify JSON-RPC methods as protocol documentation.
- Document Socket.IO as a separate non-HTTP interface.

## Constraints

- Route inventory generation must be deterministic and fail when it cannot resolve a registered route path or mount prefix.
- Do not execute application bootstrap to generate documentation; bootstrap starts external services and workers.
- Do not claim undocumented request or response shapes as complete contracts.

## Risks

- Dynamic plugin routes may not have a literal path in the current source. The generator must report unresolved registrations so the inventory does not silently omit them.
- An initial route catalog provides discoverability, while detailed request and response schemas will require incremental authoring alongside route changes.
