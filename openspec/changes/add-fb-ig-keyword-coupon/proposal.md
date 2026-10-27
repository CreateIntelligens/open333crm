## Why

關鍵字發券目前只有 LINE 能設定。「LINE 關鍵字回覆」頁存檔時固定加上條件「對話渠道等於 LINE」，素材選單只列 LINE 素材；
自動化規則編輯器又刻意不提供「發送優惠券」動作（add-coupon-system 的需求「自動化規則編輯器不提供發券動作」）。
結果 Facebook 與 Instagram 的商家沒有任何地方能設定「顧客傳關鍵字就發券」，雖然 workers 的發券流程早已支援這兩個渠道。

同一頁還有一個已知 bug：列表的啟用開關按下後，後端已停用，畫面仍顯示「啟用」，要重新整理才更新
（PR #364 bot 審查「規則明細快取在更新或刪除後沒有失效」）。

## What Changes

- 「LINE 關鍵字回覆」頁改名為「關鍵字回覆」，網址維持 `/dashboard/line/keyword-replies`。建立時選渠道（LINE、Facebook、Instagram），
  規則條件綁定所選渠道的渠道類型；素材選單依所選渠道過濾。Instagram 目前沒有素材（素材庫只有 LINE、Facebook），只能發券。
- 已有渠道條件的規則，渠道在建立後不能更改；沒有渠道條件的舊規則，編輯時預設為素材的渠道（沒有素材時為 LINE，等同現在的行為），
  可以改選，並說明儲存後只在所選渠道觸發。
- 列表加上「渠道」欄（LINE、Facebook、Instagram、未限定渠道），並可依渠道篩選。
- 素材渠道與規則渠道不符時，照舊擋下存檔並顯示原因；規則的渠道條件這頁無法辨識時（例如限定網站客服），也擋下並引導到自動化規則編輯。
- 自動化規則編輯器的「對話渠道」條件選項加上 Instagram（值 `THREADS`），Instagram 的關鍵字回覆在編輯器中顯示得出渠道。
- 修正：列表的啟用開關與編輯存檔後，畫面立即顯示新的狀態與內容（規則明細的快取一併重新載入）。
- 後端與 workers 不改：發券、發不出時回覆顧客、AI 讓步早已支援 FB 與 Instagram，本 change 以測試補上證明（見 design「FB／IG 端到端查證」）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `coupon-management`：「關鍵字回覆可以同時發券」改為依所選渠道；「自動化發券沒有發出時可回覆顧客」補上 Facebook 情境；
  新增「關鍵字回覆列表標示渠道」「關鍵字回覆列表在切換或存檔後立即更新」。
- `automation-engine`：「關鍵字回覆頁保留規則上的其他動作與條件」改為依規則的渠道；新增「對話渠道條件列出 Instagram」。

## 與 add-coupon-system 的歸檔順序

本 change MODIFIED 的三條需求——`coupon-management` 的「關鍵字回覆可以同時發券」「自動化發券沒有發出時可回覆顧客」，
與 `automation-engine` 的「關鍵字回覆頁保留規則上的其他動作與條件」——目前**不在** `openspec/specs/`，
而是由尚未歸檔的 `add-coupon-system` 以 ADDED 新增（`coupon-management` 的主規格整份都還不存在）。

依 `openspec/config.yaml` 的規則，這三條要用 MODIFIED，因此：

1. **必須先歸檔 `add-coupon-system`，再歸檔本 change。** 先歸檔本 change 的話，`openspec validate` 只會顯示 INFO，
   但 `openspec archive` 會因為找不到需求而停下（「MODIFIED failed ... not found」），不改任何檔案。
2. 歸檔 `add-coupon-system` 時不需要改它的內容；它描述的是「LINE 關鍵字回覆」上線當時的行為，由本 change 接著修改。
3. 本 change 新增的兩條需求（ADDED）不依賴歸檔順序，但為了一次歸檔，與 MODIFIED 一起等 `add-coupon-system` 歸檔後再歸檔。

## Impact

- 前端：`apps/web/src/hooks/useKeywordReplies.ts`、`apps/web/src/app/dashboard/line/keyword-replies/page.tsx`、
  `apps/web/src/components/line/keyword-reply/KeywordReplyEditDialog.tsx`、`KeywordReplyMaterialCell.tsx`、
  `apps/web/src/components/layout/Sidebar.tsx`（選單改名）。
- 共用套件：`packages/automation/src/contracts/facts.ts`（對話渠道選項加 Instagram）。
- 後端、workers、資料庫：不改程式，不需要 migration。workers 新增測試證明 FB 與 Instagram 的關鍵字發券與發不出時回覆。
- 文件：`docs/ref/features/tenant/AUTOMATION.md`、`docs/ref/features/tenant/LINE.md`。操作手冊（`apps/web/public/manual/`）待 UAT 驗收後另行更新。
