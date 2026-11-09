## Why

競猜活動可以沒有標任何正確答案就發布（#471）。沒有正確答案時每個人都是 0 分，平均分數與後台作答列表全是 0，競猜實際上等於投票。#447 只檢查發布時至少一個選項，沒有檢查正確答案。

2026-11-09 決定採 A：發布時要求至少一個正確答案，開獎維持從全部作答隨機抽出。

## What Changes

- `POST /portal/activities/:id/publish` 發布競猜前檢查至少一個選項標為正確答案（`isCorrect`）。沒有時回 400，訊息為「競猜活動至少要有一個正確答案」（`AppError` 錯誤碼 `ACTIVITY_CORRECT_ANSWER_REQUIRED`，與 #447 的 `ACTIVITY_OPTIONS_REQUIRED` 同一種寫法），活動維持草稿。
- 檢查加在 #447 的 `assertActivityAnswerable()`，不另寫一份。編輯草稿不檢查正確答案：建立與儲存草稿時可以還沒勾正確答案，與 #447「發布時才擋」一致。
- 後台活動表單的競猜選項區加一行說明「發布前至少勾選一個正確答案」。發布失敗時活動列表已經以 `getApiErrorMessage` 顯示後端訊息，不需修改。
- 開獎 `drawWinners()` 不變，仍從全部未中獎的作答隨機抽出，不看分數。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `portal-activity`：修改「發布時活動必須有可作答的內容」，競猜另外要求至少一個正確答案。

## Impact

- `apps/api/src/modules/portal/portal.service.ts` 的 `assertActivityAnswerable()`、`publishActivity()`。
- `apps/web/src/components/portal/ActivityFormDialog.tsx`：競猜選項區的說明文字。
- 發布路由的錯誤處理不變：service 拋出的錯誤包成 400 `BAD_REQUEST`，`error.message` 是中文原因（與 #447 相同）。
- 已發布的競猜不受影響（只檢查發布當下）。
- 不在範圍：全選即滿分（AUDIT PORTAL-04）、結果端點回傳 `isCorrect`（AUDIT PORTAL-01）、開獎只從答對的人抽出（選項 B）。
