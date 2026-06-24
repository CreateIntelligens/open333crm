## Context

現行短連結重導向在 `apps/api/src/modules/shortlink/shortlink-redirect.routes.ts`：

```ts
app.get('/:slug', async (request, reply) => {
  const redirectUrl = await handleClick(app.prisma, slug, { contactId: cid, ip, userAgent, referer }, app.io);
  if (!redirectUrl) return reply.status(404).send(...);
  return reply.status(302).redirect(redirectUrl);   // ← 轉址與計數綁一起
});
```

`handleClick`（`shortlink.service.ts:148`）同步組 UTM 後回傳 URL，並 fire-and-forget 寫 `ClickLog` + 累加 `totalClicks/uniqueClicks` + 自動貼標 + `eventBus.publish('link.clicked')` + `io.emit('link.stats.updated')`。

問題：社群預覽爬蟲先打一次就計一次（假點擊）；身份只能靠 `?cid=`；無法依來源（外部瀏覽器 / LINE webview / FB webview）分流。

既有可複用資產：
- `ChannelIdentity (channelId_uid)`、`IdentityMap (tenantId, channelType, uid)` 與 `identity-stitching-engine`（`packages/core/src/identity/identity-stitcher.ts`）— `lineUid → contact` 的對應與後補關聯。
- `line-liff` capability（LIFF app CRUD，`packages/channel-plugins/src/line`）— 管理 LIFF app、取得 `liffId`。
- `Channel.settings` JSON（`schema.prisma:304`）— 放 LINE 渠道的 `liffId`，免 migration（同 `botConfig` 模式）。
- `apps/web` 為 Next.js（非 CLAUDE.md 寫的 Vite），`/line-login/result` 這類公開頁已存在 → LIFF endpoint 頁放這裡。

## Goals / Non-Goals

**Goals:**
- `/s/:slug` 改為 UA 分流回 200 HTML，放棄伺服器端 301/302。
- Bot 不計數、只給 OG 預覽；真人才在前端 `sendBeacon`/`fetch` 時計一次（Zero-Click）。
- 外部瀏覽器無縫直跳、背景計數。
- LINE webview 經 LIFF 取得 `lineUid`、背景計數；LINE 渠道未綁 `liffId` 時自動退化成外部瀏覽器。
- 策略模式：來源偵測與各來源處理可獨立擴充（先做 Bot / 外部瀏覽器 / LINE，FB 留 Phase 2）。

**Non-Goals:**
- 不做 FB webview 分支（`FBAN/FBAV`）— 策略介面預留、實作 Phase 2。
- 不支援單一 tenant 多 LINE provider（v1 假設一 tenant 一 LINE provider）。
- 不在點擊當下硬建 contact（對不到 `lineUid` 就留 null、之後 stitch）。
- 不改 LIFF app 的 CRUD / 註冊流程（沿用 `line-liff` capability）。
- 不做每條連結各自一個 LIFF app（多條 slug 共用同一個 channel 的 `liffId`）。

## Decisions

### 1. 計數點位移到 `POST /s/track`，GET 完全不寫 DB
**選**：GET 只分流回 HTML；唯一計數在前端觸發的 `POST /s/track`。
**沒選**：維持 GET 同步計數。
**理由**：爬蟲不執行 JS → 不會打 `/s/track` → 自然過濾假點擊。真人瀏覽器執行 JS、`sendBeacon` 在頁面卸載時仍可送達，所以「先 beacon 再 replace」不會掉資料。
**取捨**：會跑 JS 的特殊爬蟲/安全掃描仍可能造成少量假點擊（接受；UA 過濾為第一道、JS 為第二道）。

### 2. 策略模式：`detectSource(UA) → SourceType` + 各 `RedirectStrategy`
```
type SourceType = 'BOT' | 'EXTERNAL_BROWSER' | 'LINE_WEBVIEW' | 'FB_WEBVIEW'
detectSource(ua): SourceType            // 比對順序：BOT → LINE_WEBVIEW → (FB_WEBVIEW) → 預設 EXTERNAL_BROWSER
interface RedirectStrategy { render(ctx): { status, headers, html } }
```
**比對順序很關鍵**：必須先比 BOT（`line-poker`/`facebookexternalhit`…），再比 `Line/` webview。因為 LINE 真人 webview 與 LINE 預覽爬蟲都帶 LINE 味道，順序錯會把真人當爬蟲（整條 LINE 流程壞掉）。
**Bot 清單可設定**：預設 `['line-poker','facebookexternalhit','Twitterbot','Slackbot','Discordbot','TelegramBot','WhatsApp','Googlebot','bingbot','Applebot']`；只白名單兩個會讓非 LINE 平台分享沒預覽卡，故預設帶常見社群爬蟲（皆走同一 OG 分支、零成本）。

### 3. Bot 分支自帶 OG 快照（不是 302 給爬蟲）
**選**：Bot 回我們存的 `ogTitle/ogDescription/ogImage` 靜態 HTML。
**沒選**：Bot 直接 302 到 targetUrl 讓爬蟲抓目標站 OG。
**理由**：要支援「活動自訂預覽卡」（與目標頁 OG 不同），且維持「任何來源都不 302」的一致設計。
**代價**：OG 必須有人/系統填，否則卡片空白 → 故採 **建立/更新時背景抓 targetUrl OG 存快照 + 可手動覆寫**（decision 6）。

### 4. LINE 走 LIFF **單頁 endpoint**，「已登入」那一次才計數
**選**：單一 endpoint 頁 `/liff/redirect` 做完 init → login → getProfile → `/s/track` → replace。
**沒選**：兩頁（entry + callback，callback 計數）—— 原本設計，後因 LIFF 路徑限制改掉。
**理由**：
- LIFF 規定 `liff.init()` 只能在「**等於或低於 endpoint URL**」的頁面呼叫。`/liff/callback` 不在 `/liff/redirect` 之下 → 會 warning 且 `getProfile` 被降級擋（`FORBIDDEN: permission not in scope`）。單頁讓所有 `liff.*` 都跑在 endpoint 上。
- 計數只在「已登入」那一次發生（未登入那次只做 `liff.login`、**不**打 `/s/track`），所以登入循環不會重複計數，不需要兩頁。
**眉角**：
- `liff.login` 的 `redirectUri` 必須是 **endpoint URL 本身**（用 `window.location.href`）。指到別的路徑（如 `/liff/callback`）LINE 會回 `invalid url`。
- LINE webview 在 `liff.init` 時會消化 `liff.state` 並 reload，網址參數會掉 → 用 **`sessionStorage`** 在第一次拿到參數時存起來、reload/登入回來再還原（`resolveLiffParams`）。
- `initLiff` memoize `liff.init`（dev 的 React StrictMode 會雙呼叫 effect，重複 init 會卡死）。
- scope 只要 `profile`（取 `userId`=lineUid）；若登入 token 是舊的（profile 未授權）getProfile 會 FORBIDDEN → 失敗時 fallback 成「無 lineUid」照樣跳目標。
- `/liff/callback` 保留為**不碰 SDK 的保險導向頁**（萬一被開到就轉回 endpoint）。

### 5. `slug → lineChannelId → liffId/channelId` 的解析鏈（多 slug 共用）
**選**：`ShortLink.lineChannelId`(nullable FK→Channel)；該 channel 的 `settings.liffConfig.liffId` 決定走哪個 LIFF。多條 slug 可共用同一個 channel。
**沒選**：`ShortLink` 直接存 `liffId`（等於每條連結一個 LIFF，超過 LINE 數量上限、不可行）。
**理由**：
- 組 LIFF URL（GET 階段）：`slug → ShortLink.lineChannelId → channel.liffId → liff.line.me/{liffId}`。
- 解析身份（`/s/track` 階段）：`slug → ShortLink.lineChannelId(channelId) → ChannelIdentity(channelId, lineUid) → Contact`。
- `lineChannelId` 為 null = 不走 LIFF（退化成外部瀏覽器）。表單上的「LIFF 開關」即是「選哪個 LINE 渠道」的下拉。
- LIFF endpoint 頁需要 `liffId` 才能 `liff.init`，故 GET 組 URL 時把 `liffId` 一併帶在 query（`&lid=`），endpoint 頁讀 `lid` 後 `liff.init({ liffId: lid })`；多個 channel 的 LIFF app 可共用同一個註冊 endpoint URL。

### 6. OG 快照在 create/update 時抓取、可覆寫
**選**：建立/更新短連結時背景 fetch `targetUrl`、parse `og:*` 存快照；表單欄位預填、可手動覆寫。
**沒選**：(a) 純手動欄位（行銷易忘 → 醜卡片）；(c) bot 直接 302。
**抓取器防護**：限 `http(s)`、逾時（~5s）、回應大小上限、阻擋私網/loopback IP（SSRF）、相對圖片補成絕對 URL、失敗則留空（不阻斷建立流程）。

### 7. 計數規則：`totalClicks` 每次 +1；`uniqueClicks` 預設 +1，只有 `lineUid` 才去重
**選**：
- `totalClicks`：每次點擊 +1（含重複）。
- `uniqueClicks`：**預設每次 +1**；唯一例外是「有 `lineUid` 且該 `lineUid` 已記錄過此連結」→ 不 +1（依 `lineUid` 去重）。
- 沒有 `lineUid`（純外部瀏覽器、或 LIFF 失敗）→ **一律當新 unique（+1）**。
**沒選**：`ip` 去重（會隨換網路改變、灌 unique）；`lineUid` 不存在時就不計 unique（會讓外部連結 unique=0）。
**理由**：`ip` 不穩定是「換網路還是被算 unique」的根因，故移除。`lineUid` 跨網路穩定，可讓同一 LINE 使用者維持 1 個 unique。沒有 `lineUid` 的點擊無從穩定識別，視為各自獨立的 unique（+1）。
**圖表一致**：`getClickStats` 每日 unique 用 `lineUid || clickLog.id` 當 key —— 有 `lineUid` 去重、無 `lineUid` 以 row id 當各自獨立 unique，與 counter 規則一致。

### 8. `cid` 與 `lineUid` 不一致 = 轉發訊號（只存不另開欄位）
`cid`（我們發給誰）與 `lineUid`（誰真的點）可能不同人（連結被轉發）。**只在 `ClickLog` 加 `lineUid`**、不另開 `sentToContactId` 欄位；需要分析轉發時用 join 比對即可（決策 #5 of 對話）。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| LINE 預覽爬蟲 vs LINE 真人 webview 的 UA 都帶 LINE 味，判斷錯整條 LINE 流程壞 | 偵測器**先比 BOT token**（`line-poker`/`facebookexternalhit`）再比 `Line/`；bot 清單可設定，並以真實 log 驗證實際 UA 字串 |
| 改 200 HTML 後 LINE 預覽需要我們自存 OG，否則卡片空白（相對舊 302「自動有圖」是退化） | create/update 自動抓 targetUrl OG 存快照 + 可覆寫；抓取失敗則退回 `title` |
| 會執行 JS 的特殊爬蟲造成少量假點擊 | 接受；UA 過濾為第一道、`/s/track` 的 JS 觸發為第二道，已大幅優於現狀 |
| LIFF 登入循環造成重複計數 | 單頁：計數只在「已登入」那一次（未登入那次只 `liff.login`、不打 `/s/track`） |
| `lineUid` 對不到既有 contact | `contactId=null`、`lineUid` 照存，交給 identity-stitcher 後補；不硬建幽靈 contact |
| `sendBeacon` 在 `location.replace` 前未送出 | 先 `sendBeacon` 再 `replace`；beacon 設計即為頁面卸載仍送達 |
| `/s/track` 被偽造灌點 | 接受 v1 風險；可後續加 slug 短時 token / rate-limit（Open Question） |
| OG 抓取 SSRF | 限 http(s)、阻私網 IP、逾時、大小上限 |
| 一 tenant 多 LINE provider 時 `lineUid` 跨 provider 不一致 | v1 假設一 tenant 一 provider；`liffId` 與 messaging channel 同 provider（`line-liff` 設定保證），多 provider 留 Phase 2 |
| 依賴 `/s/:slug` 回 302 的外部整合/監控 | proposal Impact 標註；上線前盤點 |

## Migration Plan

1. `prisma migrate`：`ShortLink` 加 `lineChannelId`/`ogTitle`/`ogDescription`/`ogImage`、`ClickLog` 加 `lineUid`（皆 nullable）。
2. 部署 API（新 GET 分流 + `POST /s/track` + CORS）與 web（LIFF endpoint 頁 + 表單）。
3. 在 LINE console：LIFF app 的 **Endpoint URL 指向 `https://<web>/liff/redirect`**、**Scopes 勾 `profile`**、且 LIFF 與 messaging channel **同 provider**；把 `liffId` 填入對應 LINE 渠道設定。
   - 注意：免費 ngrok 的攔截頁會在 LINE webview 擋掉 JS chunk → 用正式網域或無攔截頁的 tunnel（如 Cloudflare Tunnel）測真機。
4. **不需** backfill：既有連結 `lineChannelId=null` → LINE webview 自動走外部瀏覽器分支；`og*` 為空 → 退回 `title`。
5. **Rollback**：revert 後 `/s/:slug` 回 302；多出的 nullable 欄位無害。

**驗證**（部署後）：
- LINE 聊天室貼短連結 → 出現預覽卡、**不**產生點擊。
- LINE 內點開 → 經 LIFF 同意 → 落地目標頁；ClickLog 出現含 `lineUid` 的一筆、`totalClicks` +1。
- 外部瀏覽器點開 → 無縫跳轉、背景 +1。
- 連結未綁 LINE 渠道 → LINE 內點開走外部瀏覽器行為、不經 LIFF。

## Open Questions

- `/s/track` 是否需要防偽（slug 短時 token / rate-limit / Origin 檢查）？v1 先不做，視灌點狀況再加。
- LIFF endpoint 頁重新整理會再計一次（與舊 302 重整一致）；是否要加短時冪等 token？暫不做。
- OG 抓取要不要排程定期刷新（targetUrl OG 會變）？v1 只在 create/update 抓一次。
- FB webview（Phase 2）落地行為：要不要也走某種 OAuth 收 FB id？待定。
