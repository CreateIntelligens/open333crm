## 1. 聯絡人

- [x] 1.1 先寫測試：`apps/api/tests/feature/modules/contact/contact-routes-permission.test.ts`，情境「聯絡人列表只含看得到的聯絡人」「讀取看不到的聯絡人被拒」「修改看不到的聯絡人被拒」「跨渠道聯絡人只列出可見渠道的身份」「沒有渠道身份的聯絡人」
- [x] 1.2 `contact.service.ts`：列表加可見條件；新增 `assertContactVisible()`，`/:id` 系列路由與合併入口呼叫

## 2. 單筆對話與工單的身份

- [x] 2.1 先寫測試：`apps/api/tests/feature/modules/channel/channel-scoped-visibility.test.ts`，情境「對話的聯絡人身份」「工單的聯絡人身份」
- [x] 2.2 `getConversation()`、`getCase()` 收可見渠道並過濾 `channelIdentities`

## 3. 群發

- [x] 3.1 先寫測試：`apps/api/tests/feature/modules/channel/channel-scoped-visibility.test.ts`（與主規格其他情境放在一起），情境「群發列表只含可見渠道」「送出不可見渠道的群發被拒」「用不可見渠道建立群發被拒」「預估不可見渠道的受眾被拒」「分眾預覽只算看得到的聯絡人」，以及「群發不檢查渠道層級」
- [x] 3.2 marketing routes 與 service 套用可見渠道
- [x] 3.3 MCP `crm_line_get_broadcast`、`crm_line_broadcast_initiate` 檢查群發渠道；測試在 `apps/api/tests/feature/modules/mcp/mcp-channel-visibility.test.ts`

## 4. 報表

- [x] 4.1 先寫測試：`apps/api/tests/feature/modules/analytics/analytics-channel-visibility.test.ts`，情境「總覽只算可見渠道」「渠道報表不列出不可見渠道」「總店看全部」
- [x] 4.2 analytics service 與 flow 收可見渠道；REST、CLI、MCP 傳入

## 5. 完成檢查

- [x] 5.1 `pnpm test`、`pnpm test:feature` 通過
- [x] 5.2 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 以 `--strict` 通過
- [x] 5.3 `CHANGELOG.md` 加條目；更新 `docs/ref/` 描述渠道可見性的文件
- [x] 5.4 `node scripts/validate-openspec.mjs extend-channel-visibility-to-contacts-and-marketing` 通過

## 突變驗證與既有測試的調整

- `mcp-channel-visibility.test.ts` 的三個新情境在實作之後才寫，以突變驗證：把 MCP 的 `visibleBroadcast()` 與建立群發前的檢查改成不檢查、`crm_line_get_conversation` 改傳 `ALL_CHANNELS`，三個情境都失敗。
- 其他新情境都先寫測試、在斷言上失敗後才實作。
- 下列既有測試的角色沒有 `channel.view_all` 也沒有綁任何渠道。這個 change 之後它們看不到有渠道身份的聯絡人與任何報表資料，這是刻意的行為改變，因此給這些測試的角色加上 `channel.view_all`（它們測的是合併規則與全租戶報表，不是可見範圍）：`contact-merge-routes.test.ts`、`contact-merge-same-channel.test.ts`、`analytics-reports.test.ts`、`broadcast-coupon.test.ts`。
- `cli-session-auth.test.ts`（單元）沒有註冊 prisma plugin，解析可見渠道會失敗；它測的是 CLI token 的 scope，因此把 `resolveChannelVisibility` mock 成 `ALL_CHANNELS`。`export-csv-bom.test.ts` 補上新的參數。
- `analytics-reports.test.ts` 的「每日彙總」在並行執行時偶爾失敗，單獨重跑通過；修改報表程式之前就出現過，與這個 change 無關。
