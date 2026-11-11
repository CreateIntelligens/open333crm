## Context

issue #382 第 1 項。`apps/api` 的路由以 `import { z } from 'zod/v3'` 驗證請求內容，多數在 handler 裡呼叫 `schema.parse(request.body)`。`zod/v3` 對陣列與 `z.record()` 的每個不合格項目各產生一筆錯誤，數量沒有上限。使用者選了做法 B：不換 Zod API，在進入 Zod 之前限制。

## Goals / Non-Goals

**Goals**

- 新路由不需要做任何事就受到保護。
- 擋下的請求不建立大型物件：在 `JSON.parse` 之前就拒絕。
- 合法的請求不受影響；少數需要大陣列的路由可以調高上限。

**Non-Goals**

- 不改 Zod 的版本或 API（做法 A）。
- 不處理 issue #382 第 2、3 項（`decode-uri-component`、minio patch）。

## Decisions

### D1：在 JSON 解析器掃描原始文字，不用 preValidation hook

preValidation 時 Fastify 已經用 `JSON.parse` 建好整個物件。30MB 的 `[1,1,1,…]` 約 1,500 萬個元素，光是建立陣列就要上百 MB。改成取代根層的 `application/json` 解析器（`parseAs: 'string'`）：

1. 以單一迴圈掃描文字，追蹤字串、跳脫字元與每一層容器的計數，不遞迴、不建立物件。
2. 超過上限就 `done(new AppError(...))`，錯誤由 `error-handler.plugin.ts` 的 `AppError` 分支回應。
3. 沒有超過上限才交給 `fastify.getDefaultJsonParser(onProtoPoisoning, onConstructorPoisoning)`，保留 Fastify 預設的 `__proto__`／`constructor` 防護與錯誤格式。

掃描不驗證 JSON 語法；格式錯誤的內容由後面的預設解析器回錯。字串裡的 `[`、`,`、`{` 不計數。

錯誤的 `path` 只在超過上限時才計算：每一層記下目前欄位名稱在原文中的起訖位置，失敗時才解碼，平常不多花成本。格式與 Zod 的 `issue.path.join('.')` 相同（例如 `items.0.tags`），根層是空字串。

### D2：四個上限與預設值

| 上限 | 預設 | 理由 |
| --- | --- | --- |
| 單一陣列元素數 | 10,000 | 目前 schema 中最大的陣列上限是 1,000（發券對象）；webhook 的 `events`／`entry` 遠小於此 |
| 單一物件欄位數 | 10,000 | `z.record()` 有同樣的放大問題（`member-binding` 的 `lookupInputSchema` 等 32 處） |
| 陣列元素與物件欄位總數 | 100,000 | 防止「很多個 9,999 的陣列」繞過單一陣列上限。最壞情況約 10 萬筆 Zod 錯誤，約 40MB，而不是數 GB |
| 巢狀深度 | 64 | Flex 訊息與互動流程的 JSON 不超過 20 層；限制深度讓後續的遞迴處理不會堆疊溢位 |

四個值都放在 `env.ts` 的 schema（`REQUEST_JSON_MAX_*`），格式錯誤時 API 拒絕啟動，與其他設定相同。

### D3：路由調高上限

路由以 `config: { jsonPayloadLimits: { maxArrayLength, ... } }` 覆寫部分上限，未給的欄位沿用全域值。只能調整數值，不能關閉檢查。

盤點結果：

| 入口 | 陣列來源 | 決定 |
| --- | --- | --- |
| `POST /knowledge/import` | 前端把 JSON 檔外層陣列整份送出，不限筆數 | 調高：陣列 50,000、總數 500,000（需要 `knowledge.manage`） |
| `POST /knowledge/upload`、`/knowledge/partner-ingest`、`/files/*` 等上傳 | multipart，不走 JSON 解析器 | 不受影響 |
| `POST /coupons/:id/codes` | 序號清單是單一字串（最多 2,000,000 字），不是陣列 | 不受影響 |
| 發券、群發受眾 `contactIds` | schema 上限 1,000 | 不需要調整 |
| 進站 webhook LINE／Meta／FB／IG | 外部平台送的 `events`、`entry` | 不需要調整，見 D4 |
| MCP、CLI、平台後台 | 陣列都是少量 id 或權限碼 | 不需要調整 |

### D4：進站 webhook

`webhook.routes.ts` 在自己的封裝範圍內加了 `application/json` 解析器（`parseAs: 'buffer'`）保留原始內容驗簽。根層的解析器不再是 Fastify 預設解析器後，子範圍直接加會丟 `FST_ERR_CTP_ALREADY_PRESENT`，所以先 `removeContentTypeParser('application/json')` 再加。

webhook 的內容不經過 Zod，但仍然是可以從外部送入的大型 JSON，所以在同一個解析器裡呼叫相同的掃描。LINE 一次送出的 `events` 是個位數到數十筆；Meta 的 `entry` 批次最多約 1,000 筆，遠低於 10,000。

### D5：全域 `bodyLimit` 維持 30MB

查證結果：

- `@fastify/multipart` 的解析器不是 `parseAs` 型，Fastify 不對它套用 `bodyLimit`。`index.ts` 的註解「必須 ≥ multipart fileSize」不正確：上傳大小只受 `limits.fileSize`（25MB）限制。
- 真正用到大 JSON 的入口：知識庫匯入與文章內容（102 萬字的文章約 3MB）、優惠券序號（最多 2,000,000 字）、MCP 的文章工具、進站 webhook。

降低全域 `bodyLimit` 需要逐一確認所有 JSON 入口（包括 MCP、A2A、外部 webhook），漏掉一個就會讓該功能回 413，而 UAT 就是正式環境。本 change 的掃描已經讓陣列與物件放大的成本有上限，所以不在這裡降低 `bodyLimit`，只把錯誤的註解改正。降低 `bodyLimit` 列為後續工作，需要先在 UAT 記錄各路由的請求大小。

## Risks / Trade-offs

- **取代根層 JSON 解析器**：之後任何外掛若在子範圍加 `application/json` 解析器，都要先 `removeContentTypeParser`。測試涵蓋 webhook 這個唯一的既有例子。
- **掃描成本**：每個 JSON 請求多一次線性掃描。掃描只做字元比較，與 `JSON.parse` 同一數量級但不配置記憶體。
- **合法請求被擋**：盤點後沒有找到超過預設值的合法請求；超過時錯誤訊息會說明位置與上限，可以用環境變數或 route config 調整。
