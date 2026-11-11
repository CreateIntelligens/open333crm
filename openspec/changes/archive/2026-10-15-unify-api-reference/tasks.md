## 1. Route inventory contract

- [x] 1.1 Implement a deterministic generator that collects all statically declared Fastify HTTP routes and fails on unresolved registrations.
- [x] 1.2 Generate the OpenAPI document with route tags and an explicit marker for undocumented request/response contracts.

## 2. Redoc entry point

- [x] 2.1 Add the Redoc API reference page and grouped navigation.
- [x] 2.2 Add package scripts needed to regenerate the OpenAPI document.

## 3. Documentation

- [x] 3.1 List the MCP HTTP transport and document Socket.IO and MCP JSON-RPC as separate protocol interfaces.
- [x] 3.2 Update `CHANGELOG.md` under the latest dated release section.
- [x] 3.3 Validate the change with `pnpm exec openspec validate --strict unify-api-reference`; inspect the existing main-spec warnings separately.
- [x] 3.4 Regenerate the document and inspect its route count, grouped tags, and protocol boundaries.
