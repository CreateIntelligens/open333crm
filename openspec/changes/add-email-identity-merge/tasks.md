# Tasks

## 0. 前置

- [ ] 0.1 與 `add-cross-channel-one-id` 負責人確認歸檔順序：該 change 先歸檔（design.md「歸檔順序」），未完成的 9.x 追蹤項目移到 issue

## 1. 租戶設定與登記連結

- [x] 1.1 測試 `apps/api/tests/unit/modules/identity-binding/email-registration.test.ts`：「未啟用時關鍵字不攔截」「顧客輸入關鍵字」「一般對話提到關鍵字」，以及只啟用 email 登記時綁定代碼關鍵字不攔截（先失敗）
- [x] 1.2 `parseIdentityBindingSettings` 加入 `emailEnabled`、`emailKeywords`；`settings.routes.ts` 的 Zod schema 接受這兩個欄位並檢查關鍵字不重複（測試 `apps/api/tests/unit/modules/settings/identity-binding-settings-schema.test.ts`，先失敗）；入站攔截比對 email 登記關鍵字
- [x] 1.3 測試（同 1.1 檔案）：「連結過期」「不存在的連結」「超過發連結次數」、送不出去時作廢 token（先失敗）；「連結使用後失效」在 2.1 的 feature 測試
- [x] 1.4 新增 `email-registration.service.ts`：產生 token、Redis 儲存與 `GETDEL`、每小時次數限制（design D3）；回覆訊息以 `sendBindingMessage` 送出。共用的型別與輔助函式抽到 `binding-common.ts`（重構，既有綁定測試前後都通過）
- [x] 1.5 測試 `apps/api/tests/feature/modules/contact/contact-routes-permission.test.ts` 加入：「客服傳送連結」的權限層級、「缺少權限」「看不到的渠道」「未啟用時客服無法傳送連結」（先失敗）
- [x] 1.6 新增 `POST /api/v1/contacts/:id/email-registration-link`（`inbox.reply` + `assertConversationChannelVisible(..., 'reply_only')`），查詢放在 `findBindingActorForConversation()`；`/identity-binding/status` 回傳 `emailEnabled`

## 2. 公開登記端點

- [x] 2.1 測試 `apps/api/tests/feature/modules/identity-binding/email-registration.test.ts`：「開啟登記頁」「連結使用後失效」「連結過期」「不存在的連結」「格式錯誤」「沒有相同 email」「其他租戶有相同 email」
- [x] 2.2 新增 `GET`／`POST /api/v1/public/email-registration/:token`，以 `withTenant` 執行（design D4）；租戶關閉功能後已發出的連結回 410
- [x] 2.3 路由測試 `apps/api/tests/feature/modules/identity-binding/email-registration-routes.test.ts`：「開啟登記頁」「不存在的連結」「格式錯誤」「連結使用後失效」、關閉後失效、「短時間大量送出」
- [x] 2.4 公開端點註冊 `@fastify/rate-limit`（每 IP 每分鐘 20 次）

## 3. 自動合併

- [x] 3.1 測試（2.1 檔案）：「不同渠道的同一個人」「多位聯絡人使用相同 email」「已封存的聯絡人不列入比對」「已經是同一位聯絡人」
- [x] 3.2 實作比對與合併（design D5）：同渠道衝突檢查抽成 `hasSharedChannel()`，綁定代碼改呼叫它；`mergeContacts(tx, { source: 'EMAIL', meta })` 與 `IdentityMap`（`EMAIL_MATCH`）在同一交易
- [x] 3.3 既有綁定代碼測試（`identity-binding-unit.test.ts`、feature `identity-binding.test.ts`、`inbound-identity-binding.test.ts`）在抽出共用函式後全部通過；`identity-binding-unit.test.ts` 的設定預設值因新增兩個欄位而更新
- [x] 3.4 測試（2.1 檔案）：「同一個 LINE OA 的兩個帳號」；實作拒絕合併、不寫入 email、回覆說明
- [x] 3.5 測試（2.1 檔案）：「雙邊收到通知」「對方沒有對話」、通知送不出去時合併不變且對話留下失敗紀錄；實作雙邊通知
- [x] 3.6 測試（2.1 檔案）：「登記方解除」「對方解除」「超過 7 天」（先失敗）；實作 design D6
- [x] 3.7 「Merge with records protected by restrictive foreign keys」：email 登記走 `mergeContacts()`，搬移行為由既有合併測試涵蓋（`apps/api/tests/unit/modules/contact/contact-merge.test.ts`）；本 change 只改該情境的觸發來源文字

## 4. 客服修改 email

- [x] 4.1 測試 `apps/api/tests/unit/modules/contact/contact-email-conflict.test.ts`：「改成他人的 email」「確認後仍要儲存」（先失敗）
- [x] 4.2 `PATCH /api/v1/contacts/:id` 加入重複檢查與 `allowDuplicateEmail`（design D8），查詢放在 `contact.service.ts` 的 `updateContact()`
- [x] 4.3 測試 `apps/web/tests/unit/components/contact/email-conflict-dialog.test.tsx`：「改成他人的 email」「確認後仍要儲存」「選擇合併」「沒有合併權限」（先失敗）
- [x] 4.4 前端新增 `ContactEmailField`（聯絡人頁原本沒有 email 編輯）；選擇合併時開啟 `ContactMergeModal` 並預帶對方，合併後寫入 email

## 5. 跨渠道對話檢視

- [x] 5.1 測試 `apps/api/tests/feature/modules/contact/contact-messages.test.ts`：「合併後的時間軸」「載入更早的訊息」「分店帳號」「其他租戶的聯絡人」「缺少權限」（先失敗）
- [x] 5.2 新增 `GET /api/v1/contacts/:id/messages`（design D9），查詢在 `contact.service.ts` 的 `getContactMessages()`；`GET /contacts/:id/conversations` 的 `meta.hiddenCount` 回傳看不到的對話數量（測試加在 `contact-routes-permission.test.ts`，先失敗）
- [x] 5.3 測試 `apps/web/tests/unit/components/inbox/other-channel-conversations.test.tsx`：「歸戶後查看 FB 對話」「沒有其他渠道」、分店帳號只看到數量、載入失敗顯示原因（先失敗）
- [x] 5.4 收件匣右側面板新增「其他渠道的對話」區塊
- [x] 5.5 測試 `apps/web/tests/unit/components/contact/contact-conversation-history.test.tsx`：「合併後的時間軸」「載入更早的訊息」、分店帳號、載入失敗（先失敗）
- [x] 5.6 聯絡人詳情頁新增「對話紀錄」分頁

## 6. AI 讀取其他渠道

- [x] 6.1 測試 `apps/api/tests/feature/modules/ai/other-channel-context.test.ts`：「歸戶後在另一個渠道發問」「超過 30 天的訊息」「其他渠道訊息超過上限」「目前對話不重複」「提示包含個資規則」、其他聯絡人的對話不讀取（先失敗）
- [x] 6.2 新增 `loadOtherChannelContext()`，接到 `kb-autoreply.service.ts` 與 `agent.service.ts`（design D10）；接線測試 `apps/api/tests/unit/modules/ai/other-channel-context-wiring.test.ts`
- [x] 6.3 測試（6.1 檔案）「綁定訊息不給 AI」含 email 登記連結遮蔽（先失敗）；更新 `ai-guard.ts`
- [x] 6.4 測試 `apps/api/tests/feature/modules/identity-binding/email-registration.test.ts`：「解除後回覆」

## 7. 前端：登記頁、按鈕與設定

- [x] 7.1 測試 `apps/web/tests/unit/components/bind/email-registration-form.test.tsx`：顯示渠道與名稱、各種結果、410 顯示連結失效、400 顯示格式錯誤、429（先失敗）
- [x] 7.2 新增公開頁 `/bind/email/[token]`（不放 emoji、錯誤顯示在畫面上）
- [x] 7.3 收件匣「請求 Email」改為「傳送 email 登記連結」（測試 `send-email-registration-link-button.test.tsx`）
- [x] 7.4 `IdentityBindingSettings.tsx` 加入 email 登記開關與關鍵字（測試 `identity-binding-settings.test.tsx`）
- [x] 7.5 合併紀錄的來源標籤加入 `EMAIL`（「Email 登記」）

## 8. 移除 LINE／FB 登入補 email

- [x] 8.1 刪除 `line-login`、`fb-login` 模組、註冊、`prismaAdmin` 白名單項目與 web 的登入結果頁；`env.ts` 移除 `LINE_LOGIN_*`、`FB_LOGIN_*`（design D11）
- [x] 8.2 確認沒有其他引用：`grep -rn "line-login\|fb-login\|LINE_LOGIN\|FB_LOGIN\|request-email" apps packages`（只剩 `MergeSource` 的歷史值與合併紀錄的標籤）

## 9. 文件

- [x] 9.1 `docs/ref/system/AUDIT.md`：IDENT-02 移除，DB-02 內文更新；`AUDIT-REVIEWS.md` 加入紀錄
- [x] 9.2 更新 `CONTACTS.md`、`INBOX.md`、`AUTHENTICATION.md`、`OVERVIEW.md`、`CHANNEL-PLUGINS.md`、`EVENTS.md`
- [x] 9.3 `CHANGELOG.md` 在 `## [2026-10-07]` 下加入 Added／Removed

## 10. 完成檢查

- [x] 10.1 `pnpm test` 通過
- [x] 10.2 `pnpm test:feature` 通過
- [x] 10.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-workspace-esm.mjs --strict` 沒有新增違規
- [x] 10.4 `node scripts/validate-openspec.mjs add-email-identity-merge` 與 `--specs` 通過
- [ ] 10.5 UAT 驗證：LINE 與 FB 各一個帳號用同一個 email 登記後歸戶、雙邊通知、解除、客服收件匣看到另一渠道的對話、AI 回覆引用另一渠道的問題
- [ ] 10.6 先歸檔 `add-cross-channel-one-id`，再以 `pnpm exec openspec archive add-email-identity-merge` 歸檔

## 11. Code review 修正

每項都先寫會失敗的測試，再修正：

- [x] 11.1 登記方本身就是最早使用該 email 的聯絡人時不合併（feature `email-registration.test.ts`）
- [x] 11.2 整合通知不在交易內送出，失敗只記 log、登記結果照常回傳（`email-registration-routes.test.ts`「通知送出時發生錯誤」）
- [x] 11.3 設定頁沒送 email 欄位時沿用已儲存的值（`identity-binding-settings-schema.test.ts`）
- [x] 11.4 email 沒有改變時不檢查重複；對方只在看不到的渠道有身分時 409 不帶對方資料（`contact-email-conflict.test.ts`、`email-conflict-dialog.test.tsx`）
- [x] 11.5 請求 log 遮掉登記連結路徑中的 token（`tests/unit/lib/log-redact.test.ts`）
- [x] 11.6 登記頁先檢查 token 格式並編碼後才送請求（`email-registration-form.test.tsx`）
- [x] 11.7 合併後重設 email 欄位、改選他人時不寫入 email（頁面層 `contact-detail-page.test.tsx`）；切換對話時清空其他渠道的對話；傳送結果只顯示在原對話；設定儲存後清除收件匣快取；測試改用 `assert.ok(x === null)`
- [x] 11.8 PR Agent 審查：email 關鍵字衝突改對合併後要儲存的設定檢查，沒送 email 關鍵字時也擋得下（`identity-binding-settings-schema.test.ts`）；通知逐則處理，一則拋錯不影響其他則（`email-registration.test.ts`）；比對最早聯絡人時以 id 作第二排序
- [x] 11.9 PR Agent 第二輪：補設定路由的整合測試 `apps/api/tests/feature/modules/settings/identity-binding-settings-route.test.ts`（沒送 email 欄位沿用、合併後衝突回 400 且 `path` 為字串，與全站 Zod 錯誤格式一致）

## 突變驗證

實作後才寫、或寫好就通過的測試，以下列突變確認會失敗（每次改完都還原）：

| 突變 | 失敗的測試 |
| --- | --- |
| 比對不排除封存的聯絡人 | 已封存的聯絡人不列入比對 |
| 多筆相同 email 時取最新建立的 | 多位聯絡人使用相同 email |
| 不檢查同渠道衝突 | 同一個 LINE OA 的兩個帳號 |
| 比對區分大小寫 | 不同渠道的同一個人 |
| 送出時 `GET` 而不是 `GETDEL` | 連結使用後失效 |
| email 不轉小寫 | 沒有相同 email |
| 不通知既有方 | 雙邊收到通知、通知送不出去時合併結果不變 |
| 不記錄收到通知的身分 | 雙邊收到通知、對方解除 |
| 公開端點不限速 | 短時間大量送出 |
| 公開端點不檢查租戶是否啟用 | 租戶關閉 email 登記後，已發出的連結失效 |
| 格式錯誤不回 400 | 格式錯誤（路由） |
| 路由不送通知 | 連結使用後失效（路由） |
| 跨渠道訊息不套用渠道可見性 | 分店帳號 |
| 對話清單的 `hiddenCount` 固定為 0 | CM-173：分店帳號看聯絡人的對話… |
| KB 自動回覆與 Agent 不傳其他渠道的訊息 | KB 自動回覆、Agent 模式（接線測試） |
| 傳送按鈕讀 `enabled` 而不是 `emailEnabled` | 啟用時送出連結並顯示結果、沒送到顧客時顯示失敗原因 |
| 設定路由不檢查合併後的設定 | 沒送 email 關鍵字時，與已儲存的 email 關鍵字衝突也回 400 |
| 設定路由不沿用已儲存的 email 欄位 | 設定頁沒送 email 欄位 |
