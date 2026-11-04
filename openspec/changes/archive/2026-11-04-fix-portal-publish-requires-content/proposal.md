## Why

粉絲活動可以在沒有選項（投票、競猜）或沒有欄位（表單）的情況下發布，發布後粉絲打開活動無法作答（#447）。#424 只讓編輯草稿時送空的 `options`／`fields` 回 400，發布沒有同樣的檢查。

## What Changes

- `POST /portal/activities/:id/publish` 發布前檢查活動內容：投票與競猜至少一個選項，表單至少一個欄位。不符合時回 400，訊息沿用 #424 的「投票與競猜活動至少要有一個選項」、「表單活動至少要有一個欄位」（`AppError` 錯誤碼 `ACTIVITY_OPTIONS_REQUIRED`、`ACTIVITY_FIELDS_REQUIRED`），活動維持草稿。
- 編輯與發布共用同一個檢查函式，不另寫一份。
- 建立草稿不變：建立時沒有選項或欄位仍然允許，草稿可以先存再分次補內容（2026-11-04 決定）。
- 後台活動列表的「發布」失敗時已經以 `getApiErrorMessage` 顯示後端訊息，前端不需修改。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `portal-activity`：新增「發布時活動必須有可作答的內容」。

## Impact

- `apps/api/src/modules/portal/portal.service.ts` 的 `publishActivity()`、`updateActivity()`。
- 發布路由的錯誤處理不變：與編輯相同，service 拋出的錯誤包成 400 `BAD_REQUEST`，`error.message` 是中文原因。
- 不在範圍：競猜是否要求至少一個正確答案，尚未決定。
- 已發布的活動不受影響（只檢查發布當下）。
