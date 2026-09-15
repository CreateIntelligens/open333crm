## 1. Dependencies and model assets

- [x] 1.1 Add pinned `file-type` and `magika` runtime dependencies to `apps/api/package.json`, update the pnpm lockfile, and verify `pnpm install --frozen-lockfile` succeeds
- [x] 1.2 Add the pinned Magika model/config assets to the API image with documented checksums, preload them during API startup, and verify runtime does not fetch model files
- [x] 1.3 Define the supported canonical type and route allowlists for media, imagemap, knowledge documents, partner attachments, and generic storage; verify unsupported executable/archive types are rejected by policy tests
- [x] 1.4 Add `UPLOAD_CONTENT_DETECTION_ENABLED` to environment examples with default enabled and verify false mode emits a startup warning and is documented as emergency-only
- [x] 1.5 Upgrade API, Web, Workers, CLI engine, and dev images to Node 24 LTS/bookworm-slim, and verify all runtime references no longer target Node 20

## 2. Content detector

- [x] 2.1 Write detector tests for valid magic bytes, forged client MIME, mismatched extension, unknown binary, low-confidence Magika output, and valid PDF/DOCX/XLSX/text fixtures; verify the new tests fail before the detector is implemented
- [x] 2.2 Implement the shared bytes detector using deterministic magic-byte checks followed by the startup-preloaded Magika client, and verify accepted results include canonical MIME/label/confidence/reason
- [x] 2.3 Implement fail-closed behavior and bounded diagnostic logging, and verify detector/model errors do not expose file bytes, full text, or sensitive metadata

## 3. Multipart upload enforcement

- [x] 3.1 Add a shared upload-validation helper that checks content before storage, transformation, parser, or database side effects; verify valid fixtures pass and mismatches return the project’s standard 4xx error
- [x] 3.2 Apply validation to conversation image/video, generic storage upload, and LINE imagemap upload routes; verify rejected files do not create storage objects or outbound messages
- [x] 3.3 Apply validation to knowledge upload and partner attachment ingestion; verify rejected files do not reach PDF, DOCX, XLSX, CSV, HTML, or Markdown parsers

## 4. Presigned upload quarantine

- [x] 4.1 Extend the storage service/provider with tenant-scoped quarantine key generation, bounded object reads, promotion, and cleanup; verify cross-tenant keys are rejected and failed promotion removes or invalidates the quarantine object
- [x] 4.2 Change presign responses to target quarantine objects and add an authenticated complete/scan endpoint that promotes only validated files; verify successful and rejected lifecycle tests
- [x] 4.3 Update any frontend/integration callers and `docs/09_API_DESIGN.md`/`docs/12_TEMPLATE_AND_STORAGE.md` for the breaking complete/scan contract; verify no repo consumer uses a presigned object before completion

## 5. Verification and release documentation

- [x] 5.1 Run focused detector and upload-route tests plus parser regressions, and verify existing supported image, video, knowledge, and partner flows remain functional
- [x] 5.2 Run `pnpm --filter @open333crm/api build`, Docker build, and relevant security/dependency checks; record unrelated pre-existing failures separately
- [x] 5.3 Update README and `CHANGELOG.md` under the latest date-only release heading with upload content detection, feature-flag rollback, and presigned quarantine behavior, then run `openspec validate add-upload-content-type-detection --type change --strict`

> Verification notes: UAT Docker build `34200625751` succeeded on Node 24 ARM64 after source-compiling tfjs-node; the container contains `tfjs_binding.node`, Magika local preload/inference passed, and API/HTTPS health returned 200. Local API TypeScript build still reports pre-existing Prisma client drift for PlatformUser fields. `pnpm audit --prod --audit-level=high` reports existing dependency findings plus tfjs-node's transitive `tar@6.2.1`; this is build/runtime dependency risk to track separately.
