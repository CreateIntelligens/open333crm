## 1. 沒有綁定的渠道不可見

- [x] 1.1 測試 `apps/api/tests/unit/services/channel-visibility.test.ts`：Unbound channel hidden from a member、Member without any binding、Head office sees every channel（改寫原本斷言 legacy 可見的案例）
- [x] 1.2 實作：移除 `getAccessibleChannelIds()` 與 `resolveChannelAccessLevel()` 的 legacy 分支

## 2. 回填

- [x] 2.1 測試 `apps/api/tests/feature/migrations/backfill-unbound-channel-access.test.ts`：Unbound channel bound to all active members、Bound channel unchanged、Backfill runs twice
- [x] 2.2 實作 migration `20261005120000_backfill_unbound_channel_access`（含執行身分檢查）

## 3. 建立渠道時指定可見成員

- [x] 3.1 測試 `apps/api/tests/unit/modules/channel/channel-create-visibility.test.ts`：Channel created for chosen members、Channel created without choosing members、Unknown member rejected
- [x] 3.2 實作 `POST /channels` 的 `visibleAgentIds`、Meta 串接建渠道時綁定、前端新增渠道的成員勾選

## 4. 建立成員時指定可見渠道

- [x] 4.1 測試 `apps/api/tests/unit/modules/agent/agent-create-channels.test.ts`：Member created with chosen channels、Member created without choosing channels、Creator cannot grant a channel they cannot see
- [x] 4.2 實作 `POST /agents` 的 `channelIds`、前端新增成員的渠道勾選；編輯成員說明文字

## 5. Code review 修正

- [x] 5.1 測試 `agent-create-channels.test.ts`：New member's level capped at the creator's level；實作 `getAccessibleChannelLevels()`、`resolveChannelGrantScope()` 回傳層級
- [x] 5.2 測試 `channel-create-visibility.test.ts`：Creator without head-office access stays visible、寫入綁定失敗時刪除渠道；實作於 `POST /channels` 與 `createChannel()`
- [x] 5.3 測試 `apps/api/tests/unit/modules/case/assignment-channel-visibility.test.ts`：Assignment skips members who cannot see the channel、Nobody can see the channel；實作 `getNextAgent()` 依渠道過濾
- [x] 5.4 `AccessChecklist` 以 null 表示全選（不送出、重新掛載不重設）；`hashPassword` 移到交易外；有效權限計算與綁定寫入抽成共用函式

## 6. 完成檢查

- [x] 6.1 `pnpm test`、`pnpm test:feature` 通過；`apps/api`、`apps/web` 的 `tsc` 通過
- [x] 6.2 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 6.3 `CHANGELOG.md`、`docs/ref/system/AUDIT.md`、`AUDIT-REVIEWS.md`、`docs/ref/features/tenant/CHANNELS.md`、`INBOX.md`、`MEMBERS.md`、`docs/ref/modules/PERMISSIONS.md` 更新
- [x] 6.4 `openspec validate channel-visibility-fail-closed --strict` 通過
- [x] 6.5 本機實際操作新增渠道、新增成員、編輯成員
