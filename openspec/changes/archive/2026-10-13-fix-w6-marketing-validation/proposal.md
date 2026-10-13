## Why

UAT E2E 行銷 LINE 欄位測試仍有 3 個 `test.fail` 記錄的已知 bug：

| 測試 | 問題 |
| --- | --- |
| CM-W6-01 | 行銷活動的結束日早於開始日也能建立 |
| CM-W6-02 | 廣播的排程時間可以是過去。排程器每 60 秒取 `scheduledAt <= now` 的廣播執行，所以填錯成過去時間的廣播會在一分鐘內**立即發送**給客人 |
| CM-W6-04 | 關鍵字回覆的關鍵字驗證已在 `7a4e655c`（2026-09-22）修好；剩下 `send_material` 動作的 `materialId` 只檢查非空字串，非 UUID 或不存在的素材都能存，規則建起來卻永遠發不出訊息 |

## What Changes

- 行銷活動：建立與修改時，結束日早於開始日回 400，指出 `endDate`；修改時以修改後的起訖比對。日期字串無法解析時回 400。
- 廣播：建立時 `scheduledAt` 必須是可解析、晚於現在的時間，否則回 400 並指出 `scheduledAt`。檢查放在 `createBroadcast()`，REST 與 MCP 都會套用。
- 自動化規則：建立與修改時，`send_material` 動作的 `materialId` 必須是同租戶、啟用中的素材，否則回 400。

## Capabilities

### New Capabilities

- `marketing-scheduling`：行銷活動期間與廣播排程時間的規則。

### Modified Capabilities

- `automation-engine`：新增「傳送素材動作要指向存在的素材」。

## Impact

- API：`marketing/campaign.service.ts`、`marketing/marketing.service.ts`（`createBroadcast`）、`automation/automation.service.ts`
- UAT E2E：3 個 `test.fail` 改為一般測試
- 文件：`CHANGELOG.md`、`docs/ref/features/tenant/MARKETING.md`
