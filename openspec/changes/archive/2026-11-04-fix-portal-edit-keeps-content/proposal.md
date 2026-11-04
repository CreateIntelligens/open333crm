## Why

編輯粉絲活動草稿時，對話框拿活動列表的資料當編輯內容，而列表不含選項與表單欄位。使用者只改標題就按「儲存」，前端送出 `options: []`，後端收到空陣列就刪光選項，投票選項、競猜的正確答案或表單欄位全部消失，畫面沒有提示（#424，AUDIT PORTAL-03，健檢 HC-PORTAL-01）。

## What Changes

- 後台編輯對話框打開時，以 `GET /portal/activities/:id` 取得完整活動（含選項與欄位）。載入完成前不能儲存；載入失敗時顯示錯誤，不能儲存。
- `PATCH /portal/activities/:id` 沒有帶 `options` 或 `fields` 時，該部分維持不變（既有行為，補上規格與測試）。
- 投票與競猜收到空的 `options`、表單收到空的 `fields` 時回 400，不刪除既有內容。只有草稿能編輯，草稿沒有作答，因此不影響已有人參加的活動。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `portal-activity`：新增「編輯草稿不會清掉沒有送出或不可為空的選項與欄位」。

## Impact

- `apps/api/src/modules/portal/portal.service.ts` 的 `updateActivity()`。
- `apps/web/src/components/portal/ActivityFormDialog.tsx`。
- 建立活動（`POST`）不變：建立時不帶選項仍然允許。
