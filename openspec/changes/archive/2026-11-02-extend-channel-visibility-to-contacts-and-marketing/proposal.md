## Why

CM-173 讓分店帳號只看得到自己渠道的對話與工單，但 issue #253 記錄了三處還沒套用：

- 聯絡人列表與詳情只過濾渠道身份，聯絡人本身照樣列出：分店帳號看得到其他分店客人的姓名、電話與 email。
- 單筆對話（`getConversation`）與工單（`getCase`）回傳的 `contact.channelIdentities` 含其他渠道的身份。
- 群發與報表不依渠道限制：分店帳號看得到、也能送出其他分店渠道的群發，報表也統計全租戶。REST、CLI 與 MCP 都是如此。

2026-10-30 決定：非總店成員不應看到其他分店的報表與受眾。

## What Changes

- 聯絡人可見的規則沿用寫入路徑既有的 `isContactVisible()`：有任一可見渠道的身份，或沒有任何渠道身份，就看得到。列表依此過濾；以 ID 讀取或操作看不到的聯絡人回 404。
- 單筆對話與工單的 `contact.channelIdentities` 只含可見渠道的身份。
- 群發：列表只含可見渠道的群發；讀取、收件人、送出、取消不可見渠道的群發回 404；建立群發與預估受眾的渠道必須可見；分眾預覽只算看得到的聯絡人。MCP 的群發工具同樣檢查。群發仍不檢查渠道存取層級。
- 報表：REST、CLI、MCP 的報表與匯出只統計可見渠道。優惠券成效不過濾，因為優惠券不屬於任何渠道。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `channel-scoped-visibility`：列表、單筆檢查延伸到聯絡人與群發；新增聯絡人可見規則、單筆對話與工單的身份過濾、群發與報表的渠道限制。

## Impact

- `apps/api/src/modules/contact/`（service、routes）
- `apps/api/src/modules/conversation/conversation.service.ts`、`apps/api/src/modules/case/case.service.ts` 與呼叫端
- `apps/api/src/modules/marketing/`（routes、`marketing.service.ts`、`segment.service.ts`）
- `apps/api/src/modules/analytics/`、`apps/api/src/modules/cli/cli.routes.ts`、`apps/api/src/modules/mcp/mcp.server.ts`
- 不在範圍：分眾列表上儲存的 `contactCount` 是儲存當下的全租戶人數，這個 change 不改，記在 issue #253。
