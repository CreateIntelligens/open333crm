## 0. 平台行為實測（先做，結果可能改變 FB/IG/LINE 導流方式）

- [x] 0.1 查證 FB `m.me?ref=`：既有對話送 `messaging_referrals`、新對話 ref 附在 Get Started postback（Meta 官方文件，已寫入 design D4）
- [x] 0.2 查證 IG `ig.me?ref=`：既有對話送 `messaging_referral`、新對話 ref 附在第一次互動、不支援網頁版、App 須 Live（Meta 官方文件，已寫入 design D4）
- [x] 0.3 LINE 非好友須先加好友（使用者確認），導流改兩步（design D6）
- [ ] 0.4 UAT 真機驗證：FB/IG 新舊對話四種情境與 LINE 加好友流程的實際體驗，確認說明文字與純文字代碼退路可用

## 1. P0：移除 fan/auth 漏洞

- [x] 1.1 刪除 `apps/api/src/modules/portal/portal-public.routes.ts` 的 `POST /auth` 路由，再次 grep 確認無呼叫者（含 e2e 測試）
- [x] 1.2 更新 `apps/web/tests/e2e-uat/WAVE6-FIX-PLAN.md` 相關段落為已修復

## 2. P0：資料庫 migration

- [x] 2.1 schema 新增 `ContactMergeLog`；`StitchSource` 加 `BINDING_CODE`；`SuggestionStatus` 加 `SUPERSEDED`
- [x] 2.2 產生正式 migration SQL（`pnpm db:migrate -- --name add_contact_merge_log`），含 `ContactMergeLog` 的 ENABLE/FORCE RLS、`tenant_isolation` policy 與 `app_tenant` grant（照 `postgres-rls-tenant-isolation` skill）
- [x] 2.3 `rls-isolation.test.ts` 加入 `contact_merge_logs` 的跨租戶隔離案例

## 3. P0：統一合併引擎

- [x] 3.1 新增 `apps/api/src/modules/contact/contact-merge.service.ts` 的 `mergeContacts(tx, input)`：租戶/封存/同筆檢查、D5 搬移清單、survivor 補空欄、寫 `ContactMergeLog.movedRecords`
- [x] 3.2 同檔新增 `revertMerge(tx, { tenantId, mergeLogId, revertedBy })`：取消封存、依 movedRecords 搬回、tag/attribute 不回收、重複撤銷拒絕
- [x] 3.3 `contact.service.mergeContacts` 改為呼叫新引擎（source `MANUAL`），保留原 API 契約與 `contact.merged` socket 事件
- [x] 3.4 `approveMerge`（packages/core）改為只驗證建議（補 tenant 檢查）與更新狀態；identity suggestions 路由在同一 `withTenant` 交易內呼叫新引擎（source `SUGGESTION`）
- [x] 3.5 刪除 `line-login.service.ts`、`fb-login.service.ts` 的 `mergeContactIntoTarget`，改呼叫新引擎（source `LINE_LOGIN` / `FB_LOGIN`）；確認 ChannelIdentity 更新不再因 cascade 失效
- [x] 3.6 刪除 `packages/core/src/contacts/contact-service.ts` 的死程式碼 `mergeContacts`（確認無呼叫者）
- [x] 3.7 新增合併紀錄 API：`GET /api/v1/contacts/:id/merge-logs`、`POST /api/v1/contacts/merge-logs/:logId/revert`（`contact.merge`，Zod 驗證，AppError）；既有 `POST /merge` 補 `contact.merge` 守門
- [x] 3.8 測試 `contact-merge.test.ts`（fake prisma）：各表搬移、tag/attribute/broadcast 去重、survivor 優先、跨租戶拒絕、Restrict FK 表不失敗、SUPERSEDED、revert 與重複 revert；加入 `apps/api/package.json` script
- [x] 3.9 執行既有 `contact.service.test.ts` 等相關測試確認無回歸

## 4. P1：渠道導流識別

- [x] 4.1 LINE `verifyChannel` 將 `/v2/bot/info` 的 `basicId` 寫入 `Channel.settings.bindingHandle`
- [x] 4.2 IG verify 改呼叫 `/me?fields=id,username` 並寫入 username；FB 支援選填 `pageUsername`，無則用 `pageId`
- [x] 4.3 一次性 script：為既有 LINE/IG 渠道補抓導流識別（逐租戶 `withTenant`）
- [x] 4.4 後台渠道設定頁顯示並可覆寫導流識別（新增 GET/PATCH /channels/:id/binding-handle，只合併這一欄不整包覆寫 settings；FB 未設「開始使用」時顯示提醒）

## 5. P1：FB/IG referral 解析

- [x] 5.1 `ParsedWebhookMessage` 加 `referralRef?: string`、`contentType` 加 `'referral'`
- [x] 5.2 FB plugin 解析獨立 `referral`、`message.referral`、`postback.referral`
- [x] 5.3 IG（threads.ts）解析 `messaging_referral`（既有對話），不再因缺 `message.mid` 跳過；並解析新對話第一則 `messages` / `messaging_postback` 內夾帶的 `referral`
- [x] 5.6 FB 渠道設定：檢查粉專是否已設定 Get Started 按鈕（新對話的 ref 靠它送達），未設定時在後台提示
- [x] 5.4 入站管線：`referral` 事件若 ref 非綁定代碼 → 只記 log，不落地訊息
- [x] 5.5 plugin 單元測試：三種 FB referral 形狀、IG referral、無 ref 事件

## 6. P1：綁定代碼引擎

- [x] 6.1 新增 `apps/api/src/modules/identity-binding/`：可注入 Redis 介面的 code store（`SET PX NX` / `GETDEL`）、代碼產生（Crockford base32）、regex 搜尋與正規化
- [x] 6.2 `TenantSettings.identityBinding`（enabled 預設 false、bindKeywords、unbindKeywords）讀取與預設值；常數（30 分鐘、7 天、頻率上限）集中一檔
- [x] 6.3 發碼：產生代碼、依 D6 產生各渠道連結（percent-encode；LINE 分「加好友 → 送出代碼」兩步；所有渠道附純文字代碼與「開啟後傳送任一訊息或直接貼上代碼」說明）、回覆系統訊息；發碼頻率限制
- [x] 6.4 兌換：D7 五項檢查、呼叫統一合併引擎（source `BINDING_CODE`）、`IdentityMap` upsert、雙邊確認（送出失敗寫 SYSTEM 訊息）、失敗次數限制
- [x] 6.5 解除：7 天內顧客解除（撤銷最近一筆 BINDING_CODE 合併）、超過 7 天回覆聯繫客服、雙邊通知
- [x] 6.6 在 `processInboundMessage` 的 `sendFirstContactGreeting` 前接上 `handleIdentityBinding(ctx)`；命中時跳過打招呼、其他攔截器與 `message.received`，但保留 socket 事件
- [x] 6.7 客服代發 API：`POST /api/v1/contacts/:id/binding-link`（`contact.update`，指定 conversationId）
- [x] 6.8 測試 `identity-binding.test.ts`：spec 中 cross-channel-binding-code 每個 Scenario 一案（含未啟用、並發兌換、跨租戶、同身分、已合併追 mergedIntoId、改動預填文字、頻率限制）
- [x] 6.9 測試 `first-contact-greeting.test.ts` / inbound 相關補案例：代碼命中時不送打招呼、不發 `message.received`；未啟用時行為不變

## 7. P1：後台 UI

- [x] 7.1 租戶設定頁新增「跨渠道綁定」區塊：開關、綁定/解除關鍵字
- [x] 7.2 聯絡人頁：已綁定渠道列表與來源標示、合併紀錄與「解除」按鈕
- [x] 7.3 聯絡人對話：「傳送綁定連結」按鈕
- [x] 7.4 UI 不放 emoji／勾勾符號；錯誤以頁面內訊息顯示中文（專案無共用 toast，改用 getApiErrorMessage + 內嵌提示，不用 alert）

## 8. 收尾

- [x] 8.1 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-workspace-esm.mjs --strict` 全過
- [x] 8.2 typecheck / lint / 新舊相關測試全過
- [x] 8.3 本機端到端驗證：以真實入站管線 + 真實 Redis 模擬 FB 發碼、LINE 兌換，並在瀏覽器驗證設定頁、渠道導流識別、聯絡人合併紀錄與解除、收件匣代發按鈕（2026-09-29 完成）；LINE/FB/IG 真機驗證留 UAT（見 0.4）
- [x] 8.4 更新 `CHANGELOG.md`（`## [YYYY-MM-DD]` 格式）
- [x] 8.5 部署清單：migration、既有渠道補抓導流識別 script、租戶啟用說明；記錄優惠券分支 rebase 時須把 `CouponInstance` 加入合併搬移清單

## 9. 未完成／後續事項（2026-09-30 整理）

### 9.1 本 change 上線前必做

- [ ] 9.1.1 push 分支並開 PR（目前 13 個 commit 皆只在本地）
- [ ] 9.1.2 UAT 部署：2 支 migration（`20260929100000_add_contact_merge_log`、`20260929110000_add_identity_binding_settings`）、跑 `backfill-binding-handles.ts` 補抓既有渠道導流識別（見 design.md Migration Plan）
- [ ] 9.1.3 UAT 真機驗證（即 0.4）：FB／IG 新舊對話四種情境、LINE 加好友流程、**兌換後回覆「確認綁定」的確認步驟**、解除綁定、客服代發按鈕
- [ ] 9.1.4 第六輪 review 的修正（2b2622f）尚未再經 review；是否再跑一輪由負責人決定

### 9.2 demo 觀察到、尚未改善的體驗

- [ ] 9.2.1 LINE「送出代碼」連結的預填中文被編碼成很長的 `%E6%88%91…`，顧客可能不敢點；考慮縮短預填文字（例如只放代碼）
- [ ] 9.2.2 網站客服（WebChat）視窗內的網址是純文字、不能點（LINE／FB 會自動變連結，不受影響）

### 9.3 本次發現、建議另開單（不在本 change 範圍）

- [ ] 9.3.1 **聯絡人路由幾乎全無權限守門**：`contact.view`／`contact.update` 權限點有定義但多數 `/api/v1/contacts/*` 路由沒套；本次只補了合併、解除、代發綁定連結
- [ ] 9.3.2 Redis 連線單例重複：passkey、downstream-loop-guard、identity-binding 各自 `new IORedis`，建議抽共用 client
- [ ] 9.3.3 移除 `fan/auth` 後暫無簽發 fan token 的路徑，粉絲門戶受保護路由（活動、點數）暫不可用；待優惠券分支 Account Link 或 P2 會員登入頁接上
- [ ] 9.3.4 `check-prisma-admin-usage --strict` 在 main 上就失敗（shortlink-redirect、portal-public 共 5 處），非本次造成
- [ ] 9.3.5 `.github/workflows/ci.yml` 已被刪除（AGENTS.md 已記載），租戶隔離檢查與 RLS 整合測試目前沒有 CI 在跑
- [ ] 9.3.6 Web 的 ESLint 設定在本機載入失敗（模組解析錯誤），前端只能靠 tsc 檢查
- [ ] 9.3.7 API 啟動 log 寫「Registered channel plugins: LINE, FB, WEBCHAT」漏了 THREADS（實際有註冊，僅文字過時）

### 9.4 與其他分支的交集

- [ ] 9.4.1 優惠券分支 `feat/coupon-system` rebase 後：把 `CouponInstance`（帶 contactId）加入 `contact-merge.service.ts` 搬移清單與解除搬回；更新該 change 的 D6「不做跨渠道歸戶」描述

### 9.5 後續階段（另開 change）

- [ ] 9.5.1 P2：會員登入頁（比對客戶會員 API／串客戶自家登入）→ 登入後發綁定代碼
- [ ] 9.5.2 P3：簡訊／Email OTP、LIFF 版綁定頁、後台身分衝突清單、手機重複合併建議（`detectPhoneDuplicates` 目前無呼叫者）

### 9.6 測試覆蓋缺口

- [ ] 9.6.1 缺路由層測試：`/channels/:id/binding-handle` 非法 id 回 400、`/contacts/identity-binding/status`、`/contacts/:id/binding-link` 的 CM-173 渠道存取守門
- [ ] 9.6.2 `inTransaction` 擋 tenant-scoped client 的守門、stitcher 排除封存聯絡人，目前沒有專屬測試

### 9.7 本機環境（demo 用，驗證完需清理）

- [ ] 9.7.1 本機仍在執行：API（3001）、前端 dev（3002）；3000 是 9/15 起的舊 next-server（非本次啟動）
- [ ] 9.7.2 本機 DB 有兩個 demo 假渠道（名稱含「demo 用可刪」）與 demo 期間產生的聯絡人／對話；租戶設定 `identityBinding` 目前為**開啟**，清理時改回 `{}`
