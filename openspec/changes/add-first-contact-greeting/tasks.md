> **前置相依**：本 change 的觸發時機是「聯絡人首次建立」，該路徑在 CM-175 修復前是壞的。
> 必須等 [PR #175](https://github.com/CreateIntelligens/open333crm/pull/175) 合併後才能開始。

## 1. 首次判定（inbound-contact-resolver）

- [x] 1.1 在 `apps/api/src/modules/webhook/inbound-message.types.ts` 的 `InboundMessageContext` 新增 `isFirstContact?: boolean`
- [x] 1.2 `inbound-contact-resolver.ts`：成功 `channelIdentity.create()` 的路徑設 `ctx.isFirstContact = true`
- [x] 1.3 撞 P2002（併發／重複投遞）改用既有 identity 的路徑，`isFirstContact` 維持 false —— 確保只有一個請求判為首次
- [x] 1.4 既有身分命中的快路徑不設此旗標（預設 false）
- [x] 1.5 stitched contact 路徑（`resolveUidToContact` 命中 IdentityMap 後補建 identity）視為首次：該 uid 在此渠道確實是第一次出現

## 2. 招呼語設定讀取

- [x] 2.1 定義 `channel.settings` 新鍵 `firstContactGreeting`（string，未設定或空字串代表關閉）
- [x] 2.2 在 `inbound-side-effects.ts` 新增讀取 helper，比照既有 `getBotConfig` 的取用方式
- [x] 2.3 確認與 WEBCHAT 既有 `welcomeMessage` 互不干擾（兩鍵並存，語意不同）

## 3. 送出招呼語（inbound-side-effects）

- [x] 3.1 新增 `sendFirstContactGreeting(ctx)`，比照 `sendOutsideHoursAutoReply`（`inbound-side-effects.ts:136`）的既有模式
- [x] 3.2 早退條件：`!ctx.isFirstContact` 或招呼語未設定 → 直接 return
- [x] 3.3 變數替換：沿用 `template-renderer` 機制帶入聯絡人變數；解析失敗退回原字串，不擋發送
- [x] 3.4 建立 message：`direction: 'OUTBOUND'`、`senderType: 'SYSTEM'`、`contentType: 'text'`、`metadata: { source: 'first_contact_greeting' }`
- [x] 3.5 更新 `conversation.lastMessageAt`
- [x] 3.6 `emitToConversationAndTenant(... 'message.new' ...)` 推播給後台
- [x] 3.7 `deliverToChannel(...)` 推送至實際渠道
- [x] 3.8 整段包 try/catch，失敗只記 log —— **不得影響 inbound 訊息落地**（CM-175 教訓）
- [x] 3.9 在 `processInboundMessage` 末端、`sendOutsideHoursAutoReply` 之後呼叫

## 4. 發布 contact.created 事件

- [x] 4.1 在 `inbound-contact-resolver.ts` 新建聯絡人後 `eventBus.publish({ name: 'contact.created', tenantId, ... })`
- [x] 4.2 payload 對齊 `packages/automation/src/fact-builder/index.ts:193` 既有期待的欄位形狀
- [x] 4.3 fire-and-forget + try/catch，發布失敗不影響主流程
- [x] 4.4 確認既有 automation listener（`listeners/index.ts:62`）能正確接收

## 5. LINE follow 事件驗證

- [x] 5.1 確認 `follow` 事件（`contentType: 'follow'`）能完整流經 `processInboundMessage` 並觸發招呼語
- [x] 5.2 確認 `follow` 已建立 identity 後，粉絲緊接著的第一則訊息不會重複觸發

## 6. 前端設定 UI

- [x] 6.1 渠道編輯彈窗新增「首次進站招呼語」欄位（textarea，可留空）
- [x] 6.2 附可用變數說明與留空即關閉的提示
- [x] 6.3 沿用既有渠道設定權限，不新增權限點（無需 reconcile）
- [x] 6.4 UI 不放 emoji、成功訊息不加勾勾（依專案 UI 慣例）

## 7. 測試

- [x] 7.1 新粉絲首次來訊 → 送出招呼語且內容完成變數替換
- [x] 7.2 同粉絲後續訊息 → 不再送出
- [x] 7.3 未設定招呼語 → 不送，且 inbound 訊息照常落地
- [x] 7.4 併發／重複投遞 → 僅送一次（模擬 P2002 路徑）
- [x] 7.5 既有聯絡人來訊 → 不誤送
- [x] 7.6 `deliverToChannel` 拋錯 → inbound 訊息仍正常落地（失敗隔離）
- [x] 7.7 `contact.created` 事件有被發布且 payload 形狀正確

## 8. 收尾

- [x] 8.1 `pnpm build` 與相關套件 `typecheck` 全綠
- [ ] 8.2 本機以 WEBCHAT 渠道驗證（LINE/FB 本機收不到 webhook，見專案既有限制）— 待本機環境啟動
- [x] 8.3 更新 `CHANGELOG.md`（`Added` 分類，date-only heading `## [YYYY-MM-DD]`）
- [ ] 8.4 部署 UAT 後以真實 LINE 帳號驗證：加好友即收到招呼語、後續訊息不重複
