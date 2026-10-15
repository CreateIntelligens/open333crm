## 1. API

- [ ] 1.1 測試 `apps/api/tests/unit/modules/conversation/return-to-bot.test.ts`：「客服接手的對話交回 Bot」「已結案的對話」「已經是 Bot 處理」「渠道的 bot 已關閉」，先確認失敗
- [ ] 1.2 `conversation.service.ts` 新增 `returnConversationToBot()`
- [ ] 1.3 測試 `apps/api/tests/feature/modules/route-permission-guards.test.ts` 加入 `POST /conversations/:id/return-to-bot`：「沒有管理對話的權限」，先確認失敗
- [ ] 1.4 `conversation.routes.ts` 新增路由（`inbox.manage`、渠道完整存取）

## 2. 收件匣

- [ ] 2.1 測試 `apps/web/tests/unit/components/inbox/return-to-bot-button.test.tsx`：「收件匣的交回 Bot 按鈕」，先確認失敗
- [ ] 2.2 新增 `ReturnToBotButton.tsx`，放進 `ChatWindow.tsx` 對話上方

## 3. 完成檢查

- [ ] 3.1 `pnpm test` 通過；`pnpm test:feature` 通過
- [ ] 3.2 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [ ] 3.3 `CHANGELOG.md` 補 Added；`docs/ref/features/tenant/INBOX.md` 補交回 Bot 的說明
- [ ] 3.4 `node scripts/validate-openspec.mjs add-return-conversation-to-bot` 與 `--specs` 通過
- [ ] 3.5 部署後在 UAT 把客服接手的 IG 對話交回 Bot，顧客再傳訊息時 bot 有回覆
