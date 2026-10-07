# Tasks

## 0. 前置

- [ ] 0.1 與 `add-cross-channel-one-id` 負責人確認歸檔順序：該 change 先歸檔（design.md「歸檔順序」），未完成的 9.x 追蹤項目移到 issue

## 1. 租戶設定與登記連結

- [ ] 1.1 測試 `apps/api/tests/unit/modules/identity-binding/email-registration.test.ts`：「未啟用時關鍵字不攔截」「顧客輸入關鍵字」「一般對話提到關鍵字」（先失敗）
- [ ] 1.2 `parseIdentityBindingSettings` 加入 `emailEnabled`、`emailKeywords`；`settings.routes.ts` 的 Zod schema 接受這兩個欄位；入站攔截比對 email 登記關鍵字
- [ ] 1.3 測試（同 1.1 檔案）：「連結使用後失效」「連結過期」「超過發連結次數」「不存在的連結」（先失敗）
- [ ] 1.4 新增 `email-registration.service.ts`：產生 token、Redis 儲存與 `GETDEL`、每小時次數限制（design D3）；回覆訊息以 `sendBindingMessage` 送出
- [ ] 1.5 測試 `apps/api/tests/unit/modules/contact/contact-routes-permission.test.ts` 加入：「客服傳送連結」「缺少權限」「看不到的渠道」「未啟用時客服無法傳送連結」（先失敗）
- [ ] 1.6 新增 `POST /api/v1/contacts/:id/email-registration-link`（`inbox.reply` + `assertConversationChannelVisible(..., 'reply_only')`）

## 2. 公開登記端點

- [ ] 2.1 測試 `apps/api/tests/feature/modules/identity-binding/email-registration.test.ts`：「開啟登記頁」「格式錯誤」「沒有相同 email」「其他租戶有相同 email」（先失敗）
- [ ] 2.2 新增 `GET`／`POST /api/v1/public/email-registration/:token`，以 `withTenant` 執行（design D4）；GET 只回渠道標示與顧客在該渠道的名稱
- [ ] 2.3 測試（同 2.1 檔案）：「短時間大量送出」回 429（先失敗）
- [ ] 2.4 公開端點註冊 `@fastify/rate-limit`（每 IP 每分鐘 20 次）

## 3. 自動合併

- [ ] 3.1 測試（同 2.1 檔案）：「不同渠道的同一個人」「多位聯絡人使用相同 email」「已封存的聯絡人不列入比對」「已經是同一位聯絡人」（先失敗）
- [ ] 3.2 實作比對與合併（design D5）：從 `checkBindable()` 抽出同渠道衝突檢查為共用函式，綁定代碼改呼叫共用函式；`mergeContacts(tx, { source: 'EMAIL', meta })` 與 `IdentityMap`（`EMAIL_MATCH`）在同一交易
- [ ] 3.3 執行既有綁定代碼測試（`identity-binding-unit.test.ts`、feature `identity-binding.test.ts`、`inbound-identity-binding.test.ts`），確認抽出共用函式後全部通過
- [ ] 3.4 測試（同 2.1 檔案）：「同一個 LINE OA 的兩個帳號」（先失敗）；實作拒絕合併、不寫入 email、回覆說明
- [ ] 3.5 測試（同 2.1 檔案）：「雙邊收到通知」「對方沒有對話」（先失敗）；實作雙邊通知，送不出去時寫入客服看得到的失敗紀錄
- [ ] 3.6 測試（同 2.1 檔案）：「登記方解除」「對方解除」「超過 7 天」（先失敗）；實作 design D6
- [ ] 3.7 測試 `apps/api/tests/feature/modules/contact/contact-merge.test.ts`（或既有合併測試檔）：「Merge with records protected by restrictive foreign keys」改以 email 登記合併；以 mutation 驗證（移除 `portalSubmission` 搬移 → 測試失敗 → 還原）

## 4. 客服修改 email

- [ ] 4.1 測試 `apps/api/tests/unit/modules/contact/contact-email-conflict.test.ts`：「改成他人的 email」「確認後仍要儲存」（先失敗）
- [ ] 4.2 `PATCH /api/v1/contacts/:id` 加入重複檢查與 `allowDuplicateEmail`（design D8），查詢放在 `contact.service.ts`
- [ ] 4.3 測試 `apps/web/tests/unit/components/contact/email-conflict-dialog.test.tsx`：「選擇合併」「沒有合併權限」（先失敗）
- [ ] 4.4 前端 email 衝突對話框，合併時開啟 `ContactMergeModal` 並預帶對方

## 5. 跨渠道對話檢視

- [ ] 5.1 測試 `apps/api/tests/feature/modules/contact/contact-messages.test.ts`：「合併後的時間軸」「載入更早的訊息」「分店帳號」「其他租戶的聯絡人」「缺少權限」（先失敗）
- [ ] 5.2 新增 `GET /api/v1/contacts/:id/messages`（design D9），查詢在 `contact.service.ts`
- [ ] 5.3 測試 `apps/web/tests/unit/components/inbox/other-channel-conversations.test.tsx`：「歸戶後查看 FB 對話」「沒有其他渠道」，以及分店帳號顯示看不到的數量（先失敗）
- [ ] 5.4 收件匣右側面板新增「其他渠道的對話」區塊
- [ ] 5.5 測試 `apps/web/tests/unit/components/contact/contact-conversation-tab.test.tsx`：時間軸標示渠道與分頁載入（先失敗）
- [ ] 5.6 聯絡人詳情頁新增「對話紀錄」分頁

## 6. AI 讀取其他渠道

- [ ] 6.1 測試 `apps/api/tests/unit/modules/ai/other-channel-context.test.ts`：「歸戶後在另一個渠道發問」「超過 30 天的訊息」「其他渠道訊息超過上限」「目前對話不重複」「提示包含個資規則」（先失敗）
- [ ] 6.2 新增 `loadOtherChannelContext()`，接到 `kb-autoreply.service.ts` 與 `agent.service.ts`（design D10）
- [ ] 6.3 測試 `apps/api/tests/unit/modules/identity-binding/ai-guard.test.ts` 加入：「綁定訊息不給 AI」含 email 登記連結遮蔽（先失敗）；更新 `ai-guard.ts`
- [ ] 6.4 測試 `apps/api/tests/feature/modules/identity-binding/email-registration.test.ts` 加入：「解除後回覆」——合併、解除後 `loadOtherChannelContext` 不含 A 的訊息（先失敗）

## 7. 前端：登記頁、按鈕與設定

- [ ] 7.1 測試 `apps/web/tests/unit/app/bind-email-page.test.tsx`：顯示渠道與名稱、送出成功、410 顯示連結失效、400 顯示格式錯誤（先失敗）
- [ ] 7.2 新增公開頁 `/bind/email/[token]`（不放 emoji、錯誤要顯示在畫面上）
- [ ] 7.3 收件匣「索取 email」改為「傳送 email 登記連結」，失敗時以 toast 顯示原因
- [ ] 7.4 `IdentityBindingSettings.tsx` 加入 email 登記開關與關鍵字設定
- [ ] 7.5 合併紀錄的來源標籤加入 `EMAIL`（「Email 登記」）

## 8. 移除 LINE／FB 登入補 email

- [ ] 8.1 刪除 `line-login`、`fb-login` 模組與註冊；`env.ts`、`.env.*.example` 移除 `LINE_LOGIN_*`、`FB_LOGIN_*`（design D11）
- [ ] 8.2 確認沒有其他引用：`grep -rn "line-login\|fb-login\|LINE_LOGIN\|FB_LOGIN\|request-email" apps packages`

## 9. 文件

- [ ] 9.1 `docs/ref/system/AUDIT.md`：IDENT-02 改為已修正（流程已移除）；`AUDIT-REVIEWS.md` 加入紀錄
- [ ] 9.2 更新 `docs/ref/features/tenant/INBOX.md` 與聯絡人相關文件：email 登記、其他渠道的對話、AI 讀取範圍
- [ ] 9.3 `CHANGELOG.md` 在 `## [YYYY-MM-DD]` 下加入 Added／Removed

## 10. 完成檢查

- [ ] 10.1 `pnpm test` 通過
- [ ] 10.2 `pnpm test:feature` 通過
- [ ] 10.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-workspace-esm.mjs --strict` 沒有新增違規
- [ ] 10.4 `node scripts/validate-openspec.mjs add-email-identity-merge` 與 `--specs` 通過
- [ ] 10.5 UAT 驗證：LINE 與 FB 各一個帳號用同一個 email 登記後歸戶、雙邊通知、解除、客服收件匣看到另一渠道的對話、AI 回覆引用另一渠道的問題
- [ ] 10.6 先歸檔 `add-cross-channel-one-id`，再以 `pnpm exec openspec archive add-email-identity-merge` 歸檔
