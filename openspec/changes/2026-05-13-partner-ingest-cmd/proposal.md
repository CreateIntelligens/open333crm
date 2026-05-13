## Why

合作方（Stanley 的 Chatbot feeder）目前透過 `POST /api/v1/knowledge/partner-ingest` 推送知識點，動作（建立 / 更新 / 移除）是靠後端比較 `Ver` 的大小**隱式推導**——`Ver` 較大視為更新、相同/較小視為略過，**沒有刪除語意**。這造成兩個問題：

1. **語意不明**：對方無法在 request 中明確表達「我要刪除這筆知識點」。目前若一個 DocID 不再使用，知識庫端就會一直留著舊資料、繼續被 RAG 檢索吐回。
2. **錯誤回饋模糊**：當對方推送出錯（例如 DocID 拼錯、Ver 重複），後端只能回統一的 200 + `status=skipped`，對方系統難以對帳。

Stanley 已正式要求加入 `cmd` 欄位（CREATE / UPDATE / DELETE）來明確指定動作。雙方約定**硬切**（不做向後相容 fallback），所以本次規格上線時對方系統會同步更新。

## What Changes

- `POST /api/v1/knowledge/partner-ingest` 新增**必填**欄位 `cmd`（值：CREATE / UPDATE / DELETE）
- 行為矩陣（詳見 design.md）：
  - **CREATE**：DocID 不存在 → 建立；DocID 已存在且 PUBLISHED → 409；DocID 已存在且 ARCHIVED → 復活（覆蓋內容 + 附件，status=PUBLISHED）
  - **UPDATE**：DocID 存在 PUBLISHED 且 `Ver` 嚴格遞增 → 整批覆蓋內容 + 附件、重算 embedding；不存在或 ARCHIVED → 404；`Ver` ≤ 既有 → 200 `status=skipped`
  - **DELETE**：軟刪——`status` 轉為 `ARCHIVED`、`embedding` 清空；附件保留（供未來稽核）；不存在或已 ARCHIVED → 200 idempotent
- 新增 HTTP 錯誤碼：
  - `400 INVALID_CMD`：`cmd` 缺值或非三者之一
  - `404 DOCID_NOT_FOUND`：UPDATE 找不到 DocID
  - `409 DOCID_CONFLICT`：CREATE 已存在 PUBLISHED DocID
- 既有 `Ver` 嚴格遞增保護**保留**：CREATE/UPDATE 收到 `Ver` ≤ 既有 → `status=skipped`（防止亂序重送把新版蓋成舊版）
- 既有附件「整批替換」語意**保留**：UPDATE / 復活時先刪舊附件再寫新的；DELETE 不動附件

## Capabilities

### Modified Capabilities

- **`km-ingestion`**：合作方推送的動作由必填 `cmd` 欄位明確指定，取代「靠 `Ver` 隱式推導」的舊行為；新增軟刪（ARCHIVED）語意，且 ARCHIVED 文章自動排除於 RAG 檢索之外

## Impact

### 程式碼

- `apps/api/src/modules/knowledge/partner-ingest.service.ts` — 主要邏輯，重寫 `ingestPartnerDoc()`，依 `cmd` 分流；新增 `parseCmd()`、`handleDelete()`、`writeArticle()`
- `apps/api/src/modules/knowledge/knowledge.routes.ts` — 解析 multipart 多一個 `cmd` 欄位，錯誤改走 `AppError` 對應正確 HTTP code

### Spec

- `openspec/specs/km-ingestion/spec.md` — 追加 Partner Doc Mutation Command 段落（在 archive 階段合進主 spec）

### 不需要

- **無 schema 變動**：`KmStatus.ARCHIVED` 已存在於 `packages/database/prisma/schema.prisma`；KB retrieval（`apps/api/src/modules/embedding/embedding.service.ts:118`）原本就 `WHERE status='PUBLISHED'`，ARCHIVED 自動排除
- **不搬 worker**：partner-ingest 同步寫 DB + S3 是繼承既有設計（HTTP 要回 status 給對方），本次只動行為語意；架構性的 worker 化另開 proposal
- **不需 migration**

## Non-Goals

- 把 partner-ingest 改成走 BullMQ queue（API 回應從同步變非同步會破壞對方對接，需另外規劃）
- ARCHIVED 文章的清理 worker（30 天後實體刪除）——附件先保留供稽核，未來再加
- 任何對前端 KB 文章管理頁面的改動（手動建立的 KmArticle 不受影響）
