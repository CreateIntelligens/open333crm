## 1. Spec / 提案文件

- [x] 1.1 寫 proposal.md（Why / What Changes / Capabilities / Impact / Non-Goals）
- [x] 1.2 寫 design.md（行為矩陣、決策理由、Trade-offs）
- [x] 1.3 寫 spec delta（specs/km-ingestion/spec.md）
- [x] 1.4 寫 tasks.md（本檔）
- [x] 1.5 開 docs PR，等 Stanley + 內部 review 規格（PR #116）

## 2. Service Layer 改動

- [x] 2.1 在 `apps/api/src/modules/knowledge/partner-ingest.service.ts` 加 `parseCmd(raw)`：value trim + 大寫化、驗證屬於 `CREATE`/`UPDATE`/`DELETE`，否則 throw `AppError('...', 'INVALID_CMD', 400)`
- [x] 2.2 在 `PartnerDocInput` 介面新增 `cmd: PartnerCmd` 必填欄位
- [x] 2.3 把 `PartnerIngestResult.status` 型別擴充為 `'created' | 'updated' | 'deleted' | 'revived' | 'skipped'`
- [x] 2.4 重寫 `ingestPartnerDoc()`：先 lookup existing (含 `status`)，依 `cmd` 分流到 `handleDelete()` / 衝突檢查 / `writeArticle()`
- [x] 2.5 新增 `handleDelete()`：existing 不存在或已 ARCHIVED → idempotent；PUBLISHED → `status=ARCHIVED` + `embedding=NULL` (`UPDATE km_articles SET embedding = NULL WHERE id = $1::uuid`)
- [x] 2.6 抽出 `writeArticle()`：原本 4a/4b 的 update/create 分支，含附件整批替換、fire-and-forget embedding；ARCHIVED → PUBLISHED 時 status 標 `revived`

## 3. Route Handler 改動

- [x] 3.1 `apps/api/src/modules/knowledge/knowledge.routes.ts` import `parseCmd` + `AppError`
- [x] 3.2 在 `/partner-ingest` handler 內讀 `fields.cmd`、呼叫 `parseCmd(fields.cmd)`
- [x] 3.3 `cmd === 'DELETE'` 時將 `attachments` 傳成空陣列（不浪費頻寬寫 S3，使用者就算誤傳也忽略）
- [x] 3.4 catch 區段優先處理 `AppError`，回 `err.statusCode` + `{ code, message }`；其他 error 回 500 `INGEST_FAILED`
- [x] 3.5 更新 route 上方註解，列出新欄位 `cmd`

## 4. 錯誤碼

- [x] 4.1 `INVALID_CMD` (400)：在 `parseCmd` 內 throw
- [x] 4.2 `BAD_REQUEST` (400)：DocID 缺值
- [x] 4.3 `DOCID_CONFLICT` (409)：CREATE 對已存在 PUBLISHED DocID
- [x] 4.4 `DOCID_NOT_FOUND` (404)：UPDATE 對不存在或 ARCHIVED DocID
- [x] 4.5 `INGEST_FAILED` (500)：未預期錯誤兜底

## 5. Build / Type Check

- [x] 5.1 `pnpm --filter @open333crm/api build` 零 TS error
- [x] 5.2 確認 PR #115（automation/sla 搬 worker）的改動不影響 partner-ingest 的 import 路徑（無 import 衝突）

## 6. Manual QA（合 PR 前）

- [ ] 6.1 `cmd=CREATE` 新 DocID → 200 `status=created`，KB 後台看得到 PUBLISHED 文章
- [ ] 6.2 `cmd=CREATE` 已存在 PUBLISHED DocID → 409 `DOCID_CONFLICT`
- [ ] 6.3 `cmd=UPDATE` 帶 Ver 較大 → 200 `status=updated`，附件被整批替換、向量重算
- [ ] 6.4 `cmd=UPDATE` 帶相同/較小 Ver → 200 `status=skipped`
- [ ] 6.5 `cmd=UPDATE` 對不存在 DocID → 404 `DOCID_NOT_FOUND`
- [ ] 6.6 `cmd=DELETE` 既有 PUBLISHED DocID → 200 `status=deleted`，KB 後台變 ARCHIVED，`semanticSearch` 不再吐回
- [ ] 6.7 `cmd=DELETE` 同 DocID 第二次 → 200 idempotent (`reason=already archived`)
- [ ] 6.8 `cmd=DELETE` 完全不存在的 DocID → 200 idempotent (`reason=not found`)
- [ ] 6.9 `cmd=CREATE` 對已 ARCHIVED 的 DocID + 較大 Ver → 200 `status=revived`，重新可被 RAG 檢索
- [ ] 6.10 缺 `cmd` 欄位 → 400 `INVALID_CMD`

## 7. Spec Sync（at archive）

- [x] 7.1 把 `specs/km-ingestion/spec.md`（本 change 內的 delta）合進主 spec `openspec/specs/km-ingestion/spec.md`
- [x] 7.2 CHANGELOG.md `[Unreleased]` `### Added` 補 partner-ingest cmd 條目
- [ ] 7.3 通知 Stanley 規格已正式上線、可開始改他那端
