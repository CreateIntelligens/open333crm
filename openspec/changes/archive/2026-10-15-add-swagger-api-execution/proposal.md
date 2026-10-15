# Proposal

## Why

The Redoc page provides a polished reference but has no request execution panel. API users need an interactive console to submit requests against the current environment and inspect responses.

## What Changes

- Add a Swagger UI page that loads the existing OpenAPI document and enables Try it out.
- Set the document server to the same origin and expose Bearer authorization for protected routes.
- Provide an editable generic JSON body where the current route inventory has no authored request schema.
- Link Redoc and Swagger UI as two views of the same API document.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `api-reference`: add interactive request execution alongside the reference view.

## Impact

- `apps/api/src/lib/openapi-inventory.mjs` and generated `apps/web/public/openapi.json`.
- `apps/web/public/swagger-ui.html` and the API reference page links.
- `docs/ref/API-REFERENCE.md` and `CHANGELOG.md`.
