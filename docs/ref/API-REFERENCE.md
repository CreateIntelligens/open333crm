# API Reference

The browsable HTTP API reference is available at `/api-reference`. The standalone Swagger UI console is available at `/swagger-ui.html`; it loads the same OpenAPI document and supports Try it out against the current origin. Its OpenAPI document is generated at `apps/web/public/openapi.json` from the route declarations and mount prefixes in `apps/api/src/index.ts`.

Regenerate the document after changing an API route:

```bash
pnpm api:docs:generate
```

The current catalog contains all statically registered HTTP operations, including the MCP Streamable HTTP transport endpoint. Path parameters and detected Bearer authorization are represented in OpenAPI. Operations without authored body schemas receive a generic editable JSON body in Swagger UI and remain marked `undocumented`. MCP JSON-RPC methods and Socket.IO events use separate protocol documentation. Authorization entered in Swagger UI is kept for the page session only.
