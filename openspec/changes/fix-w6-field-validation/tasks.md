## 1. 升級工單通知對象（case-management）

- [ ] 1.1 測試先行：`apps/api/tests/feature/modules/case/case-escalate-notify-targets.test.ts`「Invalid notify target」：`notifyTargets: ["everyone"]` 回 400、工單不變
- [ ] 1.2 實作：`case.routes.ts` 的 `notifyTargets` 改為 `z.array(z.enum(['supervisor', 'original_assignee']))`
- [ ] 1.3 測試先行：`apps/api/tests/unit/modules/notification/escalation-recipients.test.ts`：「Notify the original assignee」「Notify supervisors and the original assignee」「Escalating agent is the original assignee」「No notify targets given」「Empty notify targets」
- [ ] 1.4 實作：`notification.service.ts` 新增 `resolveEscalationRecipients()`；`case.service.ts` 的 `case.escalated` 事件帶 `notifyTargets`、`previousAssigneeId`、`actorId`；`notification.worker.ts` 改用它（design D1）

## 2. 聯絡人電話（contact-management）

- [ ] 2.1 測試先行：`apps/api/tests/feature/modules/contact/contact-phone.test.ts`「Taiwan and international numbers」「Invalid characters」「Too long」「Clearing the phone」
- [ ] 2.2 實作：`contact.routes.ts` 的 `phone` 規則（design D2）

## 3. LIFF ID（shortlink-ua-strategy）

- [ ] 3.1 測試先行：`apps/api/tests/feature/modules/channel/channel-liff-id.test.ts`「Valid LIFF ID」「Invalid LIFF ID」
- [ ] 3.2 實作：`channel.routes.ts` 驗證 `settings.liffConfig.liffId`（design D3）

## 4. 分析日期區間（analytics-reports）

- [ ] 4.1 測試先行：`apps/api/tests/feature/modules/analytics/analytics-date-range.test.ts`「Reversed date range」「Same day」
- [ ] 4.2 實作：`analytics.routes.ts` 的日期 schema 加先後檢查（design D4）

## 5. 短連結表單（shortlink-routing）

- [ ] 5.1 測試先行：`apps/web/tests/unit/components/shortlink/link-form-dialog.test.tsx`「Whitespace-only target URL」
- [ ] 5.2 實作：`LinkFormDialog.tsx` 以 trim 後的值判斷

## 6. UAT E2E 與完成檢查

- [ ] 6.1 UAT E2E：5 個 `test.fail` 改為一般測試；LIFF ID 測試改送 `settings.liffConfig.liffId`
- [ ] 6.2 `CHANGELOG.md` 新增 Fixed 條目；更新描述這些欄位的 `docs/ref/` 文件
- [ ] 6.3 `pnpm test`、`pnpm test:feature` 通過
- [ ] 6.4 `check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [ ] 6.5 `node scripts/validate-openspec.mjs fix-w6-field-validation` 通過
- [ ] 6.6 合併部署後在 UAT 重跑相關 E2E
