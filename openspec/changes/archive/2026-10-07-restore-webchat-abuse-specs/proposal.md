## Why

change `fix-security-audit-findings` 在 `aa274cf0` 以改名的方式搬進 `archive/`，delta spec 從來沒有套用（issue #228）。#243 補回了其中 3 份主規格。這個 change 補回剩下的兩部分：

- `security/legacy-webchat-abuse-controls`：公開 WebChat 的濫用防護。程式已經上線，但沒有主規格。
- `webchat-widget` 的 3 條 MODIFIED：主規格仍然描述舊的 `visitorToken` 流程。widget 已經改用 chatbox 工作階段與 claim token，所以主規格與程式不符。

## What Changes

- 新增主規格 `webchat-public-abuse-controls`，6 條需求：
  - 舊的工作階段路由預設停用
  - 公開請求的大小限制
  - 工作階段的有效期限最長三天
  - 訊息與上傳請求的頻率限制
  - 建立工作階段與訪客 socket 連線的頻率限制
  - 頻率限制的計數鍵與日誌不含原始的工作階段憑證
- 修改 `webchat-widget` 的 3 條需求，改成現行的 chatbox 工作階段流程：
  - 「Visitor session initialization」：每次載入建立並 claim 新的工作階段，不產生、不儲存 visitor token。
  - 「Visitor message sending」：訊息與上傳都帶 `sessionId` 與 claim token，API 拒絕屬於其他渠道的工作階段。
  - 「Real-time message delivery to visitor」：socket 的房間由工作階段紀錄決定，不採用用戶端送來的值。
- 修正對照程式時發現的 2 個問題：
  - CHAN-04：widget 送出文字訊息或媒體訊息失敗時，畫面上沒有提示，違反「Message send fails」。現在在那則訊息標示「[傳送失敗]」。
  - CHAN-05：`/webchat/:channelId/media` 與訊息路由共用來源 IP 的計數，違反「訊息達到來源 IP 的上限後仍可上傳」。現在上傳改用 `ip-media` 計數，與 `/chatbox/media` 相同。
- `apps/widget` 新增開發相依套件 `jsdom`，版本與 `apps/web` 相同。widget 在載入時操作 DOM，沒有 jsdom 就無法測試。

歸檔規格的寫法與決定：

- capability 名稱不使用 `security/` 這一層目錄，因為 `openspec/specs/` 底下的主規格都是單層目錄。名稱也不用 `legacy`，因為這些防護適用於所有公開的 WebChat 路由，不只舊路由。
- 歸檔規格的「Public WebChat requests are bound to server state」沒有另寫一條需求。工作階段與 claim token 的驗證已經寫在 `webchat-secure-session`；渠道必須相符，寫在 `webchat-widget` 的「Visitor message sending」。
- 歸檔規格把 `/webchat/:channelId/messages` 與 `/media` 當作舊路由。現行程式中，這兩條路由要求工作階段與 claim token，而且 widget 正在使用。只有 `/webchat/:channelId/sessions` 是停用的舊路由。
- 歸檔規格的「AI or automation quota」，現行程式是每個工作階段、每個渠道每小時的訊息上限。主規格照這個寫。
- 歸檔規格的「Security event is logged」只寫成「頻率限制拒絕時寫 warn 日誌」。其他拒絕（例如工作階段驗證失敗）由錯誤處理統一寫日誌，沒有專屬的事件。
- 頻率限制的數值（例如每分鐘 30 次）沒有寫進主規格。數值是調整用的設定，寫進主規格之後，每次調整都要修改主規格。大小限制寫了數值，因為 widget 在送出前檢查同樣的數值。
- OpenSpec 規定 MODIFIED 需求要保留原本每個情境的名稱，所以保留「Invalid visitorToken」這個名稱，內容改成工作階段與 claim token。原本這個情境也規定「widget 顯示錯誤」，這部分移到新情境「Message send fails」。

## Capabilities

### New Capabilities

- `webchat-public-abuse-controls`：公開 WebChat 路由與訪客 socket 的舊路由停用、大小限制、有效期限、頻率限制與日誌內容。

### Modified Capabilities

- `webchat-widget`：widget 的工作階段、送出訊息與即時訊息，從 `visitorToken` 改成 chatbox 工作階段與 claim token。

## Impact

- `apps/widget/src/index.ts`：修正 CHAN-04。
- `apps/api/src/modules/webchat/webchat.routes.ts`：修正 CHAN-05。
- `apps/widget/package.json` 與 `pnpm-lock.yaml`：新增 `jsdom`。
- `docs/ref/system/AUDIT-REVIEWS.md` 新增複查紀錄。CHAN-04、CHAN-05 在同一個 PR 發現並修正，沒有列入 `AUDIT.md`。
- `CHANGELOG.md`：CHAN-04、CHAN-05 的修正。
- 歸檔後，新主規格的 Purpose 是 CLI 產生的佔位文字，要手動改寫。
