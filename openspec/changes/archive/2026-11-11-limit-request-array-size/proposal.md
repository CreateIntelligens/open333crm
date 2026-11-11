## Why

API 的路由用 `zod/v3` 驗證請求內容。GHSA-mrhx-c7xc-m3w5：陣列裡每個不合格的元素都產生一筆錯誤，數量沒有上限。Zod 4.6.6 的修補只對 v4 的 API 生效，`zod/v3` 相容層沒有修補，`.max()` 也擋不住（`zod/v3` 仍然逐一驗證每個元素）。issue #382 實測：200,000 個數字送進 `z.array(z.string()).max(10)` 產生 200,001 筆錯誤，heap 增加約 83MB。API 的 `bodyLimit` 是 30MB，可以容納約 1,500 萬個元素，任何人都能從外部讓 API 記憶體不足。`z.record()` 對每個不合格的值也各產生一筆錯誤，問題相同。

issue #382 的使用者選了做法 B：繼續用 `zod/v3`，在進入 Zod 之前限制請求內容。為了不讓新路由漏掉，限制做在全域的 JSON 解析這一層，而不是每個路由各自設限。

## What Changes

- 全域取代 Fastify 的 `application/json` 解析器：解析之前先以迭代方式掃描原始文字，不建立物件。超過下列任何一個上限就回 400，不呼叫 `JSON.parse`，也不進入路由與 Zod：
  - 單一陣列的元素數：預設 10,000（`PAYLOAD_ARRAY_TOO_LARGE`）。
  - 單一物件的欄位數：預設 10,000（`PAYLOAD_OBJECT_TOO_LARGE`）。
  - 整個請求的陣列元素與物件欄位總數：預設 100,000（`PAYLOAD_TOO_MANY_ENTRIES`）。
  - 巢狀深度：預設 64 層（`PAYLOAD_TOO_DEEP`）。
- 錯誤訊息是中文，`details` 帶超過上限的位置（`path`）與上限值（`limit`）。
- 四個上限可以用環境變數覆寫（`REQUEST_JSON_MAX_ARRAY_LENGTH`、`REQUEST_JSON_MAX_OBJECT_KEYS`、`REQUEST_JSON_MAX_TOTAL_ENTRIES`、`REQUEST_JSON_MAX_DEPTH`），放在 `apps/api/src/config/env.ts` 的 schema。
- 路由可以用 route config `jsonPayloadLimits` 調高自己的上限。本 change 只調高 `POST /api/v1/knowledge/import`（陣列 50,000、總數 500,000）：JSON 匯入檔的外層是文章陣列，前端不限筆數，一篇文章約 7 個欄位，總數 100,000 在約 14,000 篇時就會擋下。
- 進站 webhook（LINE、Meta、FB、IG）用自己的解析器取得原始內容驗簽，改為在同一個解析器裡也做相同的掃描。
- 全域 `bodyLimit` 維持 30MB，原因見 design.md。

## Capabilities

### New Capabilities

- `request-payload-limits`：API 在解析 JSON 請求內容之前限制陣列長度、物件欄位數、總數與深度。

### Modified Capabilities

無。`openspec/specs/` 沒有描述 API 請求內容大小或輸入驗證層的需求（`api-bootstrap` 只描述啟動入口）。

## Impact

- `apps/api/src/plugins/json-payload-guard.plugin.ts`（新）、`apps/api/src/shared/utils/json-payload-limits.ts`（新）
- `apps/api/src/config/env.ts`、`apps/api/src/index.ts`
- `apps/api/src/modules/webhook/webhook.routes.ts`：先移除繼承的 JSON 解析器再加自己的（根層已不是 Fastify 預設解析器，直接加會丟 `FST_ERR_CTP_ALREADY_PRESENT`），並呼叫同一個掃描。
- `apps/api/src/modules/knowledge/knowledge.routes.ts`：`/import` 加 route config。
- API 用戶看得到的行為：超過上限的請求從「進入 Zod 驗證」變成 400。目前所有前端送出的內容都遠低於上限。
- 不影響 multipart 上傳（另一個解析器）與查詢字串。

## Platform layer

本 change 沒有新增權限碼、功能區、方案上限、AI 呼叫、渠道類型、租戶設定、平台稽核動作、佇列或租戶與平台之間的申請，所以平台層的表格沒有任何一項適用。上限是整個 API 行程的設定，不分租戶或方案。
