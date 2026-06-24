## Why

目前短連結 `/s/:slug` 走傳統「伺服器端 302 轉址 + 同步計數」（`apps/api/src/modules/shortlink/shortlink-redirect.routes.ts` → `handleClick`）。轉址與計數綁在同一個 GET，造成三個問題：

1. **假點擊**：LINE / FB 等社群平台在貼出連結時，預覽爬蟲（`facebookexternalhit`、`line-poker` 等）會先打一次 `/s/:slug`。現行流程一律 302 並計數，導致每則貼文都先灌一筆假點擊。
2. **無法識別匿名點擊身份**：身份只能靠廣播時塞進 URL 的 `?cid=`（contactId）。使用者若在 LINE 內點擊、但我們 URL 沒帶 `cid`，就完全無法回推是誰。
3. **無法依來源分流**：外部瀏覽器、LINE in-app webview、FB in-app webview 行為需求不同（尤其 LINE 要走 LIFF 收 `lineUid`），但目前一視同仁。

改採 **UA 過濾 + 前端 JS 自動轉址（Zero-Click）+ 策略模式**：伺服器端只依 User-Agent 分流並回 HTML，真正的「1 次點擊」延到前端 JS 用 `sendBeacon` / `fetch` 回報時才記錄。爬蟲不執行 JS → 自然不計數；真人才算數。LINE 來源額外經 LIFF 取得 `lineUid`，把匿名點擊變成可識別身份。

## What Changes

- **GET `/s/:slug` 不再回 301/302**，改為依 UA 分流回 **HTTP 200 + HTML**（策略模式）：
  - **Bot**（`line-poker` / `facebookexternalhit` + 常見社群爬蟲，可設定清單）→ 靜態 HTML 只含 `og:*` meta，**不寫 DB、不計數**。
  - **外部瀏覽器** → 微型 HTML：target 已 inline，JS `navigator.sendBeacon('/s/track')` 背景計數後 `window.location.replace(target)`。
  - **LINE webview**（UA 含 `Line/`）→ 若該連結綁定的 LINE 渠道有 `liffId`，回 HTML `location.replace` 到 `https://liff.line.me/{liffId}?s={slug}&cid=&lid={liffId}`；否則退化成外部瀏覽器行為。
  - **FB webview** → Phase 2（策略模式預留）。
- **新增 `POST /s/track`**（唯一計數點）：接受 `{ slug, cid?, lineUid? }`，建立 `ClickLog`、累加 `totalClicks/uniqueClicks`（唯一鍵優先序 `lineUid > cid > ip`）、自動貼標、發 eventBus / socket 事件，並**回傳解析後的 `targetUrl`（含 UTM）**供 LIFF 頁使用。對 web origin 開 CORS。
- **LINE LIFF 單頁流程**（Next.js）：單一 endpoint 頁 `/liff/redirect` 完成 `liff.init` → 未登入 `liff.login`（`redirectUri` = endpoint 自己）→ `getProfile` 取 `lineUid` → `POST /s/track` → `replace(target)`。計數只在「已登入」那一次，登入循環不重複計。參數用 `sessionStorage` 持久化以撐過 LINE webview 的 `liff.state` reload／登入來回。`/liff/callback` 保留為不碰 SDK 的保險導向頁。
- **身份解析**：`/s/track` 收到 `lineUid` 時，用 `ChannelIdentity(channelId, lineUid)`（channelId 由 `slug → ShortLink.lineChannelId` 取得）回推 contact；對不到則 `contactId=null`、`lineUid` 照存，留給既有 identity-stitcher 之後補關聯。
- **OG 快照**：建立/更新短連結時背景抓取 `targetUrl` 的 OG（`og:title/description/image`）存快照、可手動覆寫；抓取器限 http/https、加逾時與 SSRF（私網 IP）防護。
- **資料模型**：`ShortLink` 加 `lineChannelId`(nullable FK)、`ogTitle`、`ogDescription`、`ogImage`；`ClickLog` 加 `lineUid`；LINE 渠道 `settings.liffConfig.liffId`（JSON，無 migration）。
- **前端**：短連結表單加「LINE 渠道（LIFF）」下拉（不選 = null = 不走 LIFF）與 OG 欄位；LINE 渠道設定頁可填 `liffId`。

## Capabilities

### New Capabilities
- `shortlink-ua-strategy`：短連結依 User-Agent 分流（Bot / 外部瀏覽器 / LINE webview）的策略式重導向、Zero-Click 點擊追蹤、LINE LIFF 身份收集與 OG 預覽快照。

### Modified Capabilities
- `shortlink-routing`：`/s/:slug` 的回應由「302 轉址」改為「UA 對應的 200 HTML」；公開 origin 與 QR URL 規則不變。

## Impact

**程式碼**
- 後端（新增）：`apps/api/src/modules/shortlink/source-detector.ts`、`strategies/{bot,external-browser,line-webview}.strategy.ts`、`og-scraper.ts`
- 後端（改寫）：`shortlink-redirect.routes.ts`（GET 分流 + 新增 `POST /track`）、`shortlink.service.ts`（`handleClick` 計數邏輯抽出成 `trackClick`、新增 `resolveContactByLineUid` 與 OG 寫入）、`shortlink.routes.ts`（create/update 接 `lineChannelId`/`og*` 並觸發抓取）
- 前端（新增）：`apps/web/src/app/liff/redirect/page.tsx`（單頁 endpoint 完整流程）、`apps/web/src/app/liff/callback/page.tsx`（不碰 SDK 的保險導向）、`apps/web/src/lib/liff.ts`
- 前端（改寫）：`components/shortlink/LinkFormDialog.tsx`、`hooks/useShortLinks.ts`、LINE 渠道設定頁（`liffId`）
- CORS：`/s/track` 需允許 web origin（不帶 credentials）

**資料庫**：`ShortLink` + 4 欄、`ClickLog` + 1 欄（需 `prisma migrate`，皆 nullable、向後相容）；LINE 渠道 `liffId` 走 `Channel.settings` JSON（無 migration）。

**API**：新增 `POST /s/track`；GET `/s/:slug` 回應型態改變（200 HTML 取代 302）。

**外部依賴**：LINE LIFF SDK（前端 `https://static.line-scdn.net/liff/edge/2/sdk.js`）；LIFF app 的 endpoint URL 需在 LINE console 註冊指向 `/liff/redirect`（與既有 `line-liff` capability 一致）。

**部署影響**：需跑 `prisma migrate deploy`；前端新增 LIFF endpoint 頁；LINE channel 需設定 `liffId`（未設定者 LINE webview 自動退化成外部瀏覽器、不壞）。

**相容性**：既有 `?cid=` 廣播追蹤照常運作；QR code 仍指向 `/s/:slug`（外部瀏覽器分支）。**行為變更**：依賴 `/s/:slug` 回 302 的外部監控/整合需重新確認（現在回 200 HTML）。
