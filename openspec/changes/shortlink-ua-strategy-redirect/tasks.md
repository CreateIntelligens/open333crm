## 1. 資料庫 Schema

- [x] 1.1 `packages/database/prisma/schema.prisma` — `ShortLink` 加 `lineChannelId String? @db.Uuid`、`ogTitle String?`、`ogDescription String?`、`ogImage String?`，並加 `lineChannel Channel? @relation(...)` 與 `@@index([lineChannelId])`
- [x] 1.2 `ClickLog` 加 `lineUid String?` + `@@index([lineUid])`
- [x] 1.3 `prisma migrate dev` 產生 migration（皆 nullable、向後相容），更新 generated client — 本機 DB 離線，改手寫 migration `20260623000000_add_shortlink_ua_strategy`（格式同 Prisma 產出，`migrate deploy` 時套用）；client 已 `prisma generate`
- [x] 1.4 確認 `Channel.settings` 沿用既有 JSON（LINE `liffId` 走 `settings.liffConfig.liffId`，無 schema 變更）

## 2. 後端 — UA 偵測器 + 策略模式

- [x] 2.1 新增 `apps/api/src/modules/shortlink/source-detector.ts`：`detectSource(ua): 'BOT'|'EXTERNAL_BROWSER'|'LINE_WEBVIEW'|'FB_WEBVIEW'`，比對順序 BOT → LINE_WEBVIEW →（FB_WEBVIEW 預留）→ 預設 EXTERNAL_BROWSER
- [x] 2.2 Bot 清單為可設定常數陣列，預設 `['line-poker','facebookexternalhit',...]`；LINE webview 比對 `line/`（含斜線、避免誤判 bot）
- [x] 2.3 定義 `RedirectStrategy` 介面（`render(ctx) → { status, headers, html }`）與 `strategies/` 目錄（types.ts + render-utils.ts + index.ts getStrategy）
- [x] 2.4 `strategies/bot.strategy.ts`：回 200 靜態 HTML 只含 `og:*`（取自 ShortLink 快照，缺則退回 `title`），**不呼叫任何計數**，`Cache-Control: no-store`
- [x] 2.5 `strategies/external-browser.strategy.ts`：回 200 微型 HTML，inline target（含 UTM）→ `<script>` 先 `navigator.sendBeacon('/s/track', body)` 再 `window.location.replace(target)`，`Cache-Control: no-store`
- [x] 2.6 `strategies/line-webview.strategy.ts`：查 `ShortLink.lineChannelId → channel.settings.liffConfig.liffId`；有 `liffId` → 回 HTML `location.replace('https://liff.line.me/{liffId}?s={slug}&cid={cid}&lid={liffId}')`；無 → 委派給 external-browser 策略（退化）

## 3. 後端 — GET `/s/:slug` 改寫（分流）

- [x] 3.1 `apps/api/src/modules/shortlink/shortlink-redirect.routes.ts` 改寫 GET：載入 link → 檢查 `isActive`/`expiresAt`（`getLinkForRedirect`）→ `detectSource` → `getStrategy` render
- [x] 3.2 失效/不存在連結：`renderExpiredPage()` 回 404 + 友善 HTML（Bot 不渲染假 OG、真人看到失效頁）
- [x] 3.3 GET 階段**完全不寫 DB、不計數**（移除 `handleClick`、改用唯讀 `getLinkForRedirect`）

## 4. 後端 — `POST /s/track`（唯一計數點 + 身份解析）

- [x] 4.1 在 `shortlink-redirect.routes.ts` 新增 `POST /track`：`parseTrackBody` 同時支援 `sendBeacon` 的 `text/plain`（字串 → JSON.parse）與 `fetch` 的 JSON（物件），欄位 `{ slug, cid?, lineUid? }`
- [x] 4.2 `shortlink.service.ts`：`handleClick` 計數邏輯抽成 `trackClick(prisma, slug, meta, io)`：檢查 active/expired → 建 `ClickLog`（含 `lineUid`）→ 累加 `totalClicks`，`totalClicks` 每次 +1；`uniqueClicks` 預設 +1，只有「有 `lineUid` 且已記錄過」才不 +1（依 lineUid 去重、跨網路穩定；無 lineUid 一律當新 unique）→ 自動貼標（貼解析後的 clicker）→ `eventBus.publish('link.clicked')` → `io.emit('link.stats.updated')`
- [x] 4.3 新增 `resolveContactByLineUid(prisma, channelId, lineUid)`：用 `ChannelIdentity(channelId_uid)` 回推 contactId；對不到回 null（`lineUid` 仍存於 ClickLog，留給 identity-stitcher）
- [x] 4.4 `trackClick` 回傳解析後 `targetUrl`（含 UTM）；`POST /s/track` 回 `{ success, data: { targetUrl } }`
- [x] 4.5 CORS：既有全域 `cors.plugin.ts`（`origin: true`）已涵蓋 web origin；失效/不存在連結 → 不計數、回 410
- [x] 4.6 確認 `handleClick` 僅被 redirect route 引用，已以 `trackClick` + 唯讀 `getLinkForRedirect` 取代

## 5. 後端 — OG 抓取 service

- [x] 5.1 新增 `apps/api/src/modules/shortlink/og-scraper.ts`：`scrapeOg(url) → { ogTitle?, ogDescription?, ogImage? }`，限 `http(s)`、逾時 5s、回應大小上限 512KB、DNS 解析 + 阻擋私網/loopback IP（SSRF）、相對圖片補絕對 URL、失敗回空物件
- [x] 5.2 service `createShortLink`/`updateShortLink` 接受 `lineChannelId`、`ogTitle/ogDescription/ogImage`；未手動提供 OG 時 `maybeScrapeOg` 背景抓取存快照（不阻斷回應）；手動值優先（任一 og 有值即不抓）
- [x] 5.3 `createShortLink`/`updateShortLink` 寫入新欄位（`lineChannelId`、`og*`）

## 6. 後端 — LINE 渠道 `liffId` 設定

- [x] 6.1 沿用既有 `PATCH /channels/:id`（已接受 `settings`）+ 前端 merge 模式（同 `BotConfigForm`）寫 `settings.liffConfig.liffId`，無新 endpoint
- [x] 6.2 服務層 `assertLineChannel`：`lineChannelId` 必須是本租戶 `channelType=LINE` 的渠道，否則 throw（route 轉 400）

## 7. 前端 — LIFF 兩頁（Next.js）

- [x] 7.1 LIFF SDK 動態載入器 `apps/web/src/lib/liff.ts`（CDN `sdk.js`，無 npm 依賴）
- [x] 7.2 新增 `apps/web/src/app/liff/redirect/page.tsx`（進入點，不計數）：讀 `s`/`cid`/`lid` → `liff.init({ liffId: lid })` → 未登入 `liff.login({ redirectUri: '/liff/callback?s=&cid=&lid=' })`；已登入則自行 `location.replace('/liff/callback?...')`
- [x] 7.3 新增 `apps/web/src/app/liff/callback/page.tsx`（唯一計數）：`liff.init` → `getProfile()` 取 `userId`(lineUid) → `fetch POST ${REALTIME_ORIGIN}/s/track {slug, cid, lineUid}` → 取回 `{ targetUrl }` → `window.location.replace(targetUrl)`
- [x] 7.4 失敗/取消處理：`getProfile`/init 失敗時，仍 `fetch /s/track {slug, cid}`（無 lineUid）後跳轉（不卡死）

## 8. 前端 — 短連結表單 + 型別

- [x] 8.1 `components/shortlink/LinkFormDialog.tsx` 加「LINE 渠道（LIFF）」下拉（`useChannels` 過濾 `channelType=LINE`；不選 = null = 不走 LIFF）
- [x] 8.2 表單加 OG 欄位（`ogTitle/ogDescription/ogImage`，可留空 → 後端自動抓取預填）
- [x] 8.3 `hooks/useShortLinks.ts` 匯出 `ShortLink`/`ClickLog` 介面（含 `lineChannelId`、`og*`、`lineUid`）；`links` 維持寬鬆型別避免破壞既有消費端
- [x] 8.4 LINE 渠道設定（`BotConfigForm`）加 `liffId` 輸入（merge 寫 `settings.liffConfig.liffId`，同既有 botConfig merge-save 模式）

## 9. 驗證

- [x] 9.1 typecheck：API + web `tsc --noEmit` 皆通過
- [x] 9.2 完整 build：`pnpm build` 13/13 packages 全綠（含新 `/liff/redirect`、`/liff/callback` 頁）
- [x] 9.3 靜態邏輯驗證（13/13 通過）：detector 分流順序（含 `line-poker → BOT` 勝過 webview）、bot HTML 有 og 無 beacon、external beacon+replace+inline target、LINE 組 `liff.line.me/{liffId}?s=&lid=`、無 liffId fallback、expired 404。**Live DB/LINE 端對端**（真實 ClickLog 寫入、LIFF 同意、LINE 預覽卡）需部署環境（本機 DB 離線），待 UAT 驗證
