## Why

2026-11-02 在 UAT（創造智能租戶）實測 IG 綁定：顧客在 LINE 傳「綁定帳號」，點回覆裡的 `ig.me/m/{username}?ref={代碼}` 開啟 IG 對話後照說明「傳送任一訊息」，系統沒有收到 ref，不會綁定。
原因是顧客跟 IG 帳號已經有對話時，Meta 不會把 `ig.me` 的 ref 送到 webhook（已訂閱 `messaging_referral`、重新驗證 webhook、換瀏覽器開啟都一樣）。
同一天改成在 IG 貼上代碼送出，確認提示與「確認綁定」都正常，雙邊收到「已完成帳號綁定」。

所以 IG 段落的說明會讓照做的顧客綁定失敗。

## What Changes

- 邀請訊息的 IG 段落從「開啟後請傳送任一訊息」改成「開啟後請傳送這組代碼：{代碼}」，代碼直接寫在段落裡，顧客可以複製。
- LINE、FB、網站客服段落不變。FB 的 `m.me` 在已有對話時也會帶 ref，維持「開啟後若沒有反應，請傳送任一訊息」。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `cross-channel-binding-code`：「顧客可在對話中取得綁定代碼」加情境「IG 連結說明請顧客送出代碼」。

## Impact

- `apps/api/src/modules/identity-binding/binding-links.ts` 的 `buildInviteText()`
- `apps/api/tests/unit/modules/identity-binding/identity-binding-unit.test.ts`
