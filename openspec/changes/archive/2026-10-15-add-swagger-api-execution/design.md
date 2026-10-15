# Design

The existing OpenAPI document remains the shared source for both documentation views. The Swagger UI page loads the official Swagger UI distribution from a pinned CDN version and reads `/openapi.json`.

Use `/` as the server URL so Try it out sends requests to the same host serving the documentation. Add a Bearer HTTP security scheme to operations detected as authenticated from their route hooks and pre-handlers. Keep public operations unauthenticated in the OpenAPI document.

For write methods without an authored schema, expose a generic JSON object editor and retain the `x-contract-status: undocumented` marker. Do not present the generic body as the true API contract. Keep authorization in memory for the current page session only.
