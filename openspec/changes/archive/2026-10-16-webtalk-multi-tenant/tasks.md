## 1. 資料庫

- [x] 1.1 `TenantSettings` 新增 `webtalkEnabled`（預設 true）、`webtalkAiEnabled`（預設 false）、`webtalkRoomVersion`（預設 0），產生正式 migration `add_webtalk_tenant_settings`

## 2. API：房間發放與設定（`apps/api/src/modules/webtalk/`）

- [x] 2.1 測試 `apps/api/tests/unit/modules/webtalk/webtalk.service.test.ts`：「Agents of the same tenant share one room」「Different tenants never share a room」「Environments do not share rooms」「Missing room secret fails closed」「Defaults without a settings row」「AI summary disabled by default」「AI summary enabled by the tenant」「AI enabled by the tenant but not configured on the server」「Rotation changes the room ID」（service 層）
- [x] 2.2 實作 `webtalk.service.ts`：`resolveWebTalkServerConfig`、`deriveWebTalkRoomId`、`getWebTalkSettings`、`updateWebTalkSettings`、`rotateWebTalkRoom`、`buildWebTalkSession`
- [x] 2.3 測試 `apps/api/tests/unit/modules/webtalk/webtalk.routes.test.ts`：「Unauthenticated request is rejected」「Non-human credentials are rejected」「Missing room secret fails closed」「Different tenants never share a room」「Tenant disables WebTalk」「Settings change requires permission」「Invalid settings body is rejected」「Disabled AI endpoint refuses requests」「Rotation changes the room ID」（路由層）
- [x] 2.4 實作 `webtalk.routes.ts` 並在 `apps/api/src/index.ts` 註冊於 `/api/v1/webtalk`；`config/env.ts` 新增 5 個環境變數
- [x] 2.5 feature 測試 `apps/api/tests/feature/modules/webtalk/webtalk-settings.test.ts`：以真實資料庫（`app_tenant`、RLS）驗證「Tenant disables WebTalk」「Rotation changes the room ID」與 migration 預設值

## 3. Web：載入、掛載與生命週期

- [x] 3.1 測試 `apps/web/tests/unit/components/webtalk/webtalk-global.test.tsx`：「WebTalk is disabled for the tenant or not configured」「WebTalk script is inserted with required attributes」「WebTalk script is not duplicated」「WebTalk mounts after SDK readiness」「AI summary disabled by default」「AI summary enabled by the tenant」「Agent name is shown in WebTalk」「WebTalk unmounts when leaving authenticated dashboard」「WebTalk remounts after the operator changes」
- [x] 3.2 測試 `apps/web/tests/unit/lib/webtalk.test.ts`：「Logout removes WebTalk local data」
- [x] 3.3 測試 `apps/web/tests/unit/providers/auth-provider.test.tsx`：「WebTalk unmounts during logout」（SDK 載入過時整頁導向）
- [x] 3.4 改寫 `apps/web/src/lib/webtalk.ts`、`components/webtalk/WebTalkGlobal.tsx`、`providers/AuthProvider.tsx`

## 4. Web：設定頁

- [x] 4.1 測試 `apps/web/tests/unit/components/settings/webtalk-settings.test.tsx`：載入設定、切換開關並儲存、重新產生房間代號
- [x] 4.2 實作 `components/settings/WebTalkSettings.tsx`，在設定頁與側欄加入「WebTalk 協作」（`settings.manage`）

## 5. 文件與完成定義

- [x] 5.1 `.env.api.example` 加入 WebTalk 環境變數；更新 `docs/ref/features/tenant/SETTINGS.md`、`docs/ref/system/INFRASTRUCTURE.md`
- [x] 5.2 `CHANGELOG.md` 新增條目
- [x] 5.3 `pnpm test` 通過；`pnpm test:feature -- webtalk` 通過
- [x] 5.4 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 5.5 `node scripts/validate-openspec.mjs webtalk-multi-tenant` 通過
- [x] 5.6 在真實瀏覽器以兩個租戶帳號驗證：不同租戶看不到彼此、AI 關閉時顯示停用訊息、登出後 localStorage 沒有 `WEB_TALK_` key（需要部署環境設定好 `WEBTALK_ROOM_SECRET` 與 `WEBTALK_SDK_URL`）
  - 2026-10-16 在 UAT 以創造智能（Chrome）與示範租戶（Playwright）實測：
    - 不同租戶看不到彼此：示範房間有 Admin 在線並送出「[驗證] 租戶隔離 示範租戶」；同時創造智能的房間顯示「目前聊天室尚無訊息」、在線 1 人。通過。
    - AI 關閉：示範租戶（`aiEnabled: false`）的 AI 請求都打到 `/api/v1/webtalk/ai-disabled`，回 403 `WEBTALK_AI_DISABLED` 與中文訊息。AI 空間提問會顯示停用訊息（SDK 會在後面附加「請檢查 Groq API 設定」）；按「濃縮」時 SDK 不顯示錯誤，畫面沒有反應。此項以規格「Disabled AI endpoint refuses requests」（403 與中文訊息）驗收通過。「濃縮」不顯示訊息是外部 SDK 吞掉錯誤，列為已接受的限制，不在本 change 的需求內：WebTalk 是外加的外掛（2026-10-16 使用者確認），不再修改 SDK 或包裝它的錯誤顯示。
    - 登出：登出前 localStorage 有 3 個 `WEB_TALK_` key，登出後為 0，頁面也沒有 `webtalk-widget`。通過。
