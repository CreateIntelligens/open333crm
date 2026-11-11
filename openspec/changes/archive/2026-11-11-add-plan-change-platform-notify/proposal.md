## Why

租戶在「方案與用量」送出升級或加購 Token 申請後，`POST /api/v1/plan-change` 只把申請寫進 `plan_change_requests`。
系統不寄信給平台帳號，平台後台的側欄也看不出有待審的申請，平台方要自己打開 `/admin/plan-changes` 才知道（issue #495）。

租戶通常是 AI 額度快用完才申請加購。平台方沒看到，AI 用完就停止回覆。一個租戶同時只能有一筆待審申請（PLAN-19），
平台方沒發現，租戶也無法送新的申請。

## What Changes

- 新申請建立後，寄信給所有啟用中的平台帳號：租戶名稱、類型、內容、備註，以及 `/admin/plan-changes` 的連結。
- 寄信在回應之後進行，失敗不影響申請。每次寄送的結果（收件人數、寄出數、失敗的收件人與原因）寫一筆平台稽核
  `plan_change.notify_platform`，寄送失敗查得到紀錄，不是只在 log。
- 平台後台側欄的「升級申請」顯示待審數量，沒有待審時不顯示；在升級申請頁核准或駁回後數量跟著更新。
- 不處理 PLAN-17（平台審核後通知租戶）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `plan-change-request`：新增「新申請寄信通知平台帳號」「通知信寄送失敗不影響申請且留下稽核紀錄」「平台側欄顯示待審申請數量」。
  既有需求「租戶送出方案異動申請」沒有規定送出後的副作用，這三條是新的行為，不改既有需求的內容，所以用 ADDED。

## Impact

- API：`apps/api/src/modules/platform/plan-change.routes.ts`、新增 `plan-change.flow.ts`、`plan-change.service.ts`
  （查通知需要的租戶名稱、方案名稱與收件人）、`platform-user-emails.ts`（新的通知信範本）、`platform-audit.service.ts`
  （系統動作的 `platformUserId` 可為 null，資料表本來就允許）。
- Web：`apps/web/src/app/admin/layout.tsx`、`apps/web/src/app/admin/plan-changes/page.tsx`。
- 不改資料表，不需要 migration。
