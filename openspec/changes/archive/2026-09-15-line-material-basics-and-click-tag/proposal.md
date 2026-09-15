## Why

競品盤點顯示，「點連結 → 自動貼標 → 分眾再行銷」是台灣 LINE 行銷平台的入場券（Omnichat/MAAC/Super8 三家全做滿）。open333CRM 已有短連結(ShortLink)、點擊追蹤(ClickLog)、規則引擎(automation-engine) 與分眾(Segment)，且「直接路徑」（ShortLink.tagOnClick → trackClick 直接貼 contactTag）可用；但**走「正規自動化規則」的點擊貼標鏈路是斷的**，導致行銷人無法在自動化 UI 用「短連結被點擊」當觸發條件、也不能對點擊者做「加標籤」以外的動作。同時基本 LINE 訊息素材（圖文/影片/多頁）雖已對齊原生，仍有兩處收邊。

## What Changes

- **automation-engine 新增 `link.clicked` 事件**：短連結被點擊時發出的事件，可作為自動化規則觸發器；事件 facts 帶 `shortLinkId` / `slug` / `contactId`，讓規則能針對「哪一條短連結」做條件判斷。
- **worker 動作執行器新增 `add_tag` 動作**：讓自動化規則能對觸發對象（聯絡人）加標籤。目前 worker 只支援 assign/notify/send_message/send_material 等，缺 add_tag。
- **打通正規貼標鏈**：短連結點擊 → 發 `link.clicked` 事件 → 規則引擎（合約驗證放行）→ worker 執行 add_tag。此為第 2 塊核心。
- **（收邊，第 1 塊）** 修正 `line_imagemap` 的 imagemap action postback 降級問題與 `line_video` endCard 的權宜包裝說明，確認發送轉換對齊 LINE 原生。

不在本 change 範圍：行為型分眾條件（「點過某連結/點幾次」直接當 Segment 條件，不先貼標）、素材級點擊歸因（第 5 塊，另開 change）、Rich Menu 分眾（第 3 塊）。

## Capabilities

### New Capabilities
（無全新 capability；皆為既有能力延伸）

### Modified Capabilities
- `automation-engine`: 新增 `link.clicked` 觸發事件（含 facts 定義）與 `add_tag` 動作，打通「短連結點擊 → 自動貼標」的正規規則路徑。
- `material-system`: 收邊 line_imagemap / line_video 的發送轉換行為，確認對齊 LINE 原生。

## Impact

- **automation 合約 (`packages/automation/src/contracts/`)**：
  - `events.ts` 加 `LINK_CLICKED: 'link.clicked'` 事件名 + 定義（label「短連結被點擊」、category、provides scopes 含 contact）。
  - `composer.ts` / `validation.ts` 的合法事件驗證會自動放行（因讀 events.ts 清單）；確認 UI 觸發器下拉會列出。
- **worker (`apps/workers/src/lib/automation-actions.ts`)**：新增 `action.type === 'add_tag'` 分支，對 `context.contactId` 寫 contactTag（冪等：已有該 tag 不重複）。
- **worker facts (`apps/workers/src/lib/automation-facts.ts`)**：`link.clicked` 的 facts 補 shortLinkId / slug，供規則條件比對。
- **短連結 (`apps/api/src/modules/shortlink/shortlink.service.ts`)**：trackClick 已發 link.clicked eventBus 事件（:348）；確認 payload 帶足 facts 欄位。
- **前端 automation 編輯器 (`apps/web`)**：觸發器下拉多「短連結被點擊」、動作下拉多「加標籤」。
- **material (`packages/channel-plugins/src/line/builders.ts`)**：imagemap postback 支援 / video endCard 收邊。
- **相容性**：既有「直接路徑」(tagOnClick) 不動、不移除；新路徑是額外的正規規則路徑。
- **RLS**：add_tag 寫 contactTag 走既有租戶綁定連線，確認不繞過 RLS。
