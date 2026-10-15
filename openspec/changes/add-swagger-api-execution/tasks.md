## 1. OpenAPI execution metadata

- [x] 1.1 Add a unit test for same-origin server, auth metadata, and generic JSON body generation.
- [x] 1.2 Implement per-operation Bearer security detection and the same-origin server entry.
- [x] 1.3 Add generic JSON bodies for write operations that lack authored schemas; regenerate `openapi.json` during deployment.

## 2. Swagger UI

- [ ] 2.1 Verify the standalone HTML loads the OpenAPI URL, enables Try it out, and keeps authorization session-only.
- [x] 2.2 Add the standalone Swagger UI document and link to it from Redoc.
- [x] 2.3 Document execution requirements and limitations.

## 3. Verification and release

- [x] 3.1 Update `CHANGELOG.md` under the latest dated release section.
- [x] 3.2 Validate the OpenSpec change and main specs.
- [ ] 3.3 Deploy through the UAT workflow and test the page, OpenAPI document, CDN, and a safe GET request over SSH.
