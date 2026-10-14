## Why

案件升級對話框有「團隊群組通知」勾選，送出 `notifyTargets` 的 `team`。系統沒有實作通知團隊：勾了不會通知任何人，客服卻以為已經通知到了。系統也沒有建立團隊的介面，所以現在實作也沒有團隊可以通知。

## What Changes

- 升級對話框移除「團隊群組通知」勾選，只留「Supervisor（主管）」與「原負責客服」。
- `POST /cases/:id/escalate` 照舊接受 `team`（不通知任何人），舊頁面快取或其他呼叫端送 `team` 不會回 400。

## Capabilities

### Modified Capabilities

- `case-management`：修改「Escalation Notify Targets Are Validated」（升級對話框不提供 `team`）與「Escalation Notifies The Selected Targets」（`team` 情境改為舊頁面相容）。

## Impact

- 前端：`apps/web/src/components/case/EscalationModal.tsx`
- 測試：新增升級對話框元件測試；UAT E2E「升級成功」改勾兩個通知對象；API feature test 說明改為舊頁面相容
- 文件：`docs/ref/features/tenant/CASES.md`
