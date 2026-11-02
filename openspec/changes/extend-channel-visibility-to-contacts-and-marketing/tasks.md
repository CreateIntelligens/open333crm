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

## 5. Code review 修正

- [x] 5.1 先寫測試：`contact-channel-visibility.test.ts` 的「解除看不到的聯絡人的合併被拒」「被合併的聯絡人依保留方判斷」「依渠道類型篩選只比對可見渠道」「合併預覽與修改的回應只含可見渠道的身份」；`channel-scoped-visibility.test.ts` 的「分眾預覽只算看得到的聯絡人」（列表與單筆的人數）、「行銷活動只含可見渠道的群發」；`analytics-channel-visibility.test.ts` 的「客服績效不列出其他分店的客服」；`packages/shared/tests/unit/linkify.test.ts` 的括號與假名、韓文。每個都先在斷言上失敗
- [x] 5.2 實作上述修正
- [x] 5.3 效能：群發的守門改為只查 `channelId`（`getBroadcastChannelIdFlow`），不再為守門算收件人統計；聯絡人檢查每位一次查詢，總店不另開交易
- [x] 5.4 `analytics.service.ts` 的優先級與狀態分布加 `ORDER BY`：沒有排序時，每日彙總存下的順序與即時報表可能不同，`analytics-reports.test.ts` 的「每日彙總」因此時好時壞

## 6. 第二輪 code review 修正

- [x] 6.1 先寫測試，都先在斷言上失敗：`contact-channel-visibility.test.ts` 的「合併有其他渠道資料的聯絡人須由總店處理」、兩層合併鏈（S3）看不到；`channel-scoped-visibility.test.ts` 的舊分眾 `rules` 為空（原本 500）、「只有其他分店群發的行銷活動」（含修改、刪除）；`analytics-channel-visibility.test.ts` 的「同分店沒有工單的客服照常列出」與併入可見聯絡人的 SA 計入新聯絡人
- [x] 6.2 合併、合併預覽、解除合併：任一方在其他分店渠道還有身分回 403 `CONTACT_HAS_OTHER_CHANNELS`；合併與解除合併的可見檢查移進 flow 的同一個交易
- [x] 6.3 被合併的聯絡人只依直接保留方判斷（取代原本最多 10 層的迴圈），`isContactVisible()` 與報表的 `contactSql()` 同一套規則；新聯絡人總數改用 `contactSql()`
- [x] 6.4 分眾：`rules` 為空時算 0 人；列表以 `count` 並行計算
- [x] 6.5 行銷活動：群發都在其他分店的活動不列出，讀取、修改、刪除回 404
- [x] 6.6 客服績效：列出被授權可見渠道或有可見工單的客服；`agentId` 過濾改在 `a.id`，期間內沒有工單的客服不再因 LEFT JOIN 消失（既有問題）
- [x] 6.7 抽出 `channelIdWhere()`（`services/channel-visibility.ts`），取代三處重複的渠道過濾寫法
- [x] 6.8 `contact.flow.test.ts`、`campaign-dates.test.ts` 補上新參數 `ALL_CHANNELS`（它們不測可見範圍）

## 7. 第三輪 code review 修正

- [x] 7.1 先寫測試，都先在斷言上失敗：「合併有其他渠道資料的聯絡人須由總店處理」的「只剩其他分店的對話」、「其他成員還沒有群發的活動」、「修改含其他分店群發的活動被拒」
- [x] 7.2 合併前的檢查加入對話與工單；分店成員合併與解除合併先以 `lockContactsForMerge()`（`SELECT … FOR UPDATE`）鎖住雙方再檢查。測試「合併前的列鎖擋住同時新增的渠道身份」，突變：拿掉 `FOR UPDATE` 後測試失敗
- [x] 7.3 行銷活動改為「行銷活動的可見範圍」：自己建立的或有可見群發的才看得到；修改、刪除、建立群發指定活動時，活動有其他分店群發回 403。前一輪「沒有群發的活動照常看得到」的測試改為「自己建立的空活動」：其他成員的空活動會外流名稱，也可能被其他分店修改
- [x] 7.4 分群列表的人數改回逐筆計算：並行時每個查詢各開交易，會佔滿連線池
- 不修改：被合併的聯絡人只看一層保留方，是刻意的 fail-closed 規則（規格已寫明），合併鏈較長時分店看不到舊的聯絡人，由總店處理。報表 `contactSql()` 的相關子查詢只在非總店成員時加上，`channel_identities` 有 `contactId` 索引；資料量大時再改成一次算出可見聯絡人的 CTE

## 8. 第四輪 code review 修正

- [x] 8.1 2026-11-02 決定：還沒有任何群發的行銷活動所有成員都看得到，可以加入自己渠道的群發（總店規劃、分店執行）。規格與測試「總店規劃的空活動」依此修改
- [x] 8.2 活動的修改與刪除改以 `writableCampaignWhere()` 帶進 `updateMany`／`deleteMany`，檢查與寫入同一個語句；檢查改為 where 條件，不再載入活動的全部群發
- [x] 8.3 `assertMergeAllowed()`：鎖定、可見檢查、其他分店資料檢查收成一個函式，合併與解除合併都呼叫它；同一個交易內的三個查詢改為依序執行
- 不修改：建立群發時檢查活動與新增群發仍是兩個查詢，總店剛好同時把其他分店的群發加進同一個活動才會發生；分店合併時的列鎖可能與進站訊息的寫入互相等待，PostgreSQL 會偵測死結並讓其中一方失敗，合併是少見的手動操作；分群列表逐筆計算人數，延遲隨分群數增加；MCP 的 `accessible()` 已在 `mcp.routes.ts` 快取，呼叫兩次不會重算

## 9. 完成檢查

- [x] 9.1 `pnpm test`、`pnpm test:feature` 通過
- [x] 9.2 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 以 `--strict` 通過
- [x] 9.3 `CHANGELOG.md` 加條目；更新 `docs/ref/` 描述渠道可見性的文件
- [x] 9.4 `node scripts/validate-openspec.mjs extend-channel-visibility-to-contacts-and-marketing` 通過

## 突變驗證與既有測試的調整

- `mcp-channel-visibility.test.ts` 的三個新情境在實作之後才寫，以突變驗證：把 MCP 的 `visibleBroadcast()` 與建立群發前的檢查改成不檢查、`crm_line_get_conversation` 改傳 `ALL_CHANNELS`，三個情境都失敗。
- 其他新情境都先寫測試、在斷言上失敗後才實作。
- 下列既有測試的角色沒有 `channel.view_all` 也沒有綁任何渠道。這個 change 之後它們看不到有渠道身份的聯絡人與任何報表資料，這是刻意的行為改變，因此給這些測試的角色加上 `channel.view_all`（它們測的是合併規則與全租戶報表，不是可見範圍）：`contact-merge-routes.test.ts`、`contact-merge-same-channel.test.ts`、`analytics-reports.test.ts`、`broadcast-coupon.test.ts`。
- `cli-session-auth.test.ts`（單元）沒有註冊 prisma plugin，解析可見渠道會失敗；它測的是 CLI token 的 scope，因此把 `resolveChannelVisibility` mock 成 `ALL_CHANNELS`。`export-csv-bom.test.ts` 補上新的參數。
