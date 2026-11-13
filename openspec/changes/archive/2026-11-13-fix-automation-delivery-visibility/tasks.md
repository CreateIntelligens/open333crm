## 1. 送出失敗讓對話浮上來、渠道停用留下紀錄（workers）

- [x] 1.1 測試 `apps/workers/tests/unit/lib/automation-delivery-failure-visibility.test.ts`：「傳送訊息被渠道拒收」「發券產生票券連結失敗」（`lastMessageAt` 未更新）、「渠道停用時傳送訊息」「渠道停用時發券」，在現有程式上斷言失敗
- [x] 1.2 `recordDeliveryFailure()` 與 `recordFailureNotice()` 寫入後以 `updateMany({ where: { id, tenantId } })` 更新 `lastMessageAt`（design D1）
- [x] 1.3 `sendToChannelFromWorker()` 在渠道停用、對話還在時寫失敗紀錄並回 `recorded: true`；發券依 `recorded` 不重複寫（design D2）

## 2. 動作失敗寫進規則執行紀錄（workers）

- [x] 2.1 測試同一檔：「對話不存在時傳送訊息」「對話不存在時傳送素材」「動作都成功」，在現有程式上斷言失敗
- [x] 2.2 `executeWorkerAutomationActions()` 回傳每個動作的結果；`send_message`、`send_material` 改用 `sendToChannelFromWorker()` 並依結果標成失敗；有失敗時寫 `automation_logs`（design D3）
- [x] 2.3 `automation-actions.test.ts` 的送出替身改成 `sendToChannelFromWorker`（換了呼叫的函式，斷言不變）；`delivery-failure-record.test.ts`、`automation-material-channel-mismatch.test.ts` 的假資料庫補 `conversation.updateMany`

## 3. 素材渠道與規則渠道條件相同（API）

- [x] 3.1 測試 `apps/api/tests/unit/modules/automation/send-material-channel.test.ts`：「Material of another channel than the channel condition」「Update changes only the conditions」與巢狀 `all`、更新動作，在現有程式上斷言失敗
- [x] 3.2 測試 `apps/api/tests/feature/modules/automation/automation-routes.test.ts`：「傳送素材的渠道要與規則的渠道條件相同」走真的路由與 RLS，在現有程式上斷言失敗（回 201）
- [x] 3.3 `assertSendMaterialChannels()`：create 時與 update 改 `conditions` 或 `actions` 時檢查（design D4）
- [x] 3.4 寫好就通過的情境以突變驗證：
  - 「Channel condition inside an any group」：`requiredConversationChannels()` 也走進 `any` 時失敗
  - 「Material of the same channel in another case」：比對改成區分大小寫時失敗（同時「只改條件、既有素材已停用但渠道相符」失敗）
  - 「Update changes only the name or the active state」：檢查條件改成永遠檢查（含重新啟用）時失敗
  - 「沒有渠道條件」：沒有渠道條件時改成預設 LINE 時失敗
  - 「Existing active material」等既有情境由 `send-material-reference.test.ts` 保護，未改動

## 4. 關鍵字回覆頁的動作合併（web）

- [x] 4.1 測試 `apps/web/tests/unit/hooks/use-keyword-replies.test.tsx`：「有兩個傳送素材的規則」「只發券的規則加上素材」，在現有程式上斷言失敗
- [x] 4.2 `mergeActions()` 保留第二個以後的同類動作；新素材插在第一個發券之前（design D5）

## 5. 文件

- [x] 5.1 `docs/ref/features/tenant/AUTOMATION.md`：失敗紀錄、執行紀錄、素材渠道檢查、關鍵字回覆頁動作合併
- [x] 5.2 `docs/ref/system/AUDIT.md` AUTO-02 註明失敗的執行會寫入 `automation_logs`；`docs/ref/system/AUDIT-REVIEWS.md` 加一筆

## 6. 完成定義

- [x] 6.1 `pnpm --filter @open333crm/workers test`、`pnpm --filter @open333crm/api test`、`pnpm --filter @open333crm/web test`
- [x] 6.2 api feature 以獨立測試庫（`TEST_DATABASE_NAME=open333crm_test_362wk`）執行
- [x] 6.3 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`
- [x] 6.4 `node scripts/validate-openspec.mjs fix-automation-delivery-visibility` 與 `--specs`
- [x] 6.5 `pnpm build`
- [x] 6.6 `CHANGELOG.md` 加 Fixed 條目（由整合 #362 的 PR 統一寫）
- [x] 6.7 歸檔：6.6 完成後以 `pnpm exec openspec archive fix-automation-delivery-visibility` 歸檔
