# API Reference

The browsable HTTP API reference is available at `/api-reference` in the web application. Its OpenAPI document is generated at `apps/web/public/openapi.json` from the route declarations and mount prefixes in `apps/api/src/index.ts`.

Regenerate the document after changing an API route:

```bash
pnpm api:docs:generate
```

The current catalog contains all statically registered HTTP operations, including the MCP Streamable HTTP transport endpoint. Path parameters are represented in OpenAPI. Request and response schemas are marked `undocumented` until the route contract is added. MCP JSON-RPC methods and Socket.IO events use separate protocol documentation.
