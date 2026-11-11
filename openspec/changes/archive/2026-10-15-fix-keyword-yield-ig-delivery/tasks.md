## 1. AI 只在關鍵字規則能在該渠道回覆時讓步

- [x] 1.1 測試 `apps/api/tests/unit/modules/automation/keyword-yield-channel.test.ts`：「規則的素材是這個渠道的」「規則的素材是別的渠道的」「規則傳送文字」「規則不回覆顧客」「沒有命中任何規則」，先確認失敗
- [x] 1.2 `hasMatchingKeywordRule` 多收對話渠道，只把有能回覆動作的規則算進去；agent 路徑（`automation.worker.ts`）與 KB 路徑（`kb-autoreply.service.ts`）都傳入渠道
- [x] 1.4 測試「網站聊天室的規則送不出去」先確認失敗；`channel-plugins` 新增 `AUTOMATION_DELIVERY_CHANNEL_TYPES`，API 依此判斷，workers 測試檢查外掛清單與它一致（PR #276 bot review）
- [x] 1.3 更新 `keyword-suppresses-ai.test.ts` 的原始碼比對（呼叫多了渠道參數），commit 說明是本 change 有意改變

## 2. 素材渠道不符時留下紀錄

- [x] 2.1 測試 `apps/workers/tests/unit/lib/automation-material-channel-mismatch.test.ts`：「LINE 素材遇到 IG 對話」，先確認失敗
- [x] 2.2 `send_material` 渠道不符時寫入標示沒有送出的系統訊息

## 3. workers 註冊 IG 外掛

- [x] 3.1 測試 `apps/workers/tests/unit/lib/plugin-registry.test.ts`：「Workers send to Instagram」（THREADS 有外掛），先確認失敗
- [x] 3.2 workers 的外掛清單抽成 `createWorkerPluginRegistry()` 並加入 threadsPlugin

## 4. 完成檢查

- [x] 4.1 `pnpm test` 通過
- [x] 4.2 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 4.3 `CHANGELOG.md` 補 Fixed
- [x] 4.4 `node scripts/validate-openspec.mjs fix-keyword-yield-ig-delivery` 與 `--specs` 通過
- [x] 4.5 部署後在 UAT 用 IG 傳「你好」，確認 AI 有回覆，且對話有「素材沒有送出」的紀錄
