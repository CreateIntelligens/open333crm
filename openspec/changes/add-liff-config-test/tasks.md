## 1. 驗證 ID token 分辨「不接受」與「連不上」（design D4）

- [x] 1.1 測試 `apps/api/tests/unit/modules/coupon/line-id-token.test.ts`：`checkLineIdToken` 在 LINE 回 400 時回 `rejected`、連線失敗時回 `unreachable`、通過時回 `ok` 與 `sub`；`verifyLineIdToken` 的既有測試不變
- [x] 1.2 實作 `checkLineIdToken`，`verifyLineIdToken` 改為包裝它

## 2. 產生測試連結、回報與查詢（API）

- [x] 2.1 測試 `apps/api/tests/feature/modules/channel/channel-liff-test.test.ts`，涵蓋：
  - 「產生 LIFF 設定的測試連結」：已設定的 LINE 渠道產生測試連結、沒有設定完整時不產生、不是 LINE 渠道、其他租戶的渠道、沒有權限
  - 「手機回報 LIFF 測試結果」：設定正確且是官方帳號的聯絡人、LINE 帳號不在這個官方帳號的聯絡人裡、ID token 跟 Login Channel ID 不符、連不上 LINE、手機回報 LIFF 端的失敗、測試連結過期或不存在
  - 「查詢 LIFF 測試結果」：還沒收到回報、收到回報後、其他渠道的測試
  - 「LIFF 測試紀錄由系統維護」：Bot 設定整包存檔不會洗掉測試紀錄、不能從 API 偽造測試紀錄
- [x] 2.2 實作 `channel/liff-test.service.ts`（TenantCtx）與 `channel/liff-test.flow.ts`
- [x] 2.3 實作 `channel.routes.ts` 的兩條管理路由，以及 `channel/liff-test-public.routes.ts`（註冊在 `/api/v1/fan/liff-test`，有限流）
- [x] 2.4 `liffTest` 加進 `SYSTEM_MANAGED_SETTING_KEYS`
- 突變驗證（2.1 的測試都先失敗於斷言；以下突變各讓對應測試失敗，還原後全過）：
  - 渠道不存在時回 `not_configured` →「其他租戶的渠道」失敗（RLS 也擋得住，這個突變確認 404 來自查無渠道）
  - 查 LINE 身分不看 `channelId` →「LINE 帳號不在這個官方帳號的聯絡人裡」失敗
  - 讀設定不限 `channelType: 'LINE'` →「不是 LINE 渠道」失敗
  - `liffTest` 不列為系統維護欄位 →「Bot 設定整包存檔不會洗掉測試紀錄」「不能從 API 偽造測試紀錄」失敗
  - 查結果只比對租戶、不比對渠道 →「其他渠道的測試」失敗
  - 測試連結過期仍記錄結果 →「測試連結過期或不存在」失敗

## 3. LIFF 入口頁的測試流程（Web）

- [x] 3.1 測試 `apps/web/tests/unit/lib/liff-test.test.ts`，涵蓋「LIFF 入口頁的測試流程」：取得 ID token 後回報、沒有 ID token、LIFF 啟動失敗、測試連結過期；`resolveLiffParams` 保留 `lt`
- [x] 3.2 實作 `apps/web/src/lib/liff-test.ts`，`/liff/redirect` 看到 `lt` 時呼叫它；`resolveLiffParams` 處理 `lt`

## 4. 後台顯示測試狀態（Web）

- [x] 4.1 測試 `apps/web/tests/unit/components/settings/liff-test-panel.test.tsx`，涵蓋「後台顯示 LIFF 測試狀態」：設定改過但還沒存檔、收到結果、過期仍未收到回報、上次測試成功的紀錄、設定改過後不顯示舊紀錄
- [x] 4.2 實作 `LiffTestPanel`，放進 `BotConfigForm` 的 LIFF 區塊

## 5. 手冊

- [x] 5.1 手冊第 15 章 Bot 設定補上 LINE Login Channel ID 與「測試 LIFF 設定」的步驟、結果對照表（第 18 章已連到第 15 章）；截圖待 UAT 上線後補拍

## 6. 完成檢查

- [x] 6.1 `pnpm test`
- [x] 6.2 `pnpm test:feature`
- [x] 6.3 api、web 的 tsc
- [x] 6.4 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`
- [x] 6.5 `node scripts/validate-openspec.mjs add-liff-config-test` 與 `--specs`
- [x] 6.6 `CHANGELOG.md` 的 `## [2026-10-29]` 加條目
- [ ] 6.7 UAT 真機驗收後歸檔
