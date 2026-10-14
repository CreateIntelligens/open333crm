## 1. 升級對話框

- [x] 1.1 元件測試「Escalation dialog offers no team option」：對話框的通知對象只有主管與原負責客服，送出的 `notifyTargets` 不含 `team`（先確認失敗）
- [x] 1.2 `EscalationModal.tsx` 移除「團隊群組通知」勾選與 state

## 2. API 相容

- [x] 2.1 `case-escalate-notify-targets.test.ts` 的 `team` 測試改寫說明為舊頁面相容（情境「Escalation dialog selects notify team」），確認仍通過

## 3. 文件與驗證

- [x] 3.1 UAT E2E「升級成功」改勾兩個通知對象，並確認沒有第三個勾選
- [x] 3.2 更新 `docs/ref/features/tenant/CASES.md`、`CHANGELOG.md`
- [ ] 3.3 部署後在 UAT 重跑升級相關 E2E
