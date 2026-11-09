## Why

issue #475。進站媒體在 API 背景非同步下載，下載完成後 `inbound-side-effects.ts` 用**下載前讀到的訊息內容**加上新的 `storageKey` 覆寫訊息。下載期間剛好對這位客人執行匿名化時：

- 匿名化寫入的 `{ redacted: true }` 被原文覆寫回來，個資沒刪掉。
- 剛上傳的媒體檔也留在物件儲存。匿名化讀訊息時還沒有 `storageKey`，不會刪它。

下載失敗時寫回 `mediaError` 也一樣會把原文寫回。機率低（下載通常幾秒），但違反資料刪除的保證。

## What Changes

- 寫回改成條件寫入，在一個交易內：先以 `FOR SHARE` 鎖住訊息的對話，再以「訊息內容仍等於下載前讀到的內容」為條件更新。
  - 匿名化與硬刪除先以 `FOR UPDATE` 鎖住對話才讀訊息（「刪除期間並行寫入的訊息也被處理」）。寫回先拿到鎖時，刪除等寫回 commit，之後讀到 `storageKey` 並刪除媒體檔；刪除先拿到鎖時，寫回等刪除 commit，之後內容已改變（或訊息已刪除），條件不成立。
- 條件不成立時不寫入、不推送 `message.new`，並以既有的 `deleteFile()` 刪除剛上傳的物件（最多一次，失敗寫 log）。
- 下載失敗時寫回 `mediaError` 也走同一個條件寫入。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-data-erasure`：ADDED「刪除期間完成的進站媒體下載不寫回」。主規格沒有描述非同步媒體下載與刪除同時進行的需求，所以用 ADDED。

## Impact

- api：`apps/api/src/modules/webhook/inbound-side-effects.ts`（新增 `resolveInboundMedia()`，`resolveInboundMediaAsync()` 改為呼叫它、不等待）。
- 測試：`apps/api/tests/feature/modules/webhook/inbound-media-erasure.test.ts`（新增）、`apps/api/tests/unit/modules/webhook/inbound-media.test.ts`（假資料庫改成交易與條件更新）。
- 行為：媒體寫回會等同一個對話正在進行的資料刪除交易結束（通常不到 1 秒）。
- 文件：`CHANGELOG.md`、`docs/ref/features/tenant/GOVERNANCE.md`、`.claude/skills/feature-governance/SKILL.md`。
