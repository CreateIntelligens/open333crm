# Changelog

All notable changes to **open333CRM** will be documented in this file.

## [2026-10-28]

### Added

- **素材編輯器「插入領券連結」**（change `improve-coupon-url-insert-ux`）— LINE、FB 純文字素材在「插入顧客專屬券連結」旁新增「插入領券連結」：只列出與素材同渠道（LINE 素材列 LINE、FB 素材列 Facebook 粉專）、啟用、券進行中、沒有結束的領券連結（名稱、券名、渠道），選一條就把公開網址插在游標位置，超過字數上限時擋下並提示；沒有連結時引導到優惠券頁建立；清單一次最多 200 條（最新建立的優先），達到上限時說明並引導到優惠券頁複製。後端新增 `GET /api/v1/coupons/claim-links`（可選 `channelType`；需 `coupon.view` 或 `marketing.manage` 任一）。

### Changed

- **券連結按鈕與說明改白話**（change `improve-coupon-url-insert-ux`）— 「插入券連結」改名「插入顧客專屬券連結」，說明預設只顯示「只能用在附券廣播。」，按「怎麼用？」展開詳細說明；素材預覽把 `{{coupon.url}}` 顯示成「顧客專屬券連結」標籤（儲存的值不變）。
- **含顧客專屬券連結的素材用錯地方時擋下**（change `improve-coupon-url-insert-ux`）— 建立沒附券的廣播而素材含 `{{coupon.url}}` 時回 400（`MATERIAL_NEEDS_COUPON`），建立對話框提醒並停用建立按鈕；自動化規則（含關鍵字回覆、加好友禮）建立或修改動作時，「傳送素材」的素材含 `{{coupon.url}}` 回 400，關鍵字回覆對話框提醒並擋下存檔、規則編輯器提醒。只改名稱或啟用狀態不檢查，已建立的廣播發送時不擋。手冊第 10、18 章修正：關鍵字回覆會把沒代入的 `{{coupon.url}}` 拿掉，不是顯示原字。

- **工單模組改為入口開交易**（#337 階段 3，AGENTS.md 結構規則 2）— `case` 的 service 改收 `TenantCtx`，route 改呼叫新的 `case.flow.ts`；從對話建立工單（`POST /conversations/:id/case`）與 MCP 的工單查詢工具也改走 flow。可觀察的差異：
  - 同一個請求內的寫入一律原子。例如刪除工單與 `case.delete` 稽核在同一個交易寫入，稽核寫入失敗時工單不會被刪除、請求回錯誤；原本是工單照常刪除、稽核遺失。
  - `case.created`、`case.updated`、`case.deleted` 推播在 commit 之後才送出，rollback 時不送出。
  - `case.created`、`case.assigned`、`case.escalated`、`case.resolved`、`case.closed` 事件與資料在同一個交易寫進 outbox，保證至少送出一次；原本行程在送出之前結束時，事件遺失。
  - 建立工單之後的自動指派與廣播歸因，在 commit 之後各自另開交易執行，並在回應送出之前完成；原本與回應並行、不等待。失敗時仍只寫 log，工單照樣建立。
  - 工單標籤與 CSAT 的路由不變，隨 `tag`、`csat` 模組搬遷。
- **標籤模組改為入口開交易**（#337 階段 3，AGENTS.md 結構規則 2）— `tagging.service.ts` 改收 `TenantCtx`，標籤管理頁與聯絡人、工單、對話的貼標路由改呼叫新的 `tag.flow.ts`。可觀察的差異：
  - `contact.tagged` 事件改成與貼標在同一個交易寫進 outbox，commit 之後才送出，保證至少送出一次。原本在交易內直接送出：commit 之前就送出，rollback 時也照樣送出。適用的入口：客服手動貼聯絡人標籤、素材點擊貼標（webhook）、會員綁定時貼標、批次發券時貼領券標籤。
  - 修改素材標籤的名稱時，標籤改名與素材上的標籤字串在同一個交易寫入。原本各自 commit，中途失敗時兩邊的名稱不一致。
  - 短連結點擊貼標的行為不變，隨 `shortlink` 模組搬遷。
- **聯絡人模組改為入口開交易**（#337 階段 3，AGENTS.md 結構規則 2）— `contact.service.ts` 與合併引擎 `contact-merge.service.ts` 改收 `TenantCtx`，聯絡人的查詢、修改、合併與解除合併改呼叫新的 `contact.flow.ts`；MCP 的聯絡人查詢工具也改走 flow。可觀察的差異：
  - 客服手動合併時，`contact.merged` 推播在 commit 之後才送出。原本在交易內送出：commit 之前就送出，rollback 時也照樣送出。
  - 手動合併與解除合併的稽核（`contact.merge`、`contact.merge_revert`）與資料在同一個交易寫入。稽核寫入失敗時，合併或解除合併不生效、請求回錯誤；原本是資料照常寫入、稽核遺失。
  - 綁定代碼、email／手機登記、合併建議、收訊時記錄合併帶進來的身分，這些入口的行為不變，隨各自的模組搬遷。傳送綁定連結、email 登記連結、手機登記連結的路由也不變，隨 `identity-binding` 模組在階段 4 搬遷。

### Fixed

- **UAT 部署在建置 image 時失敗** — 修補依賴安全告警時新增的 pnpm patch（`patches/minio@8.0.7.patch`）沒有複製進 api、web、workers 的 Docker image，`pnpm install` 讀不到 patch 檔而中止（`ENOENT`）。三個 Dockerfile 在安裝相依套件之前先複製 `patches/`。
- **修補依賴安全告警** — 升級 Zod、undici、body-parser、decode-uri-component、fast-uri、ip-address 與 qs 至修補版本；為 MinIO 替換停更的 `stream-json` 1.x JSONL parser，使用 `stream-chain` 的 Node parser，並由 pnpm patch 固定修補。

## [2026-10-27]

### Added

- **平台後台的佇列監控**（change `queue-monitoring`）— 平台後台側邊欄新增「佇列監控」，以 bull-board 9.10.4 列出 API 與 workers 兩個行程的所有 BullMQ 佇列，看得到工作、失敗原因與 stack，可以重送單一個 failed 的工作。只放行讀取與單筆重送，清空、刪除、重送整個狀態、修改工作資料等操作一律 403，bull-board 升級後新增的寫入操作也預設拒絕。工作資料只顯示 id 類欄位，其他值顯示為「[已遮蔽]」。存取限制：來源 IP 須在 `QUEUE_DASHBOARD_ALLOWED_CIDRS` 的網段內（沒有設定時一律 403），再以平台 JWT 換發 1 小時的監控 cookie；cookie 與平台 JWT 不能互換，平台帳號停用或須改密碼時立即拒絕。重送成功時寫入平台稽核 `queue.job.retry`。重送後，工作的回傳值列出被認領擋下而沒有再執行的副作用（`skippedClaims`）。
  - 部署：在 `.env.api` 設定 `QUEUE_DASHBOARD_ALLOWED_CIDRS`（例如公司網段），沒有設定時監控畫面回 403，其他功能不受影響。說明見 `docs/ref/features/platform/QUEUE-MONITORING.md`。
- **維運告警**（change `queue-monitoring`）— 任何佇列的工作移到 failed set（重試用完，或丟出不可重試的錯誤）時，API 發出一則告警，含佇列名稱、工作 id、租戶 id、重試次數與監控畫面的連結，不含失敗原因與工作資料。同一個佇列 10 分鐘內只送一則，下一則帶上這段期間沒有送出的次數。告警經新的 `ops-alert` 佇列送出，失敗時重試 3 次。
  - 部署：建立 Slack Incoming Webhook 之後，在 `.env.api` 設定 `OPS_ALERT_SLACK_WEBHOOK_URL`；沒有設定時告警只寫 log。
- **素材編輯器的「插入券連結」按鈕**（change `add-material-coupon-url-insert`）— LINE 純文字、FB 純文字素材的訊息內容欄位多一顆「插入券連結」按鈕，把 `{{coupon.url}}` 插在游標位置（沒點過輸入框時加在結尾），插入後焦點與游標留在輸入框。按鈕只插入通用佔位字，實際發哪張券仍在「建立廣播 → 附上優惠券」選擇；按鈕下方說明用在關鍵字回覆或一般廣播時不會替換。插入後超過字數上限（LINE 5000、FB 2000）時不插入，並顯示提示。

- **Facebook 與 Instagram 也能設定關鍵字回覆與關鍵字發券**（change `add-fb-ig-keyword-coupon`）— 側欄「渠道 → LINE 關鍵字回覆」改名為「關鍵字回覆」（網址不變），建立時選渠道 LINE、Facebook 或 Instagram，規則帶條件「對話渠道等於所選渠道」，只在這個渠道的對話觸發，對同一渠道類型的所有帳號生效。素材選單只列所選渠道的素材；Instagram 沒有素材，只能發券。列表新增「渠道」欄與渠道篩選。已有渠道的規則不能改渠道；沒有渠道條件的舊規則在這頁儲存時加上所選渠道的條件（預設為素材的渠道，沒有素材時為 LINE），表單會說明。既有 LINE 規則的條件、素材與啟用狀態不變。後端與 workers 不改：發券、「發不出時回覆顧客」與 AI 讓步原本就支援 Facebook 與 Instagram，本次補上測試。
- **建立廣播選到 Instagram 時說明只能附券**（change `add-fb-ig-keyword-coupon`）— 素材庫沒有 Instagram 素材，原本素材選單空著、建立按鈕灰掉卻沒有說明。現在素材欄位改為說明「Instagram 沒有可用的素材，只能附上優惠券、送出預設的發券文字；只會送給 24 小時內傳過訊息給 IG 帳號的人」；沒有素材也沒有附券時，建立按鈕上方說明原因（與後端規則一致）。建立廣播與券詳情頁「發送給…」的渠道選單改為「名稱（LINE／Facebook／Instagram）」，不再顯示 THREADS、FB。
- **自動化規則的「對話渠道」「聯絡人渠道」條件可選 Instagram**（change `add-fb-ig-keyword-coupon`）— 值為 `THREADS`，畫面顯示 Instagram。

### Changed

- **所有 BullMQ 佇列都有保留期限；`notification` 寫入失敗時重試**（change `queue-monitoring`，AUDIT APP-08 部分修正）— `rich-menu-bind`、`data-export` 與 4 個週期佇列（`sla`、`data-export-cleanup`、`tag-expiry-cleanup`、`agent-retention-cleanup`）原本永遠保留完成與失敗的工作，現在完成保留 24 小時、失敗保留 7 天。已排定的週期工作會延續註冊時的選項，所以 workers 啟動時先刪除既有的週期工作，再以新選項重新註冊。`notification` 佇列的兩處生產者加上重試：共 3 次，指數退避，基準 5 秒；站內通知因此是至少一次，workers 在寫入通知之後、工作完成之前停止時，成員會收到兩則相同的通知。Redis 的 `maxmemory` 仍未設定。

- **關鍵字回覆列表的啟用開關按下後畫面沒有更新**（change `add-fb-ig-keyword-coupon`，PR #364 bot 審查）— 後端已停用，列表仍顯示「啟用」，存檔後也仍顯示舊的關鍵字，要重新整理頁面才更新：規則明細的快取以規則 id 為 key，切換或存檔後只重新載入列表。現在同時重新載入列表與規則明細，啟用狀態與名稱以列表的最新值為準。
- **關鍵字回覆頁存檔前的素材防線改為依規則的渠道**（change `add-fb-ig-keyword-coupon`）— 規則限定的渠道與素材的渠道不符時擋下並說明「這條規則傳送的是 Facebook 素材，與所選渠道 LINE 不符，請改選素材或到自動化規則編輯」；渠道條件這頁無法辨識（例如限定網站客服）時也擋下，不再加上第二個渠道條件讓規則永遠不成立。
- **角色與成員管理改成一個請求一個交易**（change `migrate-role-agent-tenant-ctx`，#337 階段 2）— `/api/v1/roles`、`/api/v1/agents` 的每個請求在一個綁定租戶的交易內執行，有三項可觀察的差異：
  - 寫入與租戶稽核一起 commit。稽核寫入失敗時請求回錯誤，資料不變更；原本是資料照常變更、稽核遺失。成員被永久刪除之後，以未過期的 JWT 呼叫這些 route 也會因此失敗。
  - 角色權限快取改在 commit 之後清除，仍在回應之前完成。原本在 commit 之前清除，別的請求可能以舊資料寫回快取，舊權限最多留 10 分鐘。
  - 同一個請求內的寫入一律原子，例如建立成員與寫入稽核原本分兩個交易。
  - 建立、改名、刪除角色時寫租戶稽核（`role.create`、`role.rename`、`role.delete`），原本不寫。
- **`TenantCtx` 只留資料存取；副作用改成收 scope 的函式，由 flow 決定**（同上，架構）— service 收的 `TenantCtx` 只有 `tx`、`tenantId`。`inTenant(prisma, tenantId, fn)` 給入口的 `TenantScope` 多一個 `afterCommit(label, fn)`：commit 之後執行 `fn`，等它完成才回傳。推播、事件、job 與稽核改成獨立函式：`notifyTenant()`、`notifyAgent()`、`publishEvent()`、`enqueueJob()`、`recordTenantAudit()`。`recordTenantAudit()` 在交易內寫稽核，失敗時讓交易 rollback。use case 層沿用 `<name>.flow.ts`：讀寫租戶資料的 route 一律呼叫 flow，查詢也一樣；只呼叫一個 service 的 flow 以 `flowOf()` 組出。`tenantHandler()`、`TenantReply` 已刪除，`coupon`、`store`、`member-binding`、`analytics`、`marketing` 的 route 一併改成呼叫 flow，回應內容與狀態碼不變。`coupon`、`marketing`、`member-binding`、`store`、`automation` 的推播與事件從 service 移到 flow 或入口，送出的時機與內容不變；對話券卡的 `message.new` 推播多帶 `senderId`。規則見 `AGENTS.md` 結構規則 2。
- **`check-tenant-ctx.mjs` 另外檢查 service 直接使用 Redis 與 LLM**（同上）— service 檔以值的 import 引入 Redis client（`@open333crm/core` 的 `redis`、`ioredis`）或 LLM 模組（`ai/llm.service.js`、`ai/providers/`）的次數記進基準檔；腳本解析 TypeScript 語法計數，re-export、動態 `import()`、`require()` 與改名都算，註解不算，只減不增。這些 client 是模組層級的 singleton，型別擋不住 service 在交易內呼叫外部服務，或在 commit 之前清快取；搬遷時改由 flow 注入。

### Fixed

- **啟用個資遮罩的租戶，系統自動發給顧客的固定訊息被改壞**（change `add-admin-ai-deidentification`，2026-10-27 UAT）— 顧客在 IG 輸入「登記 email」，收到「請點選下[姓名]登記您的 email」「連結 30 分[姓名]有效」：系統固定文案也送去 2md 遮罩，「方連結」「鐘內」被誤判成人名，遮罩版同時送給顧客並存入對話。現在程式內固定的系統文案（email／手機登記連結、綁定代碼與帳號整合通知、CSAT 問卷與感謝訊息、預設轉接訊息、交回 Bot 與綁定失敗等內部提示）以原文送出與儲存，遮罩副本仍存在 metadata，AI 只讀遮罩副本。租戶預先寫好、由系統自動發給顧客的文字（營業時間外回覆、首次歡迎詞含帶入的顧客姓名／電話／email、Canvas 訊息節點）也改為原文送出與儲存（「感謝祭」不再變成「感[姓名]」），帶入的顧客資料只送給該顧客本人，AI 仍只讀遮罩副本。2md 失敗時這些訊息與以往一樣不寫入也不送出。座席手打的回覆、座席自填的轉接訊息、KB 自動回覆、AI Agent 回覆、自動化摘要維持原本的遮罩；素材存檔的遮罩這次不改。

- **建立 FB 素材時可以選「大圖／影片廣告」，但這個版型一定發送失敗**（change `fix-fb-material-site-path-urls`）— Facebook 的媒體範本只接受 Facebook 託管的素材，用一般網址發送會回「(#100) 網址參數包含非 Facebook 網址」（2026-10-27 UAT 實測）。版型清單先不提供這個版型，請改用商品輪播或單張圖片；已建立的素材仍可開啟。
- **AI agent 回覆講到一半就斷掉**（創造智能 webchat，2026-10-20）— agent 路徑呼叫 Gemini 時沒有關閉 `gemini-2.5-flash` 的 thinking，推理吃掉大部分 token（實測 thoughts 479／上限 500），可見回覆只剩 17 token、停在「…公司，包含」；而且沒有檢查 `finishReason: MAX_TOKENS`，半句話被當成完成送給顧客。現在 agent 與 KB 自動回覆共用同一套設定：非 pro 模型關閉 thinking，pro 模型 `maxOutputTokens` 至少 2048；回覆被截斷時 agent 標為失敗，改由 KB 自動回覆接手，不再送出半句話。
- **站內通知的即時推播失敗時，通知工作跟著失敗**（change `queue-monitoring`）— workers 寫入通知之後，推播到 Redis 失敗會讓 `notification:dispatch` 工作失敗；加上重試之後會重複寫入通知。現在推播失敗只記 log，工作照常完成：通知已經寫入，成員重新整理就看得到。
- **FB 素材沿用編輯器的示範圖時，廣播整批失敗**（change `fix-fb-material-site-path-urls`，2026-10-27 UAT）— FB「商品輪播」等素材沿用示範圖 `/material-samples/...`，Facebook 回「image_url should represent a valid URL」：原本只有 LINE 素材存檔時把示範圖換成公開網址，FB 素材原樣存站內路徑。現在 FB 素材存檔時，網址欄位裡的站內路徑（`/` 開頭、不是 `//`）都換成 `{WEB_BASE_URL}{路徑}`；已經存成站內路徑的舊素材，由 FB plugin 在發送時轉換（API 的廣播、附券廣播與 workers 的自動化都涵蓋）。有站內路徑但沒有設定 `WEB_BASE_URL` 時，這則訊息不送出，失敗原因寫出是哪個網址。LINE 的行為不變。
  - 部署：確認 `.env.api` 與 `.env.workers` 都有設定 `WEB_BASE_URL`（網站的公開網址）。
- **附券廣播「立即發送」與券詳情批次發券要等一分鐘才發出，畫面也不會自動更新**（change `fix-coupon-broadcast-immediate-run`，2026-10-27 UAT）— 原本只把廣播設成排程時間為現在，實際發送要等每 60 秒一次的排程。現在排入發送的同一個交易在 outbox 排一個 `coupon-broadcast` job，API 行程收到後馬上執行；每分鐘的排程保留為後備，兩者以條件更新搶占，只有一個發送；排程時間還沒到的廣播不會被提前發送。廣播列表在有發送中、或排程時間已到的廣播時每 5 秒自動更新，完成或失敗後停止（券詳情的發放紀錄原本就會自動更新，補上測試）。確認視窗、完成提示與操作手冊第 18 章改為「馬上開始、畫面自動更新」。

## [2026-10-25]

### 🛡️ Security & Runtime Upgrade (Node.js 26.12.1 Security Hardening)
- **容器基底全面升級 Node.js 26 (`node:26.12.1-bookworm-slim`)**:
  - `Dockerfile.dev`、`apps/web/Dockerfile`、`apps/api/Dockerfile`、`apps/workers/Dockerfile` 基底映像全面升級為 `node:26.12.1-bookworm-slim`。
  - 根目錄 `package.json` 中的 `engines.node` 放寬相容範圍至 `>=24.22.1 <27`。
  - 全面啟用最新 V8 引擎，具備原生 Type Stripping、低記憶體佔用與更高效的垃圾回收（GC）。
  - 完整防禦 2026-10-21 官方緊急安全性公告（October 2026 Security Releases）：
    - `CVE-2026-111497` (High - Node2Shell)：封堵 Brotli 解碼器越界寫入 RCE 漏洞。
    - `CVE-2026-105482` (High)：封堵 dns.resolve 空字元截斷漏洞。
    - `CVE-2026-105483` / `CVE-2026-106069` (High)：封堵 TLS 憑證主機名檢查繞過漏洞。
    - 底層搭載 OpenSSL 3.5.9 與最新 CA 根憑證。

## [2026-10-22]

### Added

- **優惠券發券入口補齊**（add-coupon-system design D25～D33，tasks A15）：
  - **LINE 關鍵字回覆可同時發券**：表單新增「同時發送優惠券」（只列進行中的券）與「發不出時回覆顧客」，素材改為選填；存檔只換這頁管的動作並補上「對話渠道等於 LINE」條件。一般自動化規則編輯器不再提供「發送優惠券」，既有動作改為唯讀可刪除。
  - **加好友禮**：「LINE 管理 → 加好友禮」頁，只發給第一次加入的好友（封鎖後再加入不發），以 follow 事件的回覆權杖送出，不計訊息額度。每個帳戶只能有一條加好友禮，經 API 另外建立時回 409。新增自動化事件「加入好友」與條件「第一次加入」；渠道身分記錄第一次／最後一次加入與次數（migration `20261023120000_channel_identity_follow_tracking`，既有 LINE 身分以 `linkedAt` 回填）。
  - **附券廣播**：廣播可附一張進行中的行銷券，每位收件人各得一張券與自己的票券連結；素材含 `{{coupon.url}}` 時代入，沒有時另附發券文字。名額不足照名單順序發完，其餘跳過並記原因；LINE 額度不足整則不送；「立即發送」改排入排程。結果頁列出跳過與失敗原因（migration `20261023100000_broadcast_coupon`）。
  - **券詳情頁「發送給…」批次發券**：搜尋聯絡人、標籤或分眾，單一渠道、最多 1,000 人，與附券廣播共用引擎；新增「發放紀錄」。只需 `coupon.issue` 權限。
  - **公開領券連結（傳訊領券）**：券詳情頁「領券連結」分頁可建立多個連結（名稱、渠道、期間、停用）並下載 QR Code，顯示開啟數與領取數。公開頁 `/coupon/claim/{代碼}` 引導 LINE 加好友並送出預填訊息、FB／IG 開啟對話；入站辨認代碼後直接發券並回覆，不觸發 AI 與關鍵字，領不到時回覆原因（migration `20261023110000_add_coupon_claim_links`，含 RLS）。

### Fixed

- **本機 Docker 開發環境的 `deps` 服務安裝失敗，api、workers、web 都起不來**（#355 之後）。`pnpm.overrides` 把 `tar` 固定在 7，`@tensorflow/tfjs-node` 的安裝腳本以 npm 的 `tar` 解壓 Linux arm64 的 libtensorflow 時，`tar` 7 拒絕壓縮檔裡的連續 symlink（`TAR_SYMLINK_ERROR`）。正式 image 不受影響：`apps/api/Dockerfile` 以 `--ignore-scripts` 安裝，再以系統的 `tar` 解壓、自行編譯 binding。`docker-compose.dev.yml` 的 `deps` 改用同樣的做法：`Dockerfile.dev` 在 build 時下載並解壓 libtensorflow，加裝 `python3`、`make`、`g++`；`deps` 以 `--ignore-scripts` 安裝後，由 `scripts/dev-build-tfjs-node.sh` 編譯 binding（`node_modules` volume 裡已有 binding 時略過）。已有的本機環境要先 `docker compose -f docker-compose.dev.yml build` 重建 image。
- **自動化（關鍵字）發券**：改為先保留、送出成功才確認、送不出作廢並歸還名額；失敗在對話留下看得到的紀錄（原本只寫 log）；網站客服擋下不建券；歸因記規則 id 與名稱，收件匣改顯示券卡並即時更新「已發優惠券」。
- **關鍵字自動回覆一直用推播、計入 LINE 訊息額度**：workers 沒把 `receivedAt` 傳進動作，回覆期限判斷一律改推播；修正後期限內改用回覆。AI 讓步判斷也把發券算進會回覆的動作。
- **「LINE 關鍵字回覆」頁存檔會刪掉規則上的發券動作與其他條件**：改為只更換這頁管理的動作。
- **發券 API 預設記為「對話發券」**：沒帶發放方式時改記 `api`，冒用系統保留的代碼回 400；發送中的券不再出現在序號明細、統計與 CSV 匯出。
- **附券廣播與自動發券的細節**（PR #364 審查）：素材含變數的連結不換短連結時，內部欄位 `tagOnClick` 仍會移除（原本留在 LINE payload）；廣播頁「附上優惠券」逐頁載入全部進行中的行銷券（原本只列前 100 張）；中斷後重送時，上次停在發送中的收件人改標「發送中斷」，不重送也不再一直顯示發送中；自動化發券的收券人一律是對話的聯絡人（原本用事件帶的聯絡人，可能與收到訊息的人不同）。券頁批次發券的勾選名單在 service 也檢查 1,000 人上限（原本只靠路由驗證）；傳訊領券的領券標籤到期時間改以流程的時間計算；LINE 外掛一次超過 5 則時不呼叫 LINE、直接回報錯誤（原本整批送出被 LINE 拒收）。
- **LINE 關鍵字回覆頁存檔會讓「傳送非 LINE 素材」的規則靜默失效**（PR #364 第二輪審查，預防性修正；UAT 查無此類規則）：這頁存檔一律加上「對話渠道等於 LINE」，在一般自動化規則建的「關鍵字＋Facebook 素材」規則出現在這頁時，只改關鍵字就存檔，規則會變成只在 LINE 觸發、卻送 Facebook 素材，從此不再送出。改為：素材不是啟用中的 LINE 素材（其他渠道、已刪除、已停用或讀不到）且沒有改選時擋下存檔並說明原因，列表也標示原因並連到自動化規則編輯。
- **中斷的附券廣播重新排入後，舊的執行若仍在跑會繼續發券並覆寫結果**（PR #364 第三輪審查）：「發送中超過 5 分鐘沒有進度」的廣播可以重新發送，但舊的執行可能只是停滯（例如渠道逾時）。原本兩個執行都會繼續處理收件人，並互相覆寫進度與最終狀態（同時建立收件紀錄時還會撞唯一鍵，把廣播標成失敗）。改以搶占時間（`broadcasts.sentAt`）當執行代次，保留券、更新進度、寫入結果與標記失敗前都要比對，被取代的舊執行停止且不寫入。
- **傳訊領券的發券訊息送不出時，顧客收不到任何回應**（PR #364 第四輪審查）：原本只作廢券並在對話留下紅色紀錄。改為作廢後再回覆一次「目前無法發送優惠券，請稍後再試一次」（只試一次），對話留下顧客實際收到的說明與原因。
- **券頁批次發券的標籤載入失敗時顯示「尚無標籤」**：改為顯示載入失敗的原因與重試按鈕。
- **加好友禮頁看不到既有的「加入好友」規則**：在自動化規則建的歡迎訊息等不發券的加入好友規則，頁面上完全看不到，商家會以為沒有任何設定；改為列出這些規則並說明加好友禮會另外建立、兩條都會執行。
- **附券廣播的人數預覽沒有檢查券**：預覽原本只確認券存在，已暫停的券或客服補償券仍算出人數，按建立才被擋；改為與建立時相同的檢查（進行中；廣播只接受行銷券，券詳情頁批次發放也接受客服補償券），錯誤訊息相同。

### Removed

- **未使用的領取憑證換券端點** `POST /api/v1/fan/coupons/claim`、`claimByToken` 與發券的 `requireClaim`（從未有程式產生領取憑證；資料表欄位保留）。

### Changed

- **CLI 發布 0.1.2**（`@open333crm/cli`）— 自 0.1.1 以來的變更：新增 `open333 a2a execute`（A2A bridge 用，需設 `A2A_CRM_ADAPTER_ENABLED=true` 才啟用）；`engines.node` 改為 `>=24.22.1`。
- `TenantScopedClient` 改宣告為交易 client 的 model 操作加上租戶標記（執行期行為不變），新增資料表不再讓 api 型別檢查出現數百個 TS2349。

### Security

- **處理 GitHub Dependabot 弱點警示** — 直接依賴升到修補版：`fastify` 5.12.7、`@fastify/jwt` 10.2.5（`fast-jwt` 6.3.5，修正 RSA→HS256 演算法混淆與接受未簽章 JWT）、`@modelcontextprotocol/sdk` 1.32.1、`nodemailer` 10.2.0（大版本，只要求 Node ≥20，寄信用法不變）、`axios` 1.20.0、`next` 15.5.28、`sharp` 0.35.5、`socket.io` 4.8.4、`turbo` 2.11.10、`tsx` 4.23（`esbuild` 0.28）；widget 的 `vite` 從 5 升到 6.4.5，根目錄 `vite` 升到 8.3.5。間接依賴以根目錄 `pnpm.overrides` 固定到修補版：`proxy-addr`、`@fastify/busboy`、`follow-redirects`、`hono`、`tar` 7、`adm-zip` 0.6.1、`brace-expansion`、`js-yaml`、`@xmldom/xmldom`、`qs`、`ip-address`、`fast-uri`、`fast-xml-parser`、`moment`、`uuid`、`deepmerge-ts` 8、`postcss-selector-parser` 7.1.6 等。
  - `postcss-selector-parser` 不用 6.1.3：tailwind 3 搭配 6.1.3 會無聲漏掉所有 `group-hover:` 樣式；7.1.6 產出的 CSS 與原本的 6.1.2 位元組完全相同。
  - `tar` 7 與 `adm-zip` 0.6.1 只用在 `@tensorflow/tfjs-node` 的安裝腳本；已實測下載解壓 libtensorflow 與 Linux 預編譯 binding 正常。
  - 未處理（無修補版或覆寫後會壞）：`sprintf-js` 沒有修補版（CVE-2026-97058 已被 NVD 撤銷）；`decode-uri-component` 0.5 與 `stream-json` 3 改成 ESM／新 API，覆寫後 minio 的 `query-string.parse` 與通知 Parser 失效，維持原版本（minio 只呼叫 `stringify`，專案沒有使用 bucket 通知）。

### Changed

- **業務事件改走 outbox，至少送出一次；訂閱者改從各自的佇列取得事件**（#337 階段 1b，change `outbox-event-delivery`，AUDIT RLS-08）— 事件原本經 API 行程內的 EventEmitter 送給訂閱者，API 在 commit 之後、訂閱者做完之前結束（例如部署），通知、自動化規則與對外 Webhook 就不會發生，也不會補做。現在 `ctx.publish`、`ctx.enqueue` 在交易內寫進新的 `outbox` 資料表，與業務資料一起 commit；commit 之後送進佇列，沒送出的由新排程 `outbox-relay` 每分鐘補送，`outbox-cleanup` 每天清掉送出超過 7 天的資料列。通知、自動化與對外 Webhook 各有一個佇列（`event-notification`、`event-automation`、`event-webhook`），Worker 在 API 行程內，每個 Worker 同時處理多個 job，job id 是事件 id，一個訂閱者重試不會讓其他訂閱者再處理一次。還沒搬遷的 `eventBus.publish()` 也送進同樣的佇列，但不寫 outbox，仍是最多一次。workers 的 `create_case`、`add_tag` 在同一個交易寫入 `case.created`、`contact.tagged`；Redis 的 `domain:event` 頻道移除（AUDIT APP-09）。
  - 部署：**API 與 workers 要一起部署**。需要跑 migration `20261022100000_add_outbox_and_side_effect_claims`。Redis 多 5 個佇列，沒有新的環境變數。
  - 內部 API：`ctx.publish` 改成 async，`ctx.enqueue` 改收佇列名稱，選項只接受 `attempts`、`backoff`、`delay`、`priority`、`removeOnComplete`、`removeOnFail`；`claimOne()`、`createOrFindExisting()` 搬到 `@open333crm/core`。

- **同一個事件處理兩次時，對客人的訊息與規則動作不重複**— 新增 `side_effect_claims` 資料表，不能重複的副作用執行前先認領，撞到唯一鍵就跳過。每則入站訊息最多一則機器人回覆（AI agent、知識庫回覆、自動轉接的轉接訊息），已經回覆過就不再呼叫 LLM；情緒分析與 `sentiment.negative` 每則訊息最多一次；workers 的每個規則動作每個事件最多執行一次，沒有指定優先度的升級不會再升一級。站內通知與用量告警信以 `<事件 id>__<收件人>` 當 job id，告警信改走 `usage-alert-email` 佇列，寄送失敗由 BullMQ 重試；寄信服務收下信之後、job 完成之前中斷時，可能多寄一封。`notification`、`automation` 佇列改成完成的 job 保留 24 小時、失敗的保留 7 天（AUDIT APP-08 部分修正）。認領之後送出失敗不重送，這些副作用寧可少送一次，也不重複；認領的交易失敗、或送不出下一步的 job 時，由 BullMQ 重試整個事件。

- **關鍵字規則改由 workers 處理收到的訊息時比對**— API 原本比對關鍵字後發出 `keyword.matched`，再由 workers 執行規則。現在 workers 評估 `message.received` 時一併比對，命中的規則仍以 `keyword.matched` 執行，LINE 照舊用 reply 回覆。`keyword.matched` 只發給對外 Webhook，每則訊息每條規則最多一次。AI 是否讓步與 workers 用同一個比對函式；關鍵字比對、`BotConfig` 搬到 `@open333crm/automation`，判斷 AI 是否讓步的 `hasMatchingKeywordRule()` 搬到 automation 模組的 `keyword-yield.ts`，`kb-autoreply` 不再 import worker 檔（AUDIT ARCH-02）。

- **對外 Webhook 每個網址各自重試，送出的內容帶事件 id**（AUDIT HOOK-01 部分修正）— 原本一個事件的所有網址在 API 行程內以 `sleep()` 依序重試，API 重新啟動時重試遺失。現在每個網址一個 `webhook-delivery` job，共送 3 次、間隔 1 秒與 5 秒，重啟後照常繼續。payload 加 `id`，標頭加 `X-Webhook-Event-Id`；同一個事件送給同一個訂閱只有一筆送出紀錄（`webhook_deliveries` 新增 `eventId`），重試時 `X-Webhook-Delivery` 不變。只轉送對外事件清單內的事件，第一版清單等於所有事件。測試送出（`POST /webhook-subscriptions/:id/test`）改成在請求內只送一次、不重試。

- **Node 24.22.1 後續收尾** — CLI（`@open333crm/cli`）的 `engines.node` 從 `>=24` 收緊為 `>=24.22.1`，與根目錄一致（下次發版生效；npm 上的 0.1.1 仍是 `>=20`）。README 前置需求的 Node 版本從 24.15 改為 24.22.1。新增 `.github/dependabot.yml`，每週監看 4 個 Dockerfile 的 `node` base image，合成一個 PR，不跨大版本；只開版本更新 PR，不啟用 CodeQL / GHAS。

### Fixed

- **已歸戶顧客的票券連結被轉傳後，別人不用驗證就能打開票券夾**（UAT 實測：同一位顧客先用 LINE 驗證，之後 Messenger 的券連結點開就直接進去，可看券甚至顧客自助核銷）。原本只要聯絡人曾完成歸戶驗證，任何票券連結都直接換發顧客憑證。改為「記住裝置＋只認原 email」（design D24）：顧客在某台裝置完成驗證（email 驗證碼、LIFF 或 email 登記）後取得 180 天的裝置憑證，前端存在 `localStorage`，開啟票券時帶上才直接開啟；新裝置或被轉傳的連結改為寄 6 位數驗證碼到聯絡人原本的 email（畫面只顯示遮蔽後的 email，不能改填），新增 `POST /api/v1/fan/coupons/session/code` 與 `/session/code/verify`（10 分鐘有效、同一連結 10 分鐘最多寄 3 次、同一組最多錯 5 次）。只以 LINE 驗證、沒有 email 的聯絡人仍走 email 登記（issue #344）。驗證碼只能用一次：並行送出同一組碼只有一個請求成功；開啟票券的後續流程失敗時可用同一組驗證碼再試。
- **優惠券操作手冊實測發現的問題**（UAT 實機走過三種核銷方式後修正）：
  - 序號包檢查完後按「儲存草稿」，序號沒有寫入券就離開頁面，下次編輯要重新上傳；改為存草稿時一併寫入。
  - 一人一碼的券號範例（表單說明、核銷台手動輸入）寫成「AUTUMN-7K2P-4M9X」，與實際產生的「前綴-10 碼」不符。
  - % 折扣券的折數各處不一致：顧客端、後台券面額與收件匣發券面板把折掉 20% 寫成「80 折」，核銷台寫「8 折」；統一為 8 折（新增 `lib/coupon/discount-rate.ts`）。
  - 店員驗證碼畫面說「此碼會記錄於核銷紀錄中」並稱「核銷碼」，實際不記錄輸入的碼；改為「請店員輸入 N 位數驗證碼」。
  - 顧客自助核銷頁固定顯示「單筆訂單限用一張，不與其他優惠併用」，與商家設定的條款無關；已移除。
  - 顧客自助券存入頁寫「在線上商城結帳時」，但表單建議用於無人商店、活動快閃等實體場景（設計稿 C2.1 原為線上）；改為「結帳時，打開「我的優惠券」即可使用。」
  - 核銷完成頁「請向店員出示此畫面確認」與顧客自助「不需店員」矛盾；改為「可出示此畫面作為使用證明」。
  - 券詳情的核銷數說明「已在門市使用」，但核銷也包含店員驗證碼與顧客自助；改為「已使用」。
  - 「優惠券成效」趨勢圖發出與核銷數字相同時，核銷線完全蓋住發出線；核銷改為虛線。
- **優惠券上線的部署在產生 OpenAPI 文件時失敗**（PR #347 合併後）：優惠券狀態流轉的 4 個路由（publish、pause、resume、end）在迴圈中以 template string 註冊，產生器只認字面值路徑；會員綁定的後台與顧客端路由放在同一個檔案，產生器以檔案對應掛載路徑而重複產生 `/api/v1/fan/member-binding`。改為逐一以字面值註冊，顧客端路由拆到 `member-binding-fan.routes.ts`。新增單元測試以目前原始碼執行產生器，同類問題在 `pnpm test` 就會失敗。
- **Node.js 執行環境升級至 24.22.1 LTS 安全版** — Docker 開發、API、Web、Workers 與部署驗證皆固定使用 `node:24.22.1-bookworm-slim`，根目錄 Node 範圍同步收斂為 `>=24.22.1 <25`，pnpm 安裝階段會拒絕其他版本。此版本包含 Node.js 2026-10-21 安全發布修補的 High 嚴重度 TLS、DNS 與 Brotli 漏洞。

- **同一個資料刪除工作執行兩次時，第二次把已完成的請求改成失敗**— 硬刪除完成後，同一個工作再執行一次會找不到聯絡人，把請求從 `completed` 改成 `failed`。現在 data-erasure 與 data-export 的 worker 開頭以條件更新認領 `pending` 或 `processing` 的請求，已結束的請求直接略過；`processing` 代表上一次執行中途結束，重新處理。data-erasure 把 `completed` 寫在刪除交易的第一個語句，兩次同時執行時只有一次 commit；`completed`、`failed` 都以 `processing` 為條件，只發一則通知。

- **自動轉真人在兩次處理同時進行時可能轉接兩次**— 原本先讀對話狀態，再以 id 更新。現在以條件更新把對話從 `BOT_HANDLED` 改成 `AGENT_HANDLED`，只有更新成功的那次處理寫系統訊息、發出 `conversation.handoff`，commit 之後送出轉接訊息。

- **空白關鍵字的規則命中所有訊息**— API 的關鍵字觸發不排除空白或非字串的關鍵字（AI 讓步判斷有排除），加上存檔驗證之前的舊資料會讓每則訊息都觸發該規則。兩邊改用同一個比對函式，空白關鍵字不命中。

## [2026-10-21]

### Added

- **對話發券**（add-coupon-system A11，design D14，Jira CM-196「對話發券 UX 規格」第一階段）— 收件匣輸入區工具列在附件、範本之後新增「發券」（需 `coupon.issue`），開啟置中 Dialog：
  - 頂部顯示顧客近 90 天的補償次數與元折抵總額，以及最近一筆的券名、發送人、日期與狀態。
  - 只列出發布中的客服補償券，有消費門檻的排前面並標示「可帶動消費」；已達每人上限的券停用並寫出領取與使用日期；固定效期 3 天內結束的券提示到期日。
  - 選券後在同一個 Dialog 確認發給誰、券名與面額、有效期，「發送後無法撤回」；送出中按鈕停用。
  - 成功時 Dialog 關閉、底部提示「已發送 NT$100 補償券」，對話中出現券卡（由哪位座席發送），右側面板新增「已發優惠券」（需 `coupon.view`）並即時更新；輸入框的草稿不受影響。
  - 失敗時 Dialog 不關閉，五種情況各自說明並寫明券是否已發出：券已停止發放、已由其他座席發出、顧客收不到訊息、對話已不在處理範圍、網路逾時（以發送鍵查詢結果，查到前不能重送）。
  - 對話已關閉時按鈕停用並說明原因；Facebook、Instagram 超過 24 小時回覆期限時停用所有選擇。
  - 新 API：`/api/v1/coupon-issue/conversations/:id`（GET 面板資料、POST 發券）、`/requests/:requestKey`、`/conversations/:id/issued`。

### Fixed

- **code review（2026-10-21）修正的安全問題**：
  - 序號明細 API 回傳了還沒領取的券的領取憑證，有 `coupon.view` 的座席拿到就能把券領走；已移除。
  - 手機登記沒有簡訊驗證，卻算歸戶驗證：冒填別人的手機被併入後可打開對方的票券夾。手機登記不再記錄驗證，票券夾只接受 email 驗證碼與 LINE 登入。
  - 票券連結被轉傳時，拿到的人用自己的 email 驗證會把原收券人併進自己的帳號。從票券頁登記時，email 若已屬於另一位顧客改為不自動合併，請顧客在自己的對話中輸入登記關鍵字完成整合（參考 LINE 官方券、Omnichat、麥當勞等「開券不合併帳號」的做法）。
  - 會員綁定端點與 webhook 轉送的內網位址檢查可被 `[::ffff:7f00:1]` 這類 IPv6 寫法繞過；改為展開 IPv6 後判斷（新增 `shared/utils/ip-guard.ts`）。
  - 門市帳號並行送錯密碼可繞過 5 次鎖定；顧客端會員綁定沒有頻率限制且可同時綁給多人。
- **code review（2026-10-21）修正的正確性問題**：
  - 提前結束與發券同時進行時留下可核銷的券；已結束的券改為一律不能核銷。
  - 「開啟後計時」的券不開啟也能核銷、拿到 QR Code，效期形同無限。
  - 對話發券訊息已送出但確認失敗時會清掉發送鍵，座席重送就發出第二張。
  - 批次發券傳入不存在或其他租戶的聯絡人時整批 500，或建出跨租戶的券。
  - 領券貼標把手動貼的永久標籤改成會到期，被排程刪掉；貼標的資料庫錯誤會拖垮整筆發券。
  - 同時建立相同共用碼的兩張券都會成功（新增 migration `20261021140000_coupon_shared_code_unique`）。
  - 店員驗證碼錯誤上限以單張券計算，持有多張可多試；後台以券號核銷不忽略連字號與大小寫。
  - email 驗證碼同時送出兩次時，信中的碼可能無效；票券頁重用的登記連結寄送次數用完後一直卡住；驗證信主旨含驗證碼。
  - 發券視窗「確認中」最長卡 10 分鐘無法關閉，關閉後輪詢仍在跑；顧客核銷斷線時誤說「券尚未被使用」；門市帳號密碼畫面按 Esc 就消失；序號明細日期篩選與表單時間沒用台灣時間；瀏覽器封鎖儲存空間時票券頁無法繼續。
- **優惠券表單（PR #347 bot 審查）**：畫面更新前連點「儲存草稿」（或同時觸發匯入序號的自動存草稿）會建立兩張券，改為等同一次儲存結果；已發布的券存檔後再存一次會重送已存過的欄位，改以最近一次儲存的內容計算差異。發布時序號已匯入、但發布那一步失敗，序號包會被算成 0 筆、顯示「未上傳」而無法重試發布；已寫入後端的序號改為照算。
- **對話發券的作廢與確認同時進行時歸還已發出的序號**（PR #347 bot 審查）：排程作廢卡住的券時，若確認流程剛好在查詢與刪除之間提交，序號包的序號會被歸還、之後發給別人。作廢改為先鎖住這張券再判斷。
- **過期沒用的券仍算進每人上限**：設計稿決定已過期的券不計入（design D14），但系統沒有排程把券改成「已過期」，效期過了仍一直佔名額，顧客拿不到新的一張。改以效期判斷，發券、領取與對話發券面板共用同一個條件（core `countsTowardContactLimit`）。
- **部署**：新增 `scripts/grant-new-role-permissions.mjs`，只補上指定的新權限碼。優惠券上線改用它，不再用會覆蓋租戶角色設定的 reconcile（AUDIT RBAC-05 部分緩解）。

- **共用碼券只能發出一張**：同一張券的每張實例都寫入同一組共用碼，撞到券號唯一約束，第二張起發券失敗。改為每張券有自己的內部券號（以共用碼為前綴），顧客端仍顯示共用碼；顧客手機上的 QR Code 用內部券號，核銷台掃描分得出是哪一位顧客；手動輸入共用券號時提示改掃 QR Code（`SHARED_CODE`）。
- **去掉連字號後相同的序號會查錯券**：序號包允許連字號，AB-CD1234 與 ABCD-1234 可並存，核銷台查券可能取到另一位顧客的券，且每次查券都掃描整個租戶。新增券號比對鍵的唯一索引（migration `20261021110000_coupon_code_key_index`），匯入時去掉連字號後相同視為重複。
- **店員驗證碼可無限嘗試**：錯誤 5 次後重新開始時段又能再試，同時送出多個請求也能繞過上限。改為同一張券 24 小時內累計錯誤 10 次就不能再核銷（`TOO_MANY_ATTEMPTS`），先佔用次數再比對。
- **租戶停用後門市帳號仍可登入核銷台**：登入與每次操作都檢查租戶（`TENANT_DISABLED`）。
- **核銷台重送時誤報已使用**：第一個請求還在處理時以同一個重試鍵重送，第二次會撞「已使用」。改為等待第一次的結果並回傳相同結果。
- **自動化發券沒有領券貼標與發放來源名稱**：貼標與預設來源名稱移到 core，關鍵字自動化與對話發券行為一致。
- **領取憑證換券沒有檢查每人上限**，作廢的券誤報「已被領取」。
- **序號包配發後沒有記錄序號給了哪一張券**。
- **優惠券名單 CSV 可被顧客暱稱注入 Excel 公式**：以 = + - @ 開頭的儲存格加上單引號。
- **同一個發送鍵或重試鍵並發重送會重複發券或核銷**：寫入結果前先刪鍵留下空窗。改為直接覆寫結果；同一個鍵換成別張券回 `KEY_REUSED`。
- **後台建券**：券號前綴 9–12 碼或含符號、數字超過範圍原本回 500，改為說明原因；中文券名匯出 CSV 原本失敗；欄位有錯仍可存草稿且錯誤值被清空；使用條款的 & < > 讀回變成實體字元；複製 30 字名稱的券後無法儲存；序號包上傳把 CSV 標題列當成序號、去掉連字號後相同未視為重複；草稿已匯入的序號無法發布；只有連字號的序號可以匯入。
- **核銷台**：帳號鎖定倒數擋住其他帳號；網路逾時畫面寫「券尚未使用」但券可能已核銷，改為「結果未確認，請按重試」；全形輸入的券號查不到；空白按登入沒有提示。
- **門市設定**：門市名稱前後端上限不一致；用「產生隨機密碼」重設後拿不到新密碼，改為成功後顯示一次。
- **顧客端**：共用碼＋店員掃碼券的「無法掃描請輸入券號」顯示共用碼，改顯示這張券自己的券號；開啟別人的券回 404。
- 券的狀態流轉失敗訊息改用中文狀態名稱。
- **優惠券與會員綁定路由改用 Zod 驗證輸入**：格式不對時回 400 與可讀的訊息，發放方式只接受代號格式。

- **序號明細超過 5,000 筆改背景匯出**（design D22）：匯出時明細超過 5,000 筆，API 回 202 並在背景產生 CSV（存 Redis 24 小時），完成後以站內通知告知匯出者，點通知回到券詳情自動下載；產生失敗也會收到通知。下載端點 `GET /api/v1/coupons/export-jobs/:jobId/download` 只允許匯出者本人。原本一律同步產生，名單大時請求可能逾時。
- **「已發優惠券」區塊即時更新**（design D23）：券發出、顧客開啟票券、在核銷台／後台／顧客端核銷成功時，推送 `coupon.instance.updated` 到租戶；收件匣右側的區塊收到同一位聯絡人或已列出的券的事件就重新載入，不必重新整理頁面。
- **發券連結的點擊歸因**（design D21）：顧客開啟票券連結時，券上記錄第一次開啟時間與開啟次數（未驗證身分也算）。券詳情新增「開啟連結」指標卡（點擊率＝開啟連結 ÷ 發送），數據報表的優惠券成效也顯示開啟連結張數。不另建短網址：每張券的連結都不同，改用短網址會塞滿短網址列表，自動化發券也無法共用。新增 migration `20261021130000_coupon_instance_link_open`。
- **LINE 顧客以 LINE 帳號自動驗證身分**（design D20）：LINE 渠道設定新增「LINE Login Channel ID」，與既有的 LIFF App ID 都填好後，從該渠道發出的票券連結改為 LIFF 網址，顧客在 LINE 開啟時以 ID token 向 LINE 驗證，不必登記 email 或手機。後端以該渠道的 Login Channel ID 驗證，租戶取自票券權杖；ID token 不是收券帳號（連結被轉傳）時拒絕。驗證失敗或沒設定時照舊走 One ID 登記。新端點 `POST /api/v1/fan/coupons/liff-session`。設定頁附上 Endpoint URL 與設定步驟（LIFF Scope 要勾 openid）。

### Changed

- **優惠券、門市核銷台與會員綁定改用租戶交易規則（main #337）**：service 一律收 `TenantCtx`、不自己開交易；後台路由用 `tenantHandler()`，顧客端、核銷台與排程以 `inTenant()` 開交易（入口集中在 `coupon-wallet.flow.ts`、`coupon-inbox.flow.ts`、`store-console.flow.ts`、`member-binding.flow.ts`）。
  - 外部呼叫不在交易內：對話發券的渠道送出、LINE ID token 驗證、外部會員系統查詢都拆成「交易 → 外部呼叫 → 交易」。
  - 券狀態即時事件與匯出完成通知改由 `ctx.notify()`／`ctx.notifyAgent()` 在 commit 後推播；匯出完成通知的房間改為 `tenant:<租戶>:agent:<座席>`（socket 連線時已加入）。
  - 後台批次發券每 50 人一個交易（交易時限 5 秒）；後段批次失敗時回傳已發出的結果與 `stopped`（原因與未處理的聯絡人）。
  - 票券頁的登記連結、店員驗證碼的核銷時段與錯誤次數（Redis）改在交易外操作；核銷成功 commit 後才關閉時段。
  - 券列表的已發／已核銷張數改為一次查詢（原本每張券查兩次）；成效報表新增依發出、核銷期間的索引（migration `20261021150000_coupon_instance_period_indexes`）。
  - 序號明細匯出每 2000 筆一個交易讀取。
  - `node scripts/check-tenant-ctx.mjs --strict` 不再因本分支增加舊寫法（main 既有的 `ai/deidentification.service.ts`、`ai.routes.ts` 兩處除外）。

- **email 登記改為先驗證信箱**（add-coupon-system design D15）：顧客送出 email 後先寄 6 位數驗證碼到該信箱，輸入正確才寫入與歸戶。原本輸入別人的 email 就能併入對方、看到對方的券。驗證碼 10 分鐘有效、最多錯 5 次，同一個登記連結最多寄 3 次；寄信失敗回 502 並保留連結。新端點 `POST /api/v1/public/email-registration/:token/verify`。部署前確認 `EMAIL_DELIVERY_MODE` 不是只寫 log。
- **票券頁需要登記時改為 email 優先**，租戶只啟用手機時才用手機。
- **未驗證顧客重複開啟票券連結不再被限流**：30 分鐘內重用同一個登記連結，不必每次都產生新連結、很快碰到每小時 5 個的上限。
- **數據報表新增「優惠券成效」分頁**（需 `analytics.view`）：期間內發出、已領取、已核銷張數與核銷率（已核銷 ÷ 已領取），每日發放與核銷趨勢（台灣日期，附表格檢視），以及依核銷數排序的券排行前 10 名，可連到券詳情。新 API `GET /api/v1/analytics/coupons`。
- **序號包可以上傳 Excel 或直接貼上**：除了 CSV，也能上傳 .xlsx（第一個工作表的 A 欄，錯誤清單的行號對應 Excel 列號，數字格式的序號以顯示文字讀入），或在輸入框直接貼上一行一碼的序號。
- **票券頁的返回按鈕依渠道顯示**：LINE 顯示「回到 LINE」、Facebook「回到 Messenger」、Instagram「回到 Instagram」，網站客服與連結失效時顯示「回到對話」。原本所有顧客都看到「回到 LINE」。票券連結換憑證的回應新增 `channelType`。
- **機器人處理中的對話不能發券**（design D19）：後端也擋下（409 `CONVERSATION_BOT_HANDLED`），發券面板標示原因，座席要先接手對話。原本只有前端按鈕停用，直接呼叫 API 仍可發出。
- **券的日期一律以台灣時間計算**（design D17）：生效日從台灣時間當天 00:00 起、失效日到當天 23:59:59.999 為止；領取後 N 天改為領取當天（台灣日期）加 N 天、當天結束時到期。後台、對話發券、顧客票券頁與票券夾的日期顯示不再受瀏覽器時區影響。原本以 UTC 午夜為界，失效日當天早上 8 點就到期。
- **對話發券改為先保留再發送**（design D16，取代 D14）：交易內只建立「發送中」的券並立即提交，鎖只維持幾毫秒；訊息在交易外送出，成功才確認券、貼標並寫入對話訊息，失敗就刪除這張券並歸還名額與序號。原本渠道 API 慢時，同一張券的群發、關鍵字發券與其他座席都要排隊。發送中的券顧客看不到但計入上限；新排程 `coupon-stale-pending-issue` 每分鐘作廢卡在發送中超過 5 分鐘的券。新增 migration `20261021120000_coupon_instance_delivery_pending`。
- **對話發券改為送不出就不發券**：發券、送出訊息與寫入對話訊息在同一個交易內完成，顧客封鎖等原因送不出時整筆回滾（409 `COUPON_DELIVERY_FAILED`），券、序號與標籤都不留下。原本券會先入庫，訊息沒送出也回報成功。
- **每人上限改為領過就算**：已使用的券也計入每人上限，已過期與已撤回的不計入（關鍵字、群發與對話發券一致）。
- **同一張券的發券依序處理**：發券時鎖住該券，兩位座席同時發給同一位顧客不會超過每人上限，後到者得知是誰已發出。
- **系統角色「座席」與「主管」預設有 `coupon.view`、`coupon.issue`**。既有租戶部署後要執行 `scripts/reconcile-system-role-permissions.mjs`。
- 對話發券檢查渠道可見性（CM-173）：看不到該渠道或只能看的座席不能發券。
- 移除 `POST /api/v1/coupons/:id/issue-to-conversation`，改用 `/api/v1/coupon-issue/conversations/:id`。
- **顧客票券頁與店員核銷台一律淺色**：`/coupon/*`、`/redeem` 不再跟隨手機的系統深色設定。
- 需要跑 migration `20261021100000_coupon_instance_viewed_at`（顧客第一次開啟票券連結的時間，用來顯示「已領取」）。

## [2026-10-20]

### Added

- **優惠券後台：列表、建立／編輯、詳情三頁**（add-coupon-system A8，Jira CM-196）— 行銷側欄與分頁新增「優惠券」（需 `coupon.view`）。列表可依券名或券號搜尋、依狀態篩選並顯示各狀態張數，可暫停、恢復、提前結束、複製與刪除草稿。建立頁分七個區塊，草稿只需券名；發布時檢查全部必填、列出發布後鎖定的設定與最壞成本，有風險的設定要勾選確認。詳情頁顯示發送、領取、開封、核銷與核銷率，序號明細可依序號（忽略連字號與大小寫）或顧客名稱搜尋，點選序號顯示歷程。後端行為改變：
  - 券型、用途、效期模式、序號模式、核銷方式改為發布時必填，草稿可留空；贈品券、兌換券須填品項。
  - 店員驗證碼限 4–6 位數字，不可連續或重複，開頭的 0 保留。
  - 發布後不可修改券型與面額、用途、效期、序號與核銷設定（409 `COUPON_LOCKED`）；發行總量不可低於已發放張數；共用碼在租戶內不可重複。
  - 只有草稿可以刪除；提前結束時，已發出但未使用的券改為已作廢。
  - 每張券有 `CP-` 開頭的券號；發券時保存來源與座席名稱，之後改名或刪除仍顯示原名；領券自動貼標可設時效天數，到期由既有排程移除。
  - 需要跑 migration `20261020110000_add_coupon_system`、`20261020110100_add_member_binding_config`、`20261020120000_coupon_admin_fields`，並執行 `scripts/reconcile-system-role-permissions.mjs` 補上 `coupon.*` 權限。

- **顧客票券夾：開啟票券前要先完成 One ID 歸戶驗證**（add-coupon-system A9，design D12，Jira CM-197）— 發券訊息改帶票券連結（`/coupon/open/{token}`，7 天內可重複開啟）。顧客本人曾用 One ID 登記連結送出手機或 email 才算已歸戶，直接進入票券；還沒歸戶的顧客先導到登記頁，送出後回到原本的券。客服在後台填寫的手機、email 不算。票券夾分可使用、已使用、已失效三頁，顯示即將到期（剩 3 天內）、未到生效日、活動已提前結束。三種核銷方式：
  - 店員驗證碼：按「立即使用」開 5 分鐘的核銷時段，店員在顧客手機上輸入驗證碼，錯 5 次或時間到要重新開始。
  - 店員掃碼：顯示券號 QR Code，店員核銷後畫面自動切到完成頁。
  - 顧客自助：滑動到底才核銷。
  行為改變：
  - FB／IG 對話發出的券直接存入顧客的券夾，不再產生領取憑證；顧客開啟時一樣要先完成歸戶驗證。
  - 合併聯絡人時，被合併方的券與歸戶驗證會移到保留方，解除合併時還原。原本合併後，被合併方的券會留在封存的聯絡人上。
  - 移除 LINE Account Link 的身分驗證（`/fan/binding/*`、`/fan/auth` 的票據交換）。
  - 需要跑 migration `20261020130000_contact_identity_verified`。既有聯絡人一律是未歸戶，第一次開啟票券時要登記一次。

- **門市與店員核銷台**（add-coupon-system A10，design D13，Jira CM-197）— 後台設定新增「門市與核銷帳號」（需 `store.view`／`store.manage`）：建立門市與門市共用帳號、停業、重設密碼、開關核銷權限、停用、刪除、強制登出，並可列印櫃檯海報（QR 只開啟該門市的核銷台登入頁）。店員用手機開 `/redeem`，以門市帳號登入（保持登入 30 天，否則 12 小時；密碼錯 5 次鎖 15 分鐘），掃描顧客的 QR Code 或手動輸入序號，先查券預覽、確認後才核銷。
  - 核銷台只核銷「店員掃碼」券；店員驗證碼券與顧客自助券提示要在顧客手機上核銷。
  - 每次操作都檢查帳號：已刪除、停用、沒有核銷權限、密碼已重設、被強制登出、門市停業，各自顯示說明。強制登出作用在帳號的所有裝置。
  - 手動輸入序號時不需要打連字號，比對忽略連字號、空白與大小寫。
  - 核銷記錄門市與門市帳號，顧客端的「已使用」顯示核銷門市；網路重試不會重複核銷；兩台手機同時核銷只有一台成功。
  - 今日核銷紀錄只顯示本門市今天（台灣時間）的紀錄，顧客姓名遮罩；折抵總額只計元折抵券。
  - 櫃檯共用手機（閒置鎖定、解鎖碼）與單一裝置登出尚未實作，待 PM 確認規則。
  - 需要跑 migration `20261020140000_store_redemption`，並執行 `scripts/reconcile-system-role-permissions.mjs` 補上 `store.*` 權限。

- **新增 `inTenant()`、`tenantHandler()`：入口開一個綁定租戶的交易，service 改收 `TenantCtx`**— service 原本收 `TenantDb`，傳入的是 `withTenant` 的交易、`request.tenantPrisma` 或 `prismaAdmin`，三者的 RLS 與交易保證不同，service 看不出自己受到什麼保護（#337，AUDIT RLS-08）。新寫法由入口開交易：交易內的寫入一起成功或一起失敗；`ctx.notify`、`ctx.publish`、`ctx.enqueue` 登記的推播、事件與佇列 job 在 commit 之後才送出，rollback 時丟棄；route 的回應也在 commit 之後才送出。推播的房間由 `events/socket-push.ts` 決定，service 不指定房間：全租戶推播送到 `tenant:<tenantId>`，給客服人員的推播送到 `tenant:<tenantId>:agent:<agentId>`（成員連線時自動加入），所以不會推到別的租戶。`ctx.enqueue` 不等 job 送進佇列，Redis 沒有回應時回應也不會卡住。新增 `lib/db-invariants.ts`：交易內「撞到唯一鍵就改用既有資料」與「條件更新認領」的共用函式，取代「接住 P2002 再查一次」這種在單一交易內會讓交易失效的寫法。新增 `scripts/check-tenant-ctx.mjs`，舊寫法在任一檔案增加時失敗，由 `pnpm test` 執行。本次不搬既有模組，既有程式的行為不變。

- **平台可逐租戶強制啟用個資遮罩，預設關閉**— 平台租戶詳細頁增加開關，設定與操作稽核在同一交易內寫入，租戶端無法覆寫。啟用後，客服回覆、Agent 每輪上下文（含工具結果與巢狀參數）及 Embedding 文字先送至 2md 做完整類別標記遮罩，再交給模型；政策讀取或遮罩失敗時停止該次模型呼叫。服務回傳的原文 mapping 與 CSV 會被丟棄，原始客服紀錄仍依既有保存規則保留。使用既有平台設定儲存，無需 migration。

- **個資遮罩擴大到所有新寫入的對話訊息**— 渠道進站訊息保留客服作業原文並保存遮罩副本；模型、摘要、跨渠道脈絡與向量化只讀副本。客服回覆預設遮罩並送出遮罩文字，可針對單則訊息選「保留原文」；Bot、Agent、自動化、營業時間、交接、CSAT、Canvas 與系統訊息也會建立遮罩副本。

- **素材庫儲存與版本快照加入個資遮罩**— 租戶啟用後，新增與編輯素材預設先遮罩正文再保存和發送，版本快照也保存遮罩版；客服可針對單筆素材選「保留原文」，系統仍保存遮罩副本。新增 `materials` 與 `material_versions` 的 nullable 遮罩欄位，既有素材在重新儲存正文前維持原狀。

- **FB／IG 群發只送給 24 小時內互動過的人，建立時可以看到可送達人數**— Meta 只允許對 24 小時內傳過訊息的人發一般訊息。原本群發把整份受眾送給 Meta，視窗外的人被擋下、算成發送失敗，大量被擋可能讓粉專被限制發訊，發送前也看不出實際送得到幾人。現在渠道 plugin 宣告訊息視窗（FB、IG 為 24 小時），群發只送給視窗內在該渠道傳過訊息的人，其他人略過、記在新欄位 `broadcasts.skippedCount`，列表顯示「略過 N」；全部被略過時群發標為失敗並寫出原因。新增 `POST /marketing/broadcasts/audience-preview` 預估符合條件與可送達人數，建立群發的表單選好渠道與受眾後顯示，並列出發送注意事項（視窗外的人略過不算失敗、要發給視窗外的人需要 Meta 付費的 Marketing Messages，本系統不支援）；FB／IG 群發按「立即發送」時確認視窗也會提醒。FB／IG 群發的受眾只有「24 小時內傳過訊息的人」，表單不提供分群與標籤。LINE 不受影響。需要跑 migration `20261020100000_add_broadcast_skipped_count`。

- **卡片訊息與圖文訊息可以填預覽文字**— LINE 在聊天列表、手機通知與引用訊息顯示訊息的 `altText`。Flex 編輯器原本就有這個欄位，卡片訊息與圖文訊息的編輯器沒有，送出時一律是「多頁訊息」或「圖文訊息」，收到的人看不出內容。現在兩個編輯器都有「預覽文字」欄位（最多 400 字），沒填或只有空白時照舊用預設文字。原本空字串會原樣送出，LINE 不接受空的 `altText`。卡片訊息切換頁面類型時，原本會把預覽文字與結尾頁清掉，現在保留。

### Fixed

- **Agent 個資遮罩失敗時保留正確執行狀態**— 工具 trace 或最終回覆在遮罩失敗時會停止後續模型呼叫，並將已建立的 Agent 執行紀錄標記為失敗；錯誤紀錄只保存固定原因，不寫入未遮罩內容。

- **滿意度問卷可能寄兩份，客服重開的工單也可能被自動結案**（#333，APP-09）— 寄送滿意度問卷與問卷逾時結案兩個排程，原本先讀工單、只用 id 更新。job 重跑（例如部署時 API 被停掉）、兩期重疊，或排程讀取之後客服重開工單、客人回覆評分時，客人可能收到兩份問卷，工單可能被蓋回 `CLOSED`，`case.closed` 也會發兩次。現在兩個排程都先以條件更新認領工單：寄問卷前先寫入寄出時間，條件是工單仍是 `RESOLVED`、還沒寄過；結案的條件是工單仍是 `RESOLVED`、客人還沒回覆。認領失敗就不寄、不結案。認領之後任何一步失敗，或行程中途結束時，這張工單會少處理一次，不會重複處理。

## [2026-10-19]

### Changed

- **API 行程內的排程改由 BullMQ Job Scheduler 觸發**（APP-09 部分修正）— 群發、CSAT 發送與自動結案、Canvas 喚醒、閒置關閉、試用、權杖檢查與報表彙總，原本各自用 `setInterval`、`setTimeout` 觸發，API 有幾個行程就各跑幾份。現在各模組以 `registerSchedule()`（`apps/api/src/lib/job-scheduler.ts`）註冊，排程存在 Redis，不論有幾個 API 行程，每一期只產生一筆 job；執行中的行程被強制結束時，BullMQ 會重新執行這筆 job。頻率不變，報表彙總仍是行程時區的 02:00。行為改變：
  - API 重啟不再立刻執行各排程，改為照原本的週期執行；報表彙總也不再在啟動時彙總前一天。過去每次部署都會額外執行一次。只有第一次部署（或 Redis 裡沒有排程資料）時，每隔固定時間的排程會一起立刻執行一次。
  - Redis 斷線期間排程停止執行；Redis 恢復後，到期的那一期補跑一次。
  - Canvas 喚醒與試用排程以 Redis 鎖防止兩期重疊。Canvas 的鎖取代只在單一行程有效的旗標。權杖檢查原本的 `withLeaderLock()`（`apps/api/src/lib/scheduler-lock.ts`）已移除。

- **import `@open333crm/core` 不再連 Redis，也不再多跑一個 SLA Worker**（#327，APP-01）— core 的 `redis` 原本在 import 時就連線，`cases/case-service.ts` 也在 import 時建立 `sla-monitoring` 的 Queue 與 Worker，所以 API、workers 與每個 import core 的測試檔都連到 Redis，並各跑一個沒有生產者的 SLA Worker。現在 `redis` 在第一次執行指令時才連線；`CaseService` 與唯一使用它的 `AutomationEngine` 沒有呼叫端，已刪除。其他改動：
  - `ioredis` 只裝一個版本：`apps/api` 與 `packages/core` 改成和 `apps/workers`、bullmq 一樣鎖定 `5.9.3`。升級 bullmq 時要一起改。
  - `packages/channel-plugins` 與 `apps/workers` 加上 `"type": "module"`，改編譯成 ESM。只改 channel-plugins 時，CJS 的 workers 匯入它轉發的外掛會變成 `undefined`（CM-175 的組合），所以兩個一起改。
  - `apps/api` 的 unit 測試設定移除 #299 的暫時做法，只留一個 `vi.mock('ioredis')`。

### Fixed

- **圖文訊息保留示範底圖時存不了檔**— 新建圖文訊息預設帶入的示範底圖是站內路徑 `/material-samples/promo-banner.jpeg`，有 LINE 渠道的租戶儲存時，LINE 回「底圖網址必須是 https:// 開頭的公開網址」。示範圖的比例（1024×558）也和預設版型 1040×700 不同，點擊區對不上圖。現在示範底圖改由 API 的 `/line-imagemap/demo/{寬度}` 提供 LINE 規定的五種寬度，比例 1040:700，與上傳的底圖格式相同。已存檔、仍用舊示範圖的素材要重新選圖。

- **圖片、影片與卡片訊息保留示範圖時存不了檔**— 編輯器的示範圖是站內路徑（`/material-samples/...`），有 LINE 渠道的租戶儲存時，LINE 回「網址必須是 https:// 開頭的公開網址」。現在 LINE 素材儲存前，後端把示範圖換成 `{WEB_BASE_URL}/material-samples/...`；圖文訊息的舊示範底圖換成示範底圖端點。使用者自己的網址與其他站內路徑不變，FB 素材不轉換。已存檔的舊素材在下次儲存時一併換掉。

- **FB 頭像過一段時間就失效，收件匣只剩名稱縮寫**（IDENT-06）— 系統原本直接存平台給的頭像網址，FB 的網址會過期（回 404）。現在收到訊息時在背景把頭像下載到物件儲存，改存自己的網址；已存著舊網址的顧客，在下次傳訊息時補存，原網址失效就重新向平台取一次。適用所有渠道。聯絡人的頭像只有在和渠道頭像相同時才一起換，客服改過的不覆蓋。下載只走 https、不連內部網路，只收 5 MB 以下的圖片。資料刪除的兩種模式都會刪除這些頭像檔；同租戶其他聯絡人還在用的檔案保留。workers 需要設定與 api 相同的 `S3_PUBLIC_URL`，沒設定時頭像檔不刪，筆數記在刪除申請的 `affected`。

- **WebChat widget 的訊息左右顛倒**（#319）— 嵌入式 widget 用 CRM 的方向決定左右，客服回覆對 CRM 是送出，所以訪客畫面上客服、Bot 的回覆與問候語靠右、藍底，訪客自己的訊息反而靠左、灰底；後台渠道設定的 WebChat 預覽也是這樣。現在訪客自己送出的文字、圖片、影片（含上傳中的佔位訊息）靠右，客服、Bot 與問候語靠左。Chatbox 頁面原本就正確，不受影響。

- **UAT 每次部署後，API 與 workers 的程式 log 都會消失**（#316）— UAT 設定 `LOG_TRANSPORT=file`，log 寫在容器內的 `/app/logs`，但 `docker-compose.yml` 沒有掛 volume，部署時 `--force-recreate` 重建容器就把 log 檔一起清掉，排程類工作（只寫 log 檔）在上次部署之前的執行紀錄都查不到。現在 api 與 workers 各掛一個 named volume（`api_logs`、`workers_logs`），log 檔跨部署保留，保留天數仍由 `LOG_MAX_FILES`（預設 14 天）控制。

- **解除合併後，顧客在其他渠道的身分與對話仍留在對方身上** — 合併之後，被合併的顧客從同一平台、同一組 ID 的另一個渠道（例如同一個 LINE provider 底下的另一個官方帳號）傳訊息時，系統依身分對照表把新的渠道身分直接掛到合併後的聯絡人，沒有記進合併紀錄。之後客服按「解除合併」或顧客回覆「解除綁定」，新身分和那個渠道的對話仍留在對方身上，也沒有按鈕可以拆；顧客在那個渠道回覆「解除綁定」還會被當成一般訊息。現在掛上身分時會記進把這個 ID 帶進來、且目前由這位聯絡人持有的每一筆未解除合併紀錄（連環合併時可能不只一筆），解除時一起搬回。這筆身分的名稱與頭像也改為向該平台讀取，不再沿用合併後聯絡人（可能是另一個人）的名稱與頭像（IDENT-05）。

## [2026-10-16]

### Added

- 廣播發送失敗會記錄原因並顯示在後台（#287）：`broadcasts` 新增 `failureReason` 欄位。排程發送失敗時原本只寫進 log，現在受眾為空、分群已刪、憑證無法解密、全部對象都送失敗（含第一個渠道錯誤）等原因，會顯示在廣播列表與活動詳情的「失敗」徽章下方；非預期錯誤顯示通用說明，不外露內部錯誤。失敗的廣播可以按「重新發送」（重送時會清掉舊原因）或「取消」。

### Changed

- 試用排程 `runTrialLifecycle()` 拆成到期、提醒、軟刪三步，每一步都是「讀取 → 以條件更新認領 → 認領成功才寄信與寫稽核」，讀取與認領共用同一組條件。提醒的認領多比對讀取時的提醒標記：目前只有一個 API 實例，排程不會重疊執行；之後若有多個實例同時讀到同一個租戶，只有一個會寄提醒信。

### Fixed

- **延長已清除的試用租戶，後台仍顯示「已清除」**（TRIAL-04）— `PATCH /platform/trial-tenants/:id/extend` 會啟用租戶並延後到期日，但不清除軟刪標記 `purgedAt`。直接呼叫 API 延長已清除的租戶後，租戶已經可以登入，試用管理頁仍顯示「已清除」，而且只剩「復原」。現在延長和轉正式一樣，會一併清除標記。
- **排程執行中延長試用，延長的結果會被排程蓋掉** — 試用排程先讀出租戶清單，再逐一更新，更新時不再檢查條件。平台人員在這兩步之間延長試用，排程仍會停用剛延長的租戶並寄出到期信，或把軟刪標記標回去，或寄出延長前到期日的提醒信並寫回延長前的提醒標記；租戶在這段空檔被停用，也照樣收到提醒信。排程逐一寄信，排在後面的租戶，這段空檔可能長達數秒。現在每次更新都再檢查一次讀取時的條件，條件不成立就不更新，也不寄信、不寫稽核。提醒改為先寫標記再寄信。
- 後台介面移除 emoji 與裝飾符號：試用申請與開通頁標題的 📬🎉、知識庫回報空狀態的 🎉、CLI 與 API 金鑰「請立刻複製並妥善保存」的 ⚠️、收件匣情緒標籤的 😊😟😐（保留「正面／中性／負面」與顏色）、SLA「已達 ✓／未達 ✗」、「✓ 使用自備金鑰」、工單分類前的 🤖、Rich Menu 尺寸提示的 ⚠、Flex 編輯器的 ⚙、快速回覆頁說明的 💡；知識庫 Tag 篩選的 ✕ 改為圖示。送給顧客的 LINE 按鈕文字（快速回覆預設組、轉接客服按鈕）不變。新增測試掃描後台原始碼，介面字串出現 emoji 時失敗。
- 看不到某個渠道的對話或工單時，404 的錯誤訊息是英文（`Conversation not found`、`Case not found`），前端直接顯示英文。渠道可見範圍的守門改用共用的中文訊息，例如「找不到此對話，可能已被刪除或您沒有存取權限」；指定看不到的渠道時的訊息也改成同一套說法。
- **發起資料刪除的稽核沒有記錄來源 IP**（AUD-02）— `POST /api/v1/tenant/data-erasure` 寫的 `data.erasure.request` 稽核，`ip` 一律是空的，帳號被盜用時查不到刪除是從哪裡發起的。現在和資料匯出一樣記錄發起請求的來源 IP。
- 警告色（橘）的文字對比度不足：淺色模式的 `--warning` 原本是 `#FF6E00`，白底上只有 2.8:1、淺橘底上 2.5:1，「自動開啟」標籤、SLA 預警等橘色文字看不清楚。改為 `#B24D00`（白底 5.3:1、淺橘底 4.8:1，白字在橘底上 5.3:1）；深色模式的淺橘底調暗，橘字在上面從 4.1:1 提高到 4.8:1。新增測試檢查這幾組配色都至少 4.5:1。
- CLI 連線頁與 API 金鑰頁的使用說明，主機位址原本寫死為 UAT（`https://uat.open333crm.create360.ai`），在其他環境照著做會連到 UAT。現在取自這個部署的 API 網址（`NEXT_PUBLIC_API_URL` 去掉結尾的 `/api/v1`，保留子路徑）；設成相對路徑時接在目前頁面的網址後面。
- **直接呼叫 API 把對話改成已關閉，不會留下結案紀錄**（CONV-02）— `PATCH /conversations/:id` 帶 `status: CLOSED` 只改狀態，不記結案來源、時間與結案人，也不發布 `conversation.closed`。現在和結案按鈕走同一個流程；已關閉的對話不會重記。
- **看不到某個渠道的成員，可以替該渠道的對話建立工單** — `POST /cases/from-conversation/:conversationId` 不檢查對話所屬渠道的可見範圍，只要知道對話 ID 就能建立工單並連結對話。現在和 `POST /conversations/:id/case` 一樣要求該渠道的 `full` 存取，看不到的渠道回 404。
- **沒有渠道權限的成員可以查渠道狀態** — `GET /channels/:id/status` 只驗登入，沒有 `channel.view` 也能查渠道是否啟用與 FB 權杖狀態。現在要求 `channel.view`，看不到的渠道回 404。
- 渠道沒有對應 plugin 時，廣播的錯誤訊息改為中文。
- 收件匣送出超過 5000 字的訊息時，輸入框下方直接說「訊息長度不可超過 5000 字」，不送出、訊息留在框裡；後端回驗證錯誤時也改顯示訊息欄位的具體原因，不再只有「輸入內容有誤」（#293）。
- 工單列表的優先級、狀態、負責人、SLA 倒數與建立時間欄位不換行，「開啟」「未指派」不再被擠成兩行（#293）。
- 收件匣狀態下拉選「已關閉」改為開啟結案視窗，和「結案」按鈕走同一個流程，會記錄結案原因、時間與結案人；結案失敗時在視窗內顯示原因，不再跳瀏覽器 alert。
- 我的績效：平均首次回應的目標顯示為「目標：15 分內」；沒有資料的項目只顯示「-」，不再出現「-%」「- / 5」。
- 角色與權限：刪除角色被擋下時的原因、權限旁的「自動開啟」標籤，原本是淺色底上的白字幾乎看不到，改為可讀的配色。

## [2026-10-15]

### Added

- **收件匣可以把對話交回 Bot** — 客服接手後，對話停在客服處理，後台沒有辦法讓機器人繼續回，只能結案等客人再傳訊息開新對話；狀態選單也沒有 Bot 處理中，從 API 改狀態又不會把機器人回覆次數歸零，因次數到上限轉真人的對話會馬上再轉回真人。對話上方新增「交回 Bot」按鈕（`POST /conversations/:id/return-to-bot`）：客服處理中或進行中的對話改回 Bot 處理，回覆次數歸零、清除轉真人原因、保留指派的客服，並寫一則只給客服看的系統訊息。已結案、已經是 Bot 處理或渠道的機器人已關閉時不改狀態並說明原因。權限與接手對話相同（`inbox.manage`）。

### Fixed

- **WebTalk 協作工具列跨租戶互通** — 後台的 WebTalk 以寫死的 `siteId: 'open333crm-uat'`、`scope: 'origin'` 掛載，SDK 依網域算出房間，同一網域上所有租戶的客服進同一個房間，互相看得到在線名單、訊息與網頁摘要。房間代號改由 API 發放（`GET /api/v1/webtalk/session`）：以 `WEBTALK_ROOM_SECRET` 對環境、租戶與房間版本做 HMAC，只發給已登入的成員，不同租戶與不同環境不會同房；密鑰或 SDK 網址沒有設定時不載入 WebTalk（fail-closed）。SDK 網址、環境識別與 AI 端點改由 API 環境變數提供，前端不再寫死。設定頁新增「WebTalk 協作」（`settings.manage`）：租戶可關閉 WebTalk（預設開）與 AI 摘要（預設關，因為會把整頁文字含顧客個資送到外部），也可在成員離職時重新產生房間代號。AI 摘要關閉時，SDK 的 AI 請求改打 CRM API 的 `/webtalk/ai-disabled`，在讀取內容前就拒絕。掛載前帶入客服本名；登出、換帳號時卸載並清除 SDK 留在瀏覽器的聊天紀錄，修正同一分頁重新登入後無法再次掛載。新增 migration `20261015100000_add_webtalk_tenant_settings`。頁面上已有 SDK script 時，只在網址與 SRI 雜湊都和這次設定相同時才重用，否則移除後依設定重新載入，避免繞過 SRI；SDK 不論是新載入或頁面上已存在，登出都改整頁導向以關閉信令連線；元件在 SDK 載入或掛載途中卸載時，完成後會再卸載一次，不留下背景連線。
- **追蹤設定的 GA／Pixel ID 可以注入程式碼**（G06，儲存型 XSS）— 追蹤設定沒有驗證 ID 格式，值直接拼進所有短連結公開中轉頁的 `<script>`，填入 `G-1');alert(1);//` 就會在每位點連結的訪客瀏覽器執行。現在 GA4 ID 只收 `G-` 加英數字、Meta Pixel ID 只收 5～20 位數字，不符回 400 並說明格式；產生中轉頁時再驗一次並跳脫，資料庫裡已存在的不合格值不再輸出（管理員需重新填寫）。
- **追蹤設定接受小寫的 GA4 ID，存了也不會追蹤** — G06 的格式驗證不分大小寫，`g-ABC123XYZ9` 會顯示「已儲存」。gtag.js 只把大寫 `G-` 當成 GA4 ID，小寫的 ID 載入的是空設定，點擊不會送到 GA4，畫面也沒有提示。現在 GA4 ID 只收 `G-` 加大寫英文字母或數字，含小寫字母時回 400。資料庫裡含小寫字母的值，中轉頁不再輸出 GA 的 script。
- **營業時間讀取失敗時按儲存會蓋掉正式設定**（G07）— 讀取失敗只寫進瀏覽器 console，畫面照樣顯示預設的營業時間，這時按「儲存設定」就把原本的設定換成預設值。現在讀取失敗時顯示原因與「重新載入」，讀取成功前不顯示表單、無法儲存。
- **「Webhook 公開網址」一按套用就改寫所有渠道**（G08）— 按「套用」直接改寫全租戶所有渠道的 Webhook 網址，沒有確認；說明還寫「填入 ngrok 或其他隧道工具產生的公開網址」，UAT 的 IG 渠道就留著已失效的 ngrok 網址。後端也接受任何字串。現在套用前會確認並說明會改寫幾個渠道、填錯的後果；說明改為填本系統的正式網域；後端只收 `https` 網址，帶 `?`、`#` 或帳號密碼回 400。
- **打開渠道管理頁就會更新 FB 渠道的「最後驗證」**（G03）— 每次開頁，每張 FB 卡片（含已停用）都會查 Meta 的權杖狀態並寫回資料庫，權杖已失效也照樣更新「最後驗證」，看起來剛驗證過其實不能用。現在權杖狀態查詢只讀不寫、只查啟用中的 FB 渠道，「最後驗證」只由「測試連線」更新。
- **Bot 最大回覆次數可以存成 9999**（G04）— 設定畫面限制 1～50，後端不驗證，直接呼叫 API 可以存任意值（UAT 實際存了 9999，等於永遠不轉真人）。現在建立或更新渠道時，`settings.botConfig.maxBotReplies` 有值就必須是 1～50 的整數，否則回 400。既有超出範圍的渠道，下次儲存 Bot 設定時要改成範圍內的值。
- **渠道欄位說明圖片露出 App ID 與粉專 ID**（G05）— 新增 FB 渠道時的說明圖 `fb-app-basic.png` 完整顯示 Meta App 的應用程式編號，`fb-page-token.png` 隱約看得到粉專 ID。兩處改為馬賽克遮蔽。
- **一般客服看不到「我的績效」、卻看得到 AI 設定**（G09、A06）— 側邊選單的「報表」整組要 `analytics.view`，只有個人報表權限（`analytics.view.self`，客服預設角色）的人連「我的績效」都看不到，後端其實允許。「AI 設定」（Embedding、Chat & Prompt）沒有設權限，客服點進去 API 回 403，畫面顯示寫死的預設值與「異常」。現在「總覽」要 `analytics.view`、「我的績效」要 `analytics.view.self`，「AI 設定」要 `settings.manage`。
- **報表自訂迄日少算當天 08:00 以後的資料、清空日期框整頁崩潰**（G10）— 日期框的值被當成 UTC 午夜解析，台灣時間的迄日只算到早上 8 點；日期框也以 UTC 顯示，早上 8 點前看到的是前一天。清空日期框會產生無效日期，畫面丟出錯誤整頁空白。現在以本地時間解析與顯示，迄日算到當天 23:59:59，清空日期框時維持原本的區間。報表依 UTC 切分每日資料的問題（AUDIT ANA-01）不在這次修正範圍。
- **我的績效「平均首次回應」超過 1 小時也顯示達標**（G11）— 判斷達標時拿格式化後的「1 時 30 分」去 `parseFloat`，得到 1，跟目標 15 分鐘比永遠達標。現在用原始分鐘數比較；達標與未達標圖示也加上文字標籤。
- **匯出 CSV 用 Excel 開啟中文亂碼、失敗沒有提示**（G12）— 匯出的檔案沒有 UTF-8 BOM，Excel 以系統編碼開啟，中文標題與姓名變亂碼；沒有匯出權限（`analytics.export`）的人也看得到按鈕，按了 403，畫面沒有任何反應。現在 CSV 以 BOM 開頭，按鈕只對有匯出權限的人顯示，失敗時顯示原因。
- **追蹤、API 金鑰、CLI 連線三頁讀取失敗時顯示成「尚未建立」**（G13）— 讀取失敗只寫進瀏覽器 console，金鑰與 CLI 頁顯示「尚未建立任何金鑰」，使用者可能重複建立；追蹤設定頁顯示空白欄位，按儲存會清掉已設定的 ID。現在三頁讀取失敗時顯示原因與「重新載入」，追蹤設定讀取成功前無法儲存。
- **CLI 連線「永不過期」實際是 30 天、登入說明寫錯**（G14）— 選「永不過期」時前端不送到期天數，後端套用預設的 30 天，使用者以為永久有效，30 天後 LLM 或 CLI 突然失效。產生後的「使用方式」寫「`open333 login` 然後貼上 token」，實際上 CLI 是以 Email 與密碼登入、自行產生另一個 token。現在拿掉「永不過期」選項（預設 30 天），說明改為 CLI 不使用這個 token、請以 Email 與密碼登入。
- **收過對話的渠道刪不掉，也沒有停用按鈕**（G15，AUDIT CHAN-01）— 渠道刪除是硬刪除，對話指向渠道的外鍵會擋下，畫面只顯示泛用的伺服器錯誤；渠道卡片也沒有停用的按鈕（API 其實支援）。現在刪除被資料擋下時回 409 `CHANNEL_IN_USE`，說明請改用停用；每張渠道卡片新增「停用」與「啟用」按鈕，停用保留歷史對話、可隨時重新啟用。
- **「指派團隊」說明與實際可見範圍相反**（G16）— 說明寫「未指派任何團隊或成員時，此渠道維持全租戶公開」，實際上渠道可見範圍是 fail-closed，沒有指派時只有「總店」（可檢視所有渠道）看得到。說明已更正。
- **停用的人員從列表消失、無法重新啟用**（G17，AUDIT AUTH-09）— 停用確認框寫「帳號可日後再啟用」，但成員列表只列啟用中的人，也沒有重新啟用的 API，停用後只能改資料庫，email 也一直被佔用。新增 `GET /api/v1/agents/inactive` 與 `POST /api/v1/agents/:id/reactivate`（都要 `agent.deactivate`），人員管理頁列出「已停用的人員」，可重新啟用（角色維持停用前）或進編輯永久刪除。重新啟用套用方案的客服人數上限，避免「停用 → 新增 → 重新啟用」繞過上限。
- **停用的人員佔著自訂角色，角色刪不掉也看不出是誰**（G18）— 刪除角色時停用的成員也算使用中，但停用的成員不在人員列表上；角色頁讀錯錯誤訊息的位置，不論原因一律顯示「刪除失敗」（新增、改名角色也一樣）。現在刪除被擋時回應列出佔用的成員（`error.details.blockingAgents`），訊息寫出姓名並標示「已停用」，角色頁顯示後端的訊息。
- **編輯人員每次儲存都重送角色**（G19）— 有指派角色權限時，「編輯人員」每次按儲存都會重送角色，即使沒改。重送也要通過越權檢查，主管編輯自己或管理員一定被拒，而且會中斷後面的步驟，同一次改的密碼與可用渠道都沒存。現在只有改了角色才送出角色變更。
- **SLA「設為此優先級預設」沒有作用；政策改名或刪除後舊工單停止計時**（G20，AUDIT SLA-03、SLA-04）— 建工單（手動與自動化）沒有指定政策時，只依優先級取任意一條，不看預設；工單以政策名稱記錄政策，改名或刪除後 SLA 掃描找不到政策，工單默默不再計時。現在預設政策優先、沒有預設時取最早建立的；同租戶政策名稱不可重複（409 `DUPLICATE`）；改名時同步更新工單上記的名稱；仍有未結案工單使用的政策不能刪除（409 `SLA_POLICY_IN_USE`，畫面顯示原因）。同一租戶的政策建立、改名、刪除在交易級 advisory lock 下依序執行，同時送出的請求不會留下同名政策，刪除前的工單計數也不會被並行的改名打亂。
### Changed

- **Rich Menu 不再預設成為所有好友的預設選單**（M07）— 新建時「預設展開選單」預設勾選，但這個選項實際上會在發布時把選單設成官方帳號所有好友的預設選單，任何一張新選單一發布就換掉正式環境全部好友的選單；取消發布一張預設選單，所有好友的選單會消失，畫面都沒有提醒。現在新建時預設不勾，選項改名為「設為所有好友的預設選單」並附說明，勾選時要確認；發布與取消發布預設選單時，確認文字說明會換掉或清掉所有好友的選單。

### Fixed

- **Rich Menu 有 5 種版型存不了**（M10）— 「上 1 + 下 3」「3 × 2（六等分）」「3 等寬」「左 1 + 右 2」「左 2 + 右 1」的區域座標用除法算出小數（例如 2500 / 3），後端只收整數，按「儲存草稿」一定回 400。改成以整數分隔線切格，相鄰格共用同一條分隔線，各格寬高加總仍等於畫布寬高。
- **關鍵字回覆頁的說明與實際行為不符**（M11）— 說明寫「只在 Bot 處理中的對話觸發、客服接管後不回、每人每小時最多 3 次」，程式並沒有這些限制（比對時不看對話狀態，也沒有次數限制）。說明改成實際行為：每則訊息都會觸發、客服接手的對話也會回、比對是不分大小寫的「包含」、規則對所有 LINE 官方帳號生效、能送出時 AI 不另外回覆。行為本身沒有改。
- **積分手動調整可能加扣到別的客戶**（M08）— 積分搜尋只取第一筆符合的聯絡人，同名或部分相符時會選到別人，畫面只顯示名稱，接著「手動調整」就改到錯的客戶；搜尋與調整失敗只寫在瀏覽器 console。現在只有剛好一位符合時才自動選，多位時列出名稱、電話、Email 讓使用者挑；選定的聯絡人與調整對話框都顯示電話與 Email；找不到、搜尋失敗、調整失敗都在畫面顯示原因。
- **編輯短連結時清空的欄位不會生效**（M02）— 清空標題、UTM、社群預覽或把「點擊時自動貼標」改回不貼標，前端送出 `undefined`，後端當成「這欄不動」，只有到期時間與 LINE 渠道能清掉。現在編輯時清空的欄位送空字串，後端存成空值；更新的驗證也接受清空的社群預覽圖片。
- **粉絲活動、提交紀錄、積分交易、短連結列表只顯示前 20 筆**（M13）— 這些列表沒有分頁，也只拿到後端預設的前 20 筆，更早的資料在後台看不到也改不了（短連結統計的下拉也一樣）。現在逐頁取回全部資料；`fetchAllPages` 在回應沒有 `totalPages` 時改用 `total / limit` 算頁數。 網址本身若已帶 `page`、`limit`，`fetchAllPages` 會先移除再帶入自己的分頁參數，不會送出重複參數（review #283）。
- **廣播自動建立的短連結沒有標示、改或刪沒有警告**（M14）— 廣播發送時把素材網址換成的短連結沒有標題，列表顯示「-」，與手動連結混在一起；刪除或修改目標網址、到期時間會讓已發給客人的訊息連結失效或導向別處。現在列表標示「素材連結（廣播自動建立）」，刪除時確認文字說明已發出的訊息會失效，編輯對話框也顯示同樣的提醒。
- **關鍵字回覆送出的素材會代入客人資料**（M01）— 素材裡的 `{{contact.name}}` 等變數原樣送給客人，畫面卻寫「會以預設值送出」：workers 送素材時只用規則參數替換，關鍵字回覆從不帶參數。現在比照廣播，用對話聯絡人的姓名、電話、Email 與自訂屬性代入；客人沒有該資料時用素材的預設值，仍沒有值的留空，不再送出大括號。
- **廣播不再因受眾名單為空而發給整個渠道**（M03、M04、M05、M06、M09）— 選「依標籤篩選」或「手動選擇」時畫面沒有挑選欄位，後端拿到空名單就不篩選；選「受眾分群」沒選分群、分群在排程期間被刪掉、或分群條件值留空（0 條件被當成全部聯絡人），都會發給該渠道所有聯絡人。現在建立與發送廣播時，名單為空、分群不存在或沒有有效條件一律拒絕並說明原因（`INVALID_AUDIENCE`），排程中的舊草稿也會被擋下並標為失敗；分群建立時每條條件都要有值（`INVALID_SEGMENT_RULES`），沒有有效條件的規則算 0 人。「依標籤篩選」補上標籤多選，「手動選擇」在挑人介面完成前先隱藏。「立即發送」請求期間按鈕停用，後端只允許從草稿、已排程、失敗以條件更新搶占為發送中，正在發送的廣播再發回 409（`BROADCAST_ALREADY_SENDING`），避免重複群發。素材下拉改用 `LINE`／`FB` 正確過濾，後端也拒絕素材渠道與廣播渠道不符（`MATERIAL_CHANNEL_MISMATCH`）。
### Fixed

- **AI 設定頁讀取失敗時顯示假資料、儲存失敗看不出原因**（A01、A06、A07）— 沒有「系統設定」權限的人打開 Embedding 或 Chat & Prompt 頁，讀取被拒後畫面顯示前端寫死的預設值（localhost、bge-m3、狀態異常），容易誤以為服務壞了或設定是 localhost。現在讀取被拒時整頁改顯示「沒有權限」，其他讀取錯誤顯示原因與「重新載入」。Chat & Prompt 儲存失敗原本一律只顯示「儲存失敗」，現在顯示後端原因（提示詞超過 8000 字、網址格式錯誤、權限不足）。多輪追問「觸發門檻」滑桿兩端的說明寫反了（實際是知識庫相似度低於門檻才追問，門檻越高越常追問），改為「0.00（只在查無文章時追問）」與「1.00（幾乎每次都追問）」。
- **自動化「更新工單狀態」「設定工單優先級」顯示的值與實際不一致**（A05）— 這兩個動作的下拉是必填、沒有空白選項，新加的動作畫面顯示第一個選項（「開啟」「低」），實際值卻是空的，儲存時被拒「必須填寫」。必填下拉未選時改顯示「請選擇目標狀態」「請選擇優先級」。
- **客服按「標為已處理」一定失敗**（A08）— 回報調教的「標為已處理」需要「知識庫進階」權限，預設客服角色沒有，按鈕卻照常顯示，每次都收到 403。沒有這個權限時不顯示按鈕，改在頁首說明需要的權限，客服仍可修正文章。
- **關鍵字規則的條件不成立時，AI 仍讓步、顧客收不到回覆**（A09）— AI 是否讓給關鍵字規則回覆，只看關鍵字與動作，不看規則的條件，也不看規則能不能通過驗證；條件不成立（例如規則限定 Facebook、訊息來自 LINE）或規則含系統沒有的動作時，workers 不會執行規則，AI 又不回。現在只有條件成立、通過驗證的規則才會讓 AI 讓步，條件用和 workers 相同的資料評估（`buildAutomationFacts` 移到 `@open333crm/automation` 共用）。沒有條件的規則不讀條件資料；有條件的規則讀不到資料（沒有對話與聯絡人、或讀取失敗）時不讓步，AI 照常回覆。
- **自動化「傳送通知」在沒有工單負責人時永遠不會送**（A03）— 原本只送給工單負責人，聯絡人建立、加標籤、短連結點擊、新對話等沒有工單的觸發選了這個動作，通知只寫 log。動作新增選填的「通知誰」；不指定時依序通知工單負責人、對話負責客服，都沒有時通知所有主管與管理員。指定的客服、工單負責人或對話負責客服已停用或不屬於這個租戶時，跳過他改用下一順位。
- **自動化「傳送素材」要手動貼素材 ID**（A04）— 欄位是純文字框，提示卻寫「從素材庫選擇」，一般管理員拿不到素材 ID。改成下拉選單列出所有啟用中的素材，顯示名稱與渠道；已存的素材停用或找不到時保留原值並標示；沒有素材庫檢視權限時退回文字輸入並說明原因。
- **不會執行的舊規則仍顯示啟用、也能被重新打開**（A02）— 2026-03 舊版 seed 建立的「一般問題自動開案」含系統沒有的動作 `auto_assign`，「負面情緒通知」的觸發事件 `sentiment.negative` 系統沒有，workers 整條略過，列表卻顯示啟用，開關也能打開。現在把規則改為啟用時 API 會做契約驗證，不通過回 400 並說明原因（停用不受影響）；編輯器遇到系統沒有的觸發事件顯示「未知觸發事件（代碼）」並提示改選，不再顯示成「收到訊息」。既有資料用 `scripts/disable-invalid-automation-rules.mjs` 停用（預設 dry-run，`--apply` 才寫入，內容保留原樣）。
- **登出後改登入別的租戶，畫面會先出現上一個租戶的名單** — 登出是前端導向、不整頁重載，SWR 快取（客服名單、素材清單等，key 不帶租戶）留到下一次登入，新租戶開頁時會先顯示舊資料再更新。現在登出時清掉整個 SWR 快取。
- **工單狀態徽章顯示英文代碼**（S03）— 列表與詳情頁的狀態徽章顯示 `OPEN`、`IN_PROGRESS`：對照表的鍵是小寫，API 回大寫，查不到就顯示原值。查詢前先轉小寫，徽章顯示開啟、處理中等中文。
- **工單 SLA 倒數與日期難讀**（S04）— 逾期很久的工單顯示「-2202h 32m 11s」，建立時間顯示「Jul 14」。SLA 倒數改成中文並依長度換單位（「剩 12 分 30 秒」「逾期 91 天 18 小時」）；工單列表、詳情與時間軸的日期改成 `2026/07/14 09:05`。
- **SLA 通知與時間軸每天重複、顯示英文**（S01、S02、S12）— SLA 掃描用「24 小時內有沒有同類事件」去重，逾期的工單每天重寫一次時間軸事件、重發一次通知給負責人與所有主管（示範租戶一位管理員累積上千則）；通知標題是「Resolution SLA breached」等英文，時間軸顯示 `sla_breached` 代碼，通知頁把首次回應逾期等類型都標成「通知」。現在同一個期限的警告或逾期只記錄、通知一次（期限改變或客服回覆後客戶又連續傳訊才再記一次，change `fix-sla-outcome-repeat`）；五種 SLA 通知與自動化「通知」動作改成中文；時間軸補上 SLA、自動指派、關聯對話的中文文案，作者「System」改「系統」；通知頁補首次回應警告／逾期、客戶等待逾時、自動化通知的類型徽章。已經產生的重複事件與通知不會清除。
- **SLA 掃描重疊時仍可能重複記錄**（review #281）— 去重是先查再寫，兩次掃描同時處理同一張工單（例如 BullMQ 判定工作 stalled 後重跑）時都查不到事件，各寫一筆並各通知一次。查重、調整優先順序與寫入事件改在同一個交易內，並以 `pg_advisory_xact_lock` 鎖住「工單 + 事件類型」；只有真正寫入事件的那次才推播、通知與執行自動化規則。
- **工單「標記解決」按了一定失敗、狀態下拉改狀態不觸發後續流程**（S05、S06）— 詳情頁頂部按鈕沒照狀態機顯示：開啟、待處理、已升級的工單也有「標記解決」，按下後端回 422，錯誤是英文。用狀態下拉改成已解決、已關閉、已升級時，`PATCH /cases/:id` 只改欄位，不寫時間軸、不發布 `case.resolved`／`case.closed`／`case.escalated`，所以不會送 CSAT、不會觸發自動化、不會通知主管。現在按鈕依狀態機顯示（開啟的工單要先改成處理中才能標記解決或升級）；`PATCH` 改狀態改走與頂部按鈕相同的 `transitionCase`／`escalateCase`；狀態下拉選「已升級」改開升級對話框；狀態轉換錯誤改成中文並列出可以改成的狀態；「重新開啟」失敗時顯示原因。
- **AI 建議回覆按「採用」沒有作用**（S07）— 收件匣送出 `ai-adopt` 事件，但沒有元件接收，面板關閉後輸入框是空的。回覆輸入框改為接收這個事件，採用後建議文字帶進輸入框，客服可以修改後再送出。
- **客服手動回覆送到渠道失敗時後台看不到**（S08）— 渠道拒收、渠道停用、找不到聯絡人在該渠道的帳號時，API 只寫 log，聊天視窗照常顯示成已送出（「沒有送出」紅框只涵蓋自動化與 Bot 送的訊息）。現在客服送出的訊息遇到這些情況，會在訊息寫入 `deliveryFailed` 與原因，聊天視窗與對話列表顯示「沒有送出」標示，`POST /conversations/:id/messages` 回傳的訊息也帶著這個標示。
- **收件匣送出訊息、改指派、改狀態失敗時畫面沒有提示**（S09）— 失敗只寫在瀏覽器 console：沒有回覆權限、超過 5000 字或網路錯誤時，送出按鈕轉一下就恢復；沒有管理對話權限時改指派或狀態，下拉看起來沒反應。現在送出失敗會在輸入框下方顯示「沒有送出」與原因（訊息留在輸入框），圖片傳送失敗也改在同一處顯示；改指派、改狀態、重新開啟失敗時聊天視窗上方顯示原因，下拉回到實際的值。
- **列表頁新增工單時渠道取錯**（S10）— 建立工單對話框取 `/channels` 的第一個渠道當工單渠道，不是聯絡人所在的渠道，工單被歸到任意渠道（影響分店看不看得到、報表歸因、CSAT 從哪個渠道送出），後端也沒檢查渠道可見範圍。現在選聯絡人後依聯絡人所在的渠道決定（只有一個時自動帶入，多個時要選），聯絡人在看得到的渠道都沒有帳號時不能建立並說明原因；`POST /cases` 檢查渠道在操作者的可見範圍內（看不到回 404），且聯絡人在該渠道有帳號（否則 400 `CONTACT_NOT_ON_CHANNEL`）。建立失敗時改為顯示後端的原因。
- **建工單對話框的「+ 建立新聯絡人」走不通**（S11）— 連到 `/dashboard/contacts?action=create`，但聯絡人頁不處理這個參數，系統也沒有手動建立聯絡人的功能。移除這個連結，改說明聯絡人在顧客透過渠道傳訊息後自動建立，或從收件匣的對話直接建立工單。

## [2026-10-14]

### Added

- **集中 API 參考頁** — 新增 `/api-reference` Redoc 頁面與 OpenAPI 路由目錄產生器，依 API 實際掛載前綴列出 HTTP endpoints，並標示尚未文件化的 request/response schema。Socket.IO 與 MCP 維持各自協定文件範圍。
- **Swagger API 執行頁** — 新增獨立 `/swagger-ui.html`，支援 Try it out、同源 API 呼叫與 Bearer token 授權；Redoc 保留作為閱讀 API 文件的入口。

- **手機號碼 One ID** — 與 email 登記並存、各自啟用（設定頁「手機登記」，預設關閉）。顧客在對話傳送「登記手機」或由客服在收件匣代發，取得一次性登記連結，填入手機號碼後，同租戶使用同一支手機的聯絡人自動合併到最早的一位。只接受台灣手機，`0912-345-678`、`+886 912 345 678` 等寫法統一存成 `0912345678`，比對既有聯絡人時也統一格式，客服或匯入存的電話同樣比對得到。比照 email 版不做 OTP 驗證，沿用同渠道衝突拒絕、雙邊通知、7 天自助解除、公開端點限頻與同號碼依序處理；手機號碼較容易被他人得知，登記方收到的整合通知不顯示對方名稱。email 與手機登記可以同時開啟；要合併的兩位聯絡人另一種識別不一致時（手機登記時雙方 email 不同、email 登記時雙方手機不同），不自動合併，回覆顧客需要客服確認，避免共用號碼的家人或兩組已歸戶的資料被連鎖併成一位。email 與手機登記改用同一套流程（`identifier-registration.ts`），email 的行為不變。

### Changed

- **案件升級對話框拿掉「團隊群組通知」** — 勾了不會通知任何人（系統沒有實作通知團隊，也沒有建立團隊的介面），客服卻以為已經通知到了。現在通知對象只有「主管」與「原負責客服」。API 仍接受 `team`，部署前載入的舊頁面送出不會回 400。

### Fixed

- **IG 渠道表單指向錯的密鑰** — 新增與編輯 IG 渠道時，App Secret 的提示寫「Settings → Basic → App Secret」，照著填會拿到 Facebook 應用程式的密鑰；IG 登入路線驗證訊息要用「含有 Instagram 登入的 API 設定」頁的 Instagram 應用程式密鑰，填錯每則訊息都驗不過、收不到任何私訊。三個欄位改用 Meta 後台的名稱（Instagram 應用程式編號、Instagram 應用程式密鑰、Instagram 存取權杖），提示改為指向該頁的位置與取得步驟。
- **IG 私訊命中關鍵字後 AI 不回、規則也沒送**（UAT 創造智能接 IG 時發現）— 訊息命中關鍵字規則時，AI 一律讓給規則回覆，但沒看規則在這個渠道送不送得出去：規則只送 LINE 素材時，IG、FB 對話的素材會因渠道不符被略過，顧客什麼都收不到，失敗只寫在 log。只加標籤的關鍵字規則同樣會讓 AI 不回。現在只有命中的規則能在這個渠道回覆（傳送文字，或同渠道的素材，且 workers 送得到該渠道）時 AI 才讓步，網站聊天室因 workers 還送不到而不讓步；素材渠道不符時在對話留下「沒有送出」的紀錄並說明原因。另外 workers 補註冊 IG 外掛，關鍵字與自動化規則可以回覆 IG 對話（原本會記成找不到外掛）。

## [2026-10-13]

### Added

- **LINE 影片可以上傳到 200 MB** — 原本 LINE 與 FB 影片都只能上傳 25 MB（API 的 multipart 上限），超過的只能自己找地方放再貼網址。LINE 影片訊息的上限是 200 MB，現在 LINE 影片改為從瀏覽器直接上傳到 MinIO/S3，不經過 API，上傳時顯示進度；FB 影片維持 25 MB（Messenger 附件上限）。原有的直傳流程（`/files/presign-upload` → `/files/complete-upload`）沒有前端在用，而且在 UAT 用不了：上傳網址用內部位址 `minio:9000` 簽名，瀏覽器連不到；檢查時把整個檔案讀進 API；簽名不限檔案大小。現在上傳網址用 `S3_PUBLIC_URL` 簽名、檔案大小簽進網址（大小不符 storage 拒收）、依用途限制上限（一般 25 MB、LINE 影片 200 MB 只收 mp4），檢查只讀檔案頭尾，再在 storage 端複製成正式檔。⚠️ 部署前要放寬主機 nginx `/open333crm/` 的 `client_max_body_size`（見 `docs/ref/system/DEPLOYMENT.md`）。

### Fixed

- **API 直接存素材時，LINE 純文字可以存數字、FB 折扣碼可以含空白**（UAT 素材欄位探測）— LINE 純文字的 `text` 送數字 `12345` 會以數字存進去（LINE 的檢核也接受數字），FB 優惠券的折扣碼送 `AB C` 也能存，編輯器卻標示「不可含空格」。現在兩者都回 400 並指出欄位：純文字的內容必須是文字（沒有 LINE 渠道時也檢查），折扣碼有填時不可含空白。編輯器送出的值不受影響。
- **LINE 素材存檔錯誤是英文原文與 JSON 路徑**（UAT E2E 發現）— 純文字、圖片、影片、卡片、圖文被 LINE 擋下時，畫面顯示「messages[0].previewImageUrl: Must be a valid HTTPS URL」這類訊息，表單上沒有這些路徑。現在改用編輯器的欄位名稱與中文說明，例如「縮圖網址必須是 https:// 開頭的公開網址」「第 1 頁第 1 個按鈕的連結不可空白」；對應不到的保留原文。直接編輯 JSON 的 Flex 版型維持原文。
- **LINE 卡片訊息超過 12 頁時默默少送**— 用 API 存 13 頁可以存檔，發送時只送前 12 頁。現在頁數加結尾頁超過 12 時回 400。編輯器最多 10 頁加結尾頁，不受影響。
- **LINE 圖片只換主圖存不了**（UAT E2E 發現）— 預設內容把縮圖設成示範圖，只換主圖時縮圖仍是示範圖的站內路徑，LINE 擋下存檔；就算存得了，客人看到的縮圖也是另一張圖。縮圖清空時則送出空字串，LINE 回「不可空白」。現在預設不設縮圖，縮圖空白時使用主圖。影片的預設內容也拿掉已從編輯器移除的結束畫面示範值。
- **FB 素材編輯器漏掉會送出的欄位**（UAT E2E 發現）— 商品輪播的卡片按鈕看不到也改不了，按鈕選單的新按鈕只能是網址按鈕，大圖廣告的媒體類型是自由輸入框，FB 影片沒有上傳鈕。現在按鈕可以選網址或回傳、商品輪播每張卡片可編輯最多 3 顆按鈕、媒體類型改下拉選單、影片可以直接上傳。預覽保留文字換行，FB 影片預覽不再破圖。
- **FB 網址缺網域時的錯誤訊息看不出錯在哪** — `http:///a.jpg` 這類網址被擋時，訊息說「必須是 http:// 或 https:// 開頭」，但它確實是 http:// 開頭。現在說明「http(s):// 後面要接網域，且不可有空白」。
- **素材名稱超過 200 字時只顯示「輸入內容有誤」** — 名稱、分類、描述的輸入框加上與後端相同的字數上限（200／100／500）。
- **連續合併時，排在後面的舊部署會把 UAT 蓋回舊版** — `deploy.yml` 沒有 concurrency 設定，每次部署 checkout 觸發它的 commit。多個 PR 接連合併時，較舊的部署可能排在較新的之後執行（2026-10-13 #264 的部署排在 #265、#266 之後，手動取消才沒有退版）。現在同一時間只跑一個部署，排隊中只保留最新一個，進行中的部署不中斷。
- **FB 素材的內容完全沒有檢查**（UAT E2E 發現）— FB 9 種版型存檔時後端不檢查內容：標了必填的欄位（優惠券標題、收據收件人與訂單編號、按鈕選單的主要訊息）可以空著存，6 個網址欄位可以存 `javascript:`，收據金額可以是負數、幣別可以亂填，滿意度調查有效天數可以是 -1 或 9999，按鈕與卡片數量沒有上限。現在建立、修改內容與還原版本時都會檢查，不符合時回 400 並指出欄位；示範圖的站內路徑仍可先存草稿。
- **廣播排程到過去會立即發送**（UAT E2E CM-W6-02）— 建立廣播時排程時間可以填過去（例如誤填成 2020 年），排程器每 60 秒取「時間已到」的廣播執行，等於一分鐘內就發送給客人。現在排程時間必須晚於現在，否則回 400；MCP 建立廣播也套用。
- **行銷活動結束日可以早於開始日**（CM-W6-01）— 建立與修改日期時檢查起訖先後，同一天可以；只改其中一個日期時以另一個既有值比對；只改狀態或名稱不檢查，修正前建立的起訖相反活動仍能取消。無法解析的日期回 400。
- **關鍵字回覆可以指向不存在的素材**（CM-W6-04）— 「傳送素材」動作的素材 ID 原本只檢查非空，非 UUID 或不存在、已停用、其他租戶的素材都能存，規則建起來卻永遠發不出訊息。現在建立或修改動作時檢查素材存在且啟用。
- **LINE 圖文訊息的底圖在 UAT 打不開**（UAT E2E 發現）— 底圖網址 `/line-imagemap/...` 由 API 提供，但 Caddy 只把 `/api/*`、`/mcp`、`/socket.io/*`、`/s/*` 轉給 API，這個路徑落到前端回 404。素材存檔會成功（LINE 只驗格式），發出去客人看到的是破圖。`Caddyfile.local` 與正式環境用的 `nginx/nginx.conf.template` 都補上轉發。另外，編輯器與預覽直接拿不含寬度的 baseUrl 當圖片網址，API 沒有這個路由，所以預覽也是破圖；改用 `/1040` 尺寸顯示。

## [2026-10-12]

### Fixed

- **合併後同一個渠道有兩個帳號，回覆會送錯人**（AUDIT IDENT-03 部分修正）— 客服手動合併與核准合併建議原本不檢查同一個渠道；email 登記與綁定代碼雖然先檢查，但兩個合併同時併入同一位聯絡人時都會通過。合併後一位聯絡人在同一個 LINE 官方帳號有兩個帳號，回覆可能送給另一位客人。現在所有合併都在鎖定雙方之後檢查，兩位聯絡人在同一個渠道都有帳號時拒絕合併，回 409 `SAME_CHANNEL_CONFLICT`，合併視窗顯示是哪個渠道；客人觸發的合併回覆「同一渠道只能綁定一個帳號」。修正前已經合併的資料不在這次處理。
- **兩位聯絡人同時登記同一個新的 email 時不合併**（AUDIT IDENT-04）— 同一個 email 的登記改為依序處理，後送出的一方會與前一方合併。
- **升級時勾「通知團隊」會失敗**（上一項的回歸）— 上一項只允許 `supervisor`、`original_assignee`，漏了升級對話框的第三個勾選「通知團隊」（`team`），勾了它升級就回 400。現在接受 `team`；系統沒有「通知團隊」的實作，勾了也不會通知任何人，與修正前相同。
- **升級工單的「通知原指派人」沒有作用**（UAT E2E BUG-W6-06）— 升級對話框可以勾「通知主管」「通知原指派人」，但通知一律只送給主管與管理員，原指派人從來收不到；`notifyTargets` 也接受任意字串。現在只接受 `supervisor`、`original_assignee`，並依勾選通知；同一人只收到一則，不通知升級的人自己。
- **聯絡人電話沒有格式限制**（BUG-W6-08）— 原本任何字串都能存，包含 `<script>` 與上萬字。現在去頭尾空白後最多 30 字，只能有數字、空白與 `+ - ( ) #`，台灣與國際號碼、分機都能存；純空白視為清除。
- **LIFF ID 不檢查格式** — 渠道設定的 LIFF ID 原本任意字串都能存，短連結的 LIFF 轉址會帶著錯誤的 ID。現在要符合「10 位數字-8 個英數字」。
- **分析報表起訖日顛倒時回傳全 0** — `from` 晚於 `to` 原本回傳全 0 的報表，使用者以為沒有資料。現在回 400 並指出起始日。
- **短連結表單只填空白也能按「建立」** — 目標網址只有空白時按鈕不再可按。
- **收件匣右側的聯絡人面板被切掉**（UAT E2E 發現）— 聊天區不會縮到比內容窄，畫面寬度小於約 1530px（一般筆電的 1280、1440 都是）時，右側面板被擠出畫面並被切掉，1280 寬時超出約 245px。面板內的按鈕看不到也點不到，例如對話標籤的「+」，按了沒有反應。現在聊天區可以縮小，標題列在窄時換行、聯絡人名稱截斷，右側面板完整顯示。
- **合併視窗只顯示「合併失敗」** — 視窗讀錯錯誤欄位，任何原因的失敗都只顯示「合併失敗」。現在顯示 API 回傳的原因。

## [2026-10-08]

### Fixed

- **核准加購 token 之後，用量告警會再次發送**（AUDIT PLAN-06）— 用量達到 80% 與 100% 的告警，每個月每個門檻只發一次。平台核准加購、提高月額度之後，本月已發過的告警紀錄原本保留到月底。用量跨越新上限的 80% 與 100% 時，系統都不會再通知，租戶第二次用完額度時沒有任何預警。現在核准加購時清除本月的告警紀錄。

## [2026-10-07]

### Added

- **以 email 作為跨渠道的 One ID** — 客人在任一渠道傳送「登記email」（關鍵字可自訂），或客服在收件匣按「傳送 email 登記連結」，系統回覆一個 30 分鐘有效、只能用一次的登記網頁。客人填入 email 後，同租戶若有另一位聯絡人使用相同 email，系統自動合併兩位聯絡人（合併紀錄來源為「Email 登記」），並在雙方的對話中通知；7 天內任一方傳送「解除綁定」即可解除。兩人在同一個渠道都有帳號時不合併。系統不寄驗證信。租戶要在「設定 → 跨渠道綁定」開啟，預設關閉。
- **客服修改 email 時可以合併** — 聯絡人頁可以編輯 email。改成另一位聯絡人已使用的 email 時，系統先詢問：與對方合併、仍要儲存（不合併），或取消。
- **客服看得到同一位客人在其他渠道的對話** — 收件匣右側新增「其他渠道的對話」，可以直接展開訊息；聯絡人頁新增「對話紀錄」分頁，把所有渠道的訊息依時間排成一條。只顯示成員看得到的渠道，看不到的只顯示數量。
- **AI 回覆讀得到客人在其他渠道問過的內容** — 歸戶後，KB 自動回覆與 AI agent 會另外讀這位聯絡人在其他渠道最近 30 天、最多 10 則的訊息，並被要求不主動複述其中的電話、地址、email 或訂單編號。合併解除後就讀不到。客服在後台手動執行 AI agent 時，只讀客服看得到的渠道。

### Removed

- **LINE、Facebook 登入補 email**（AUDIT IDENT-02）— 移除 `/api/v1/auth/line/*`、`/api/v1/auth/fb/*`、收件匣的「請求 Email」按鈕與登入結果頁，以及環境變數 `LINE_LOGIN_*`、`FB_LOGIN_*`。這個流程不確認登入者就是該聯絡人，公開端點可由任何人產生授權網址，寫入的 email 會直接觸發合併。UAT 沒有設定這些變數，從未產生過這類合併。改用上面的 email 登記。

### Changed

- **固定 OpenSpec CLI 的版本** — 根目錄的 devDependencies 固定 `@fission-ai/openspec` 1.14.1，請改用 `pnpm exec openspec`，不要用全域安裝或 `npx`。原本每個人的版本不同（1.3.1、1.6.0、1.14.1），同一份主規格在 1.3.1 有 1 份、在 1.14.1 有 14 份驗證失敗。主規格的驗證改用 `node scripts/validate-openspec.mjs --specs`：它執行 `validate --strict`，只略過主規格「需求內文超過 500 字元」的警告；change 裡新寫的需求超過 500 字元時照樣失敗。

### Fixed

- **Agent 回覆達到 AI 月額度時回 403** — `POST /ai/agent/run` 在租戶用完本月的 AI 額度時，原本拋出一般的錯誤，API 回 500。現在與一般的 AI 回覆相同，回 403 `PLAN_LIMIT_EXCEEDED`，details 含 `limitKey: 'monthlyTokens'`。
- **AI 用量告警信的按鈕可以開啟站台** — 用量達到 80% 與 100% 的告警信，按鈕原本連到相對路徑 `/dashboard/plan`，在郵件客戶端開不了站台。現在改用 `WEB_BASE_URL` 組成完整網址。
- **網站聊天室的訪客送出訊息失敗時會看到提示**（AUDIT CHAN-04）— widget 原本在文字訊息送出失敗時只寫 `console.error`，畫面上的訊息與送出成功的相同；媒體上傳成功後，送出媒體訊息的請求失敗時，也仍顯示圖片或影片。現在兩種情況都在那則訊息標示「[傳送失敗]」，與上傳失敗的做法相同。
- **網站聊天室傳過訊息後仍可上傳圖片與影片**（AUDIT CHAN-05）— `/webchat/:channelId/media` 原本與訊息路由共用來源 IP 的計數，同一個 IP 一分鐘內送出 10 則訊息後，上傳一律回 429。現在上傳改用獨立的計數，與 `/chatbox/media` 相同。
- **Workers 缺少渠道加密金鑰時拒絕解密**（AUDIT SEC-01）— Workers 原本在 `CREDENTIAL_ENCRYPTION_KEY` 沒有設定時，改用寫在原始碼裡的固定字串解密渠道憑證。現在金鑰缺少或短於 32 個字元時，解密拋出錯誤，Workers 送不出需要渠道憑證的訊息，與 API 的行為一致。部署 Workers 時要設定與 API 相同的 `CREDENTIAL_ENCRYPTION_KEY`。
- **AI 輔助不再讀取看不到的渠道的對話**（AUDIT RBAC-04 的一部分）— `/ai/suggest-reply`、`/ai/summarize` 與帶 `conversationId` 的 `/ai/agent/run` 原本不檢查對話的渠道，只能看分店渠道的成員可以對其他渠道的對話產生摘要或建議回覆。現在對話的渠道不可見時回 404，不呼叫 AI。查看 AI agent 執行紀錄（`GET /ai/agent/runs/:id`）也一樣：紀錄關聯的對話看不到時回 404。AI 輔助讀對話的查詢另補上 tenantId 條件，不再只靠 RLS。
- **LINE webhook 的簽章錯誤改回 403**（AUDIT CHAN-03）— 原本先回 200 再在背景驗簽，簽章缺少或錯誤的請求與正確的請求得到相同回應，違反主規格 `line-webhook-events`。現在 LINE 路由在回應前驗簽，失敗時回 403；驗簽通過才回 200，事件仍在背景處理。進站 webhook 另會比對路由與渠道本身的類型，不符時丟棄，不再以其他類型的外掛與憑證處理。LINE、Facebook、Instagram 外掛的簽章比對統一改為固定時間比較；簽章長度不同時，LINE 原本會拋出錯誤，現在回傳不相符。

## [2026-10-06]

### Changed

- **本機開發需要 Node.js 24.15 以上** — 根目錄 `package.json` 的 `engines` 由 `>=24` 提高到 `>=24.15`。web 的元件測試使用的 jsdom 30 要求 Node `^24.15.0`。開發容器與正式環境的 image（`node:24-bookworm-slim`）已經是 24.15 以上，不受影響；直接在主機上執行 `pnpm install` 或測試的人要先升級 Node。
- **總覽先呈現待處理對話** — 首頁改以未讀對話佇列作為主要工作入口；聯絡人、渠道、未讀數與訊息摘要仍可直接掃描，工單、聯絡人和自動化數量整理為較輕的營運概況。
- **側欄導覽依工作內容分組** — 將原本 13 個頂層目的地整理成「客服工作」、「自動化與知識」、「行銷與渠道」、「分析與管理」四組，保留子頁、目前位置展開與權限篩選。

### Fixed

- **總覽資料載入失敗會顯示重試** — 統計、未讀對話與工單各自呈現載入和錯誤狀態；請求失敗不再當成零筆或空資料，並可單獨重試該區塊。
- **帳號選單支援鍵盤操作** — 觸發器與登出項目改用按鈕及選單語意，支援方向鍵、Home／End、Escape、焦點提示與鍵盤開啟。
- **BYPASSRLS 連線的白名單檢查恢復通過**（AUDIT RLS-07）— 短連結轉址自 `207da85` 起改用 `prismaAdmin`，但沒有加進 `check-prisma-admin-usage.mjs` 的白名單，`--strict` 一直失敗；CI 沒有執行這支檢查，所以沒人發現。短連結轉址加進白名單並註明理由；粉絲門戶改用 `withTenant` 綁定 fanToken 的租戶，不再使用 `prismaAdmin`（原本 `/me/points` 的積分餘額查詢漏帶 tenantId）。檢查腳本原本漏掉 `req.server.prismaAdmin` 等寫法，修正後找出的 WebChat 舊端點與已在白名單的 Chatbox 呼叫同一組 service，一併加入。另把這支檢查加進 `pnpm test`。
- **短連結點擊紀錄不再寫入其他租戶的聯絡人** — 公開的 `/s/track` 帶來的 `cid` 原本不檢查就寫進點擊紀錄與 `link.clicked` 事件；現在必須是該短連結所屬租戶的聯絡人才採用。不是 UUID 的 `cid` 原本會讓點擊默默沒被記錄，現在當成匿名點擊。
- **角色與權限頁可以關閉 admin 角色的內建鎖定權限** — 對 admin 角色的「人員與權限」按「全關」，會連「管理成員」「管理角色權限」這兩個內建鎖定的權限一起關閉，儲存時一定失敗。在 admin 角色取消「檢視角色權限」也一樣，因為「管理角色權限」需要「檢視角色權限」。現在 admin 角色的內建鎖定權限，以及這些權限需要的前置權限，勾選後都在頁面上鎖定，不能取消；「全關」也會略過這些權限。admin 角色缺少這些權限時（例如新增權限碼後還沒有更新角色），仍然可以勾選或用「全開」補回。後端一直都會拒絕這種設定，沒有存入錯誤的資料。
- **角色與權限頁的「全關」不處理其他群組的相依權限** — 例如「聯絡人」全關後，「審核識別建議」與「刪除聯絡人資料」仍然勾選，儲存時一定失敗。現在「全關」會先列出其他群組要一起關閉的權限，成員確認後一併關閉；「全開」也會一併勾選其他群組的前置權限。後端一直都會拒絕這種設定，沒有存入錯誤的資料。
- **「自動開啟」標籤標錯權限** — 標籤原本顯示在相依的權限上，只要它的前置權限已勾選就會出現。現在只標示這次編輯中被系統自動勾選的前置權限，並說明是哪個權限需要它，例如「因「回覆對話」需要而自動開啟」。取消勾選需要它的權限後，標籤也會消失。
- **快速切換角色時，可能把上一個角色的權限存進新角色** — 角色與權限頁收到權限的回應時，沒有確認是不是目前選取的角色。先點一個回應較慢的角色、再點另一個角色，較晚到達的舊回應會蓋掉畫面上的勾選，按儲存就把舊角色的權限存進新角色。切換角色後、權限載入前，勾選格也有一瞬間可以操作。現在頁面只採用目前選取角色的回應，權限載入完成前不能勾選或儲存。
- **權限載入失敗時，側邊選單默默少了項目** — 登入後取得權限失敗時，前端把權限當成空的，側邊選單只剩不需要權限的項目，畫面上沒有任何說明。現在側邊選單會顯示「無法載入你的權限」與「重試」；權限仍然維持空的，不會因為載入失敗而多給權限。
- **以 Passkey 登入後，側邊選單少了項目** — 以 Passkey 登入後，前端沒有載入成員的權限。側邊選單因此隱藏所有需要權限的項目，設定頁的「角色與權限」也顯示沒有權限。成員要重新整理頁面才恢復。現在 Passkey 登入後也會載入權限，與密碼登入相同。

## [2026-10-05]

### Security

- **渠道可見範圍改回 fail-closed** — 沒有綁定任何團隊或成員的渠道，原本所有成員都看得到，而且是完整權限，管理員也無法在建立時限制（#217）。這是 `channel-scoped-visibility` 上線時沒做回填、改用相容分支頂替的過渡做法。現在沒有綁定的渠道只有總店（`channel.view_all`）看得到。上線時 migration 先把既有的這類渠道綁給該租戶所有啟用中的成員，每個人看到的渠道不變。新增渠道時可以選哪些成員看得到（預設全選；Facebook 登入連結的粉專一律給所有啟用中的成員），新增成員時可以選看得到哪些渠道（預設為建立者能選的全部渠道）。沒有總店權限的建立者不能把自己看不到的渠道指派給新成員，新成員的層級也不會高於建立者；建立渠道時建立者會自動加入可見成員。自動派案只派給看得到、而且能回覆該渠道的成員。

- **刪除會把 Telegram bot token 寫進 log 的外掛空殼** — `packages/channel-plugins/src/telegram/index.ts` 是 `TelegramPlugin` 的第二份類別，由套件入口匯出。它的 `sendMessage()` 把 bot token 寫進 info log，而且沒有呼叫 Telegram 就回傳成功。目前沒有程式註冊這個類別，租戶也無法建立 Telegram 渠道，所以沒有 token 實際外洩。這份檔案已經刪除，套件入口改為匯出 `telegram.ts` 的類別，與 `./telegram` 子路徑一致（issue #217）。

### Changed

- **自動化規則頁改成一般管理員看得懂** — 列表與編輯頁用一句話說明規則在做什麼，例如「當收到訊息時，如果開啟案件數等於 0，就建立工單「客戶諮詢」」。列表的觸發事件改顯示中文、名稱過長時截斷（原本會把其他欄位擠出畫面），並加上名稱搜尋與啟用狀態篩選；拿掉從 `9255245` 起就停止更新的執行次數（AUDIT AUTO-02）。編輯頁的「優先級」改名「執行順序」並說明數字越大越先檢查，「命中後停止」改成「這條規則執行後，不再檢查其他規則」；條件區的 AND／OR、+ Rule、+ Group 全部改成中文；觸發事件下方顯示說明，6 種目前不會觸發的事件在選單上標示（AUDIT AUTO-05）。「試試看這條規則」改成依條件填表單，結果用中文說明會不會觸發、會執行哪些動作，不必再手寫 JSON。「指派客服」改成從客服名單選人，不必填 UUID。關鍵字規則的摘要會寫出關鍵字。操作手冊第 4 章同步改寫。

### Fixed

- **自動化規則的「移除標籤」終於會執行；拿掉從未實作的 3 種動作** — 「移除標籤」「指派機器人」「KB 知識庫回覆」「LLM 智能回覆」列在規則編輯器裡，workers 卻從未實作（AUDIT AUTO-01）。「移除標籤」補上實作：聯絡人身上有這個標籤就移除，沒有就不做任何事、不會新建標籤。其他 3 種從契約拿掉：機器人負責的對話本來就會用知識庫與 AI 回覆，規則再觸發一次可能讓客人收到兩則回覆。部署時以資料 migration 清理既有規則：還有其他動作的規則移除這 3 種動作、繼續執行；只有這 3 種動作的規則改為停用。之後規則若還含它們，畫面會標示「LLM 智能回覆（已停用）」與「規則不會執行」。UAT 上只有 2 條已刪除的 Demo 規則含這些動作，沒有實際影響。

- **新增自動化規則時「啟用」沒勾也會立刻執行** — 建立規則的 API 一律把規則存成啟用，前端送的啟用狀態被丟掉。現在依畫面上的選擇建立；API 沒送啟用狀態時仍預設啟用，CLI 與 MCP 不受影響。
- **自動化規則頁的小問題** — 切換啟用失敗時原本只寫 console，現在會顯示錯誤；動作的下拉選單文字被切掉一截。

- **LINE 的語音與檔案訊息收不到內容** — 客人從 LINE 傳語音或檔案，系統只記下「[audio]」「[file]」，沒有下載內容（issue #206）。原因是 `980781d5` 加入外部媒體判斷時誤刪了這兩種訊息的解析。現在恢復解析並下載：語音帶長度，檔案帶檔名與大小；收件匣的語音顯示播放器，檔案顯示可下載的檔名與大小。下載上限 25 MB；客人傳的檔案一律存成下載用的類型，避免 html、svg 在儲存網域執行；下載失敗時收件匣會顯示原因，不再只寫 log。收件匣收到新訊息後的重新整理也改為不丟掉最後一次通知，下載完成後畫面會更新。
- **LINE 的圖片與影片在收件匣顯示不出來** — 下載完成後只更新了 `content.url`，`content.mediaUrl` 仍是 `line-content:` 佔位值，收件匣優先讀它，拿到瀏覽器打不開的網址。現在下載後兩個欄位都改成儲存後的網址，收件匣也只採用瀏覽器打得開的網址，既有的訊息不用補資料就能顯示。

- **自動化規則列表只顯示前 20 條** — 列表 API 預設一頁 20 條，前端沒有分頁，第 21 條以後的規則在畫面上看不到（UAT 的 Demo Tenant 有 155 條，「一般問題自動開案」排第 29 條）。改為逐頁取回全部規則；關鍵字回覆列表原本只取 100 條，也一併修正。API 排序加上 id，翻頁時不會重複或漏掉規則；載入失敗時顯示錯誤，不再顯示「沒有自動化規則」。
- **含舊動作的自動化規則存不進去** — 編輯頁載入既有規則時只濾掉 4 種尚未支援的動作。契約從來沒有的動作（例如舊規則的 `auto_assign`）留在表單上，儲存一定被拒，畫面也沒說是哪個動作。現在依規則的觸發事件，移除契約沒有提供的所有動作，並分開說明：尚未支援的動作只有自己不執行，其他動作會讓 workers 整條略過規則。規則列表也會在 workers 整條略過的規則旁標示「規則不會執行」，原本這種失敗只寫進 log。
- **自動化規則的錯誤訊息是英文** — 契約驗證的錯誤訊息原本只有開頭是中文，後面是 `actions[1].type is not allowed for message.received: auto_assign` 這類技術訊息。現在全部改成中文，寫第幾個條件或動作，並用中文名稱，例如「第 1 個動作「傳送訊息」不適用於「工單關閉」觸發」；系統沒有的舊動作會寫「第 2 個動作「auto_assign」不是系統提供的動作，請刪除」。

## [2026-10-02]

### Added

- **自動化規則可以自動建立工單** — 規則條件命中時（例如顧客訊息含「客訴」「故障」）自動在該對話上開工單：依優先度套用 SLA、對話關聯到新工單、收件匣與工單列表即時更新，分類從系統分類清單選，不指定時由 AI 依顧客訊息自動分類。規則編輯器的選填下拉選單新增「不指定」：原本沒選時畫面顯示第一個選項，實際卻存成空值。同一段對話已有未結案的工單時不重複開，同時處理也不會開出兩張。只在收到訊息、關鍵字命中、對話建立這類有對話的觸發事件提供，工單與 SLA 事件不提供，避免工單開工單。

### Security

- **重抓 LINE 個人資料的端點限定自己租戶** — `PATCH /api/v1/channels/:channelId/contacts/:lineUid/sync-profile` 原本只驗登入，以繞過 RLS 的連線查渠道與身分、條件不帶租戶：任一租戶的成員只要知道其他租戶 LINE 渠道的 ID 與一個 LINE uid，就能用對方渠道的憑證呼叫 LINE，並改寫對方聯絡人的名稱與頭像（AUDIT RLS-05）。現在改走租戶連線，查詢帶 `tenantId`，要求 `contact.update` 權限與渠道可見範圍；其他租戶、看不到、已停用或非 LINE 的渠道一律回 404。前端、CLI 與 MCP 都沒有呼叫這個端點，不影響現有功能。這個端點的規格原本沒有套用到主規格，現在補在 `openspec/specs/line-contact-profile-sync/spec.md`。
- **工單、對話、標籤、短連結依角色權限授權** — 這四個模組的 45 條路由原本只驗登入，租戶在「角色與權限」設定的限制完全不生效：沒有刪除權限的成員仍可永久刪除工單、只能檢視的角色仍可送訊息給客人（AUDIT RBAC-01）。現在每條路由依權限碼檢查（`case.*`、`inbox.*`、`tag.*`、`shortlink.*`），缺少時回 403；建立或編輯工單時順便指定負責人或團隊另需「指派」、改成「已升級」另需「升級」權限，不能用建立或編輯權限繞過。工單與對話原有的渠道可見範圍檢查保留。既有系統角色都具備這些權限；沒有細粒度角色的成員（RBAC 上線前建立且未回填的帳號）權限為空，上線前須先補上角色。
- **refresh token 不能再當 access token 使用** — 客服的 access token、refresh token、粉絲 token 與 MCP 確認 token 都以同一把 `JWT_SECRET` 簽發，驗證端只看簽章：refresh token（30 天）可以直接拿來呼叫 API，成員被停用後也擋不住；日後接回粉絲 token 的簽發（One ID tasks 9.3.3，優惠券的 Account Link）時，粉絲 token 也會通過客服認證，並透過 socket 收到全租戶的訊息（AUDIT AUTH-05）。access 與 refresh token 改帶用途欄位 `typ`，客服 API 與 socket 只收 access token，`/auth/refresh` 只收 refresh token。上線當下既有的 access token 會失效、由前端自動換發，使用者不會被登出（過渡期接受舊格式的 refresh token）。
- **登入防暴力破解** — `POST /api/v1/auth/login` 原本沒有速率限制也沒有失敗鎖定，可無限次嘗試密碼；登入頁的夾娃娃機小遊戲只在前端判斷，直接呼叫 API 就能繞過（AUDIT SEC-05，issue #197）。現在同一 IP 每分鐘最多 10 次；同一帳號（email 不分大小寫）15 分鐘內失敗 5 次即鎖定到區間結束，鎖定期間密碼正確也不放行，CLI 密碼登入共用同一個計數；每次嘗試一進來就原子計數，同時送出大量請求也最多只驗 5 次密碼；不存在的 email 一樣計數，也一樣做一次密碼雜湊比對，回應內容與時間都不透露帳號是否存在；計數用的 Redis 故障時照常登入並留 log，不會讓全站無法登入。停用帳號改在密碼驗證通過後才回「此帳號已被停用」，避免不知道密碼的人確認某個 email 是停用帳號。
- **來源 IP 無法再偽造** — API 原本設 `trustProxy: true`，`request.ip` 取 `X-Forwarded-For` 最左邊的值，使用者自己帶標頭就能偽造 IP；而部署環境的 Caddy 會丟掉主機 nginx 帶來的標頭，API 看到所有人都是 docker 閘道 IP，所有依 IP 的限流變成全站共用一個額度（AUDIT SEC-04）。改為只信任私有網段與本機的代理，Caddy 設定 `trusted_proxies` 保留 nginx 附加的真實 IP。

### Fixed

- **手動選的工單分類被 AI 覆蓋** — 建立工單後系統會依顧客訊息自動分類，原本一律覆寫分類，客服建單時選的分類會被 AI 結果蓋掉。改為工單已有分類就不自動分類。由於客服手動建單時分類是必填，之後 AI 自動分類實際上只會用在「自動化規則建單、沒有指定分類」的工單。
- **自動化規則存得進去卻不會執行的動作** — 「建立工單」「移除標籤」「指派機器人」「KB 知識庫回覆」「LLM 智能回覆」五種動作在執行搬到 workers 時沒有實作，規則可以存檔、條件也會命中，卻從未真的執行（AUDIT AUTO-01）。現在規則編輯器不再提供、新增或修改規則時會說明「目前尚未支援自動執行」；既有規則照常執行其他動作，規則列表與編輯頁會標示含這些動作。只改啟用狀態或名稱時不再驗證整條規則，含這些動作的規則可以直接停用（同 PR #124）。刪除沒有呼叫端的舊執行器 `action-executor.ts`。
- **即時通知在 API 重啟後斷掉** — 前端 socket 建立時把當下的 access token 固定在連線設定，斷線重連一律沿用；access token 15 分鐘就過期，每次部署重啟 API 後，超過 15 分鐘沒換頁的使用者就收不到即時訊息。改為每次連線讀取最新的 token，被拒時先換發再重連（連續最多 3 次）；仍連不上時，頂端列的連線狀態顯示「即時連線中斷，請重新整理」，點一下即可重新整理。
- **工單「首次回應逾時」假警報** — `Case.firstResponseAt` 原本沒有任何程式寫入，套了 SLA 的工單時間一到必定判定首次回應逾時，通知負責人與主管、寫入工單事件、觸發自動化，而且工單沒結案前每 24 小時再發一次；報表的平均首次回應時間也永遠是空的（AUDIT SLA-01，issue #197；UAT 已累積 74 筆相關事件）。現在客服在工單關聯的對話第一次送出訊息時寫入首次回應時間（不早於工單建立時間；AI 與系統自動回覆不算）；把已有客服回覆的對話掛到既有工單時，也會補上工單建立後最早的那則回覆。記錄失敗不會影響訊息送出。
- **部署注意** — 既有工單以 `apps/api/src/scripts/backfill-case-first-response.ts` 補值（預設 dry-run，`--apply` 才寫入，可重複執行）：取工單建立後、關聯對話中最早一則客服訊息的時間。工單建立前客服已回覆、之後沒再回覆的工單補不到值，仍會判定逾時；手動建立、沒有關聯任何對話的工單永遠不會有首次回應時間，套 SLA 時同樣會判定逾時（另案處理）。
- **「操作太頻繁」顯示成「請求格式不正確」** — 所有限流端點超過上限時，全域錯誤處理把 429 改寫成「請求格式不正確，請重新操作」；改回 `RATE_LIMITED`「操作太頻繁，請稍候再試」。
- **登入失敗一律顯示「請確認帳號密碼」** — 登入頁讀錯錯誤欄位，帳號停用、租戶停用、鎖定等原因都看不到；改為顯示後端的說明。

## [2026-10-01]

### Added

- **FB 粉專重新連結** — 用 Facebook 登入連結的粉專權杖失效（管理員改密碼、被移除管理員身分、在 Facebook 移除應用程式等）時，原本只能刪掉渠道重建，對話紀錄會跟著斷開。現在「用 Facebook 連結粉專」的選擇頁可勾選本租戶已連結的粉專，系統以新權杖更新原渠道，渠道、對話、設定與分店權限全部保留；新權杖訂閱失敗時原渠道完全不動。自備應用程式連結的渠道不會被轉成平台模式（下游 Webhook 轉發只走渠道自己的網址，轉過去會靜默停止轉發），選擇頁會標示並請管理員改在渠道編輯更新權杖。
- **FB／IG 權杖失效通知** — 每 6 小時檢查一次啟用中的 FB／IG 渠道權杖。失效時渠道卡片顯示紅色警示並說明處理方式，同時以站內通知與 email 告知該租戶所有管理員；持續失效每 3 天再提醒一次；手動更新權杖後按「測試連線」成功即清除警示。只有明確的失效訊號（權杖過期／被撤銷、權限被移除）才算失效，網路錯誤、Meta 服務異常、限流與其他無法判斷的錯誤不會誤報；檢查途中權杖剛被更新時不寫入舊結果、不發通知（資料庫端原子比對）。

### Security

- **OAuth 授權碼不進 log** — API 的請求 log 會遮蔽網址上的 `code`、`state`、`access_token`、`token`、`hub.verify_token` 參數，Facebook 授權回呼的授權碼不再以明文寫進 log。

### Changed

- **綁定訊息改用公開帳號名稱** — 跨渠道綁定的邀請、確認與完成訊息原本寫的是後台自取的渠道名稱（例如「Facebook（測試粉專）」「LINE（第二個line串接）」），顧客會看到內部命名。改為平台上的公開帳號：FB 用粉專 username、IG 用 @帳號、LINE 用官方帳號 Basic ID（例如「Facebook（my.shop）」「LINE（@abc1234）」）。FB 沒有 username 時只寫「Facebook」，不顯示數字粉專 ID。後台畫面（收件匣、聯絡人頁、渠道管理）仍顯示渠道名稱。
- **按鈕名稱一致** — 渠道編輯視窗「跨渠道綁定」欄位的提示原本寫「請按『驗證』」，但渠道卡片上的按鈕叫「測試連線」，統一改為「測試連線」。
- **既有 Meta 應用程式可直接當平台應用程式使用** — 同一個 Meta 應用程式底下，「自備應用程式」的渠道與「用 Facebook 登入連結」的渠道可以並存：事件不論從渠道自己的 Webhook 網址或 `/api/v1/webhooks/meta` 進來，都會派給正確的渠道。因此沿用既有應用程式送審時，不必先改回呼網址，既有渠道照常收訊。不同應用程式之間仍互相隔離。
- **修復部署失敗** — 根目錄 `package.json` 的 `@types/node` 改為 `^24.19.0` 後 `pnpm-lock.yaml` 沒有同步，Docker 建置的 `pnpm install --frozen-lockfile` 失敗，合併到 `main` 的部署都會失敗。同步 lockfile 的版本寫法（不升級任何套件）。
- **測試改由 Vitest 統一執行** — 原本每個測試檔用 `tsx` 個別執行，沒有統一指令，有些測試在 `main` 上失敗了幾個月也沒人發現。現在根目錄的 `pnpm test` 會執行所有套件的 unit 測試，不需要任何外部服務；`pnpm test:feature` 執行需要 PostgreSQL 與 Redis 的 feature 測試；`pnpm test:all` 兩組都跑。只想跑部分測試時用檔名篩選，例如 `pnpm --filter @open333crm/api test -- case.service`。原本逐檔執行的 `test:*` script 已移除。
- **測試目錄改為 `tests/unit` 與 `tests/feature`** — 參照 Laravel 的 `tests/Unit` 與 `tests/Feature`，測試從 `src/__tests__` 搬到各套件的 `tests/` 底下，`tests/unit` 的目錄對應 `src/`；只測其他套件的測試搬到該套件。測試以 `#src/` 引用原始碼（`package.json` 的 `imports`）。workers、widget、channel-plugins 的測試原本放在 `src/` 內，會被編進 `dist/`，搬出後不再發生。
- **feature 測試使用獨立的測試資料庫** — 不再寫入開發資料庫。執行前自動建立 `open333crm_test`、套用全部 migration、建立兩個固定測試租戶，並使用 Redis 的獨立資料庫；只允許連到本機。原本 8 個需要資料庫的測試檔在沒有 `DATABASE_URL` 時會默默跳過、看起來像通過，現在一律實際執行。

### Fixed

- **AI 偽造綁定代碼** — 顧客打錯綁定關鍵字（例如「綁定帳號綁定帳號」）時訊息會交給 AI，AI 照對話紀錄裡的綁定訊息編出一整則導流訊息，含系統裡不存在的代碼，顧客照做只會收到「代碼無效」（UAT 實測）。AI 回覆與知識庫自動回覆讀的對話紀錄改為不含系統發的綁定訊息、其他訊息中的代碼遮掉；AI 回覆仍含代碼時整則換成固定說明（綁定啟用時引導傳送綁定關鍵字，未啟用時請洽客服），並在訊息標記 `bindingCodeBlocked`。
- **5 個在 `main` 上失敗的測試** — `cli-session-auth`、`passkey.service`、`tagging.service`、`sla-contract`、`inbox-realtime-source` 都是程式改了、測試沒跟上，逐一查證後沒有發現程式錯誤，已更新測試。刪除標籤另外新增契約測試，確認 route 在租戶交易內呼叫 `deleteTenantTag()`，因為 service 依序刪除，只有在這個交易內才是原子的。
- **滿意度評分可被他人改寫（跨租戶）** — 客人回覆 `csat:<分數>:<工單 ID>` 時，系統原本只依工單 ID 找工單，不檢查工單屬於哪個租戶、哪位客人。任何人只要知道一個工單 ID，就能從任一租戶的官方帳號改寫別的租戶的工單評分，並讓對方的渠道送出感謝訊息、通知主管。現在只寫入「收訊的租戶、而且是這位客人自己」的工單；客服手動記錄時只能寫入自己租戶的工單。不符合的評分訊息仍會被攔下，不寫入、不回覆，也不交給 AI 或自動化。（AUDIT RLS-06）
- **已付費的試用租戶到期仍被停用** — 試用租戶在 `/dashboard/plan` 申請升級、經平台核准後，系統只換了方案，沒有讓租戶脫離試用；到了原本的試用到期日，排程仍會停用這個已付費的租戶，保留期滿後再標記為已清除。現在核准升級申請時，試用租戶會脫離試用、恢復啟用並清除「已清除」標記；試用管理的「轉正式」也會一併清除這個標記。加購申請與在租戶頁改方案不會脫離試用，租戶頁會提示這一點。試用方案不能當成升級申請或「轉正式」的目標，建立與核准都會被拒絕；試用方案依平台的試用設定判斷，不再寫死。部署前要先修復已受影響的租戶，見 `openspec/changes/archive/2026-10-01-fix-csat-intercept-and-trial-upgrade/design.md` 的 Migration Plan。（AUDIT TRIAL-01）

## [2026-09-30]

### Fixed

- **FB／IG 訊息落進錯的租戶（跨租戶資料錯置）** — webhook 原本只依網址上的渠道 ID 判斷訊息屬於誰，不看事件裡的粉專 ID。一個 Meta 應用程式只能設一個回呼網址，多個粉專共用同一個應用程式時，所有粉專的訊息都會寫進回呼網址指向的那個渠道：別的粉專（甚至別的租戶）的顧客出現在錯的收件匣，AI 用錯的粉專權杖回覆而被 Meta 拒收，顧客收不到回覆（UAT 實際發生：Open333test 粉專的訊息落進創造智能租戶）。現改依事件的 `entry.id`（FB 粉專 ID／IG 專業帳號 ID）找出真正的渠道與租戶，一包含多個粉專時各自分派；認領帳號的渠道必須是同一個 Meta 應用程式（應用程式密鑰相同），否則丟棄；沒有任何渠道認領的帳號事件丟棄，不再寫進別的租戶。尚未取得帳號 ID 的舊渠道暫以相容模式照舊收件，避免上線當下斷線。分派異常（收到不屬於本渠道的帳號、應用程式不符、尚未取得帳號 ID）會顯示在「渠道管理」的渠道卡片上，不只寫 log。整包含其他渠道事件時不轉發到下游 Webhook，避免把別的租戶的事件轉出去。設 `META_WEBHOOK_ROUTING=legacy` 可退回舊的純網址分派（上線觀察期的回滾開關）。
- **Instagram 帳號 ID 取錯欄位** — IG 渠道驗證原本讀 `/me` 的 `id`（應用程式範圍的使用者 ID），與 webhook 事件的帳號 ID 對不上；改讀 `user_id`（IG 專業帳號 ID）。
- **FB 權杖檢查會蓋掉系統設定** — 渠道狀態檢查寫回權杖到期日時整包覆寫 settings，可能洗掉導流識別等系統維護欄位；改為資料庫端原子合併。

- **停用的渠道不再佔住粉專** — 渠道停用時釋放它的粉專／IG 帳號 ID；被停用渠道或停用租戶佔住的帳號，在另一個渠道「測試連線」時會自動釋放後連結，啟用中的連結不受影響。
- **分派細節** — 認領帳號的渠道已停用時不再安靜丟掉事件；下游 Webhook 設為 immediate 時遇到混包，此渠道自己的訊息改由系統處理而非遺失；改派到自己設有下游的渠道時在該渠道顯示「未轉發到下游」警示。
- **測試連線更嚴謹** — FB 填成個人使用者權杖時驗證失敗（不會把使用者 ID 當成粉專 ID）；IG 取不到專業帳號 ID 時驗證失敗；更換 FB／IG 權杖後自動重新測試連線。

### Added

- **用 Facebook 登入連結粉專（平台 Meta 應用程式）** — 平台設定 `META_APP_ID`、`META_APP_SECRET`、`META_WEBHOOK_VERIFY_TOKEN`、`META_CONNECT_REDIRECT_URI`（與選填的 `META_LOGIN_CONFIG_ID`）後，「渠道管理」出現「用 Facebook 連結粉專」：管理員授權後勾選要連結的粉專，系統自動建立渠道並訂閱訊息，租戶不需要準備自己的 Meta 應用程式、App Secret 或驗證權杖，也不需設定 Webhook。事件統一由 `/api/v1/webhooks/meta` 接收並依粉專 ID 分派。授權用的 state 一次性、綁定發起的租戶、操作者與瀏覽器（HttpOnly cookie，防止把自己的授權網址丟給別的粉專管理員來搶粉專）、10 分鐘過期；授權失敗一律導回渠道頁並說明原因；刪除以此方式連結的渠道會一併取消粉專訂閱；粉專權杖加密暫存於伺服器、不回傳前端；訂閱失敗會移除剛建立的渠道。既有自備應用程式的渠道照常運作。正式開放前需在 Meta 完成權限審查與商業驗證。

### Changed

- **粉專／IG 帳號同一個只能連結一次** — 渠道新增外部帳號 ID 欄位（明文、全平台唯一），按「測試連線」時由系統用權杖向 Meta 取得並寫入，渠道卡片顯示「粉專 ID／IG 帳號 ID」。同一個帳號已連結到其他渠道（不論哪個租戶）時測試連線回報「此粉專／IG 帳號已連結到其他渠道，同一個帳號只能連結一次」，不會建立第二個連結。帳號 ID **只由測試連線寫入、不接受手填**（共用應用程式時手填別人的粉專 ID 可搶走別的租戶的訊息），因此移除 FB 渠道表單與設定精靈的 Page ID 欄位；更換權杖或應用程式密鑰時會清除帳號 ID，需重新測試連線。
- **部署注意** — 需跑 migration `20260930100000_add_channel_external_account_id`、`20260930110000_release_inactive_channel_account`（須 owner 連線），再以 `apps/api/src/scripts/backfill-channel-external-account-id.ts` 為既有 FB／IG 渠道補帳號 ID（預設 dry-run；同一帳號對到多個渠道時衝突者全部不寫入並列出，須先停用多餘渠道）。

## [2026-09-29]

### Changed

- **統一聯絡人合併引擎（跨渠道 One ID P0，change `add-cross-channel-one-id`）** — 原本有四套各自實作的合併邏輯（手動合併、合併建議核准、LINE Login、FB Login，外加一套無人呼叫的死程式碼），各漏搬不同資料。現收斂為單一 `contact-merge.service`：搬移所有帶 `contactId` 的表（渠道身分、對話、案件、長期記憶、活動報名、點數、身分對應、點擊紀錄、流程執行、KB 回饋、廣播收件），標籤／屬性／廣播收件依唯一鍵去重且 survivor 優先（標籤保留到期日），被合併方一律**封存不刪除**；點數帳本為 append-only，改以轉出／轉入兩筆交易合計餘額（原本直接搬交易會讓餘額變成「兩人中最新那筆」），並把搬移明細寫入新表 `contact_merge_logs`（含 RLS）。
- **合併建議改為租戶隔離** — `packages/core` 的合併建議服務原本使用未綁租戶的全域 `prisma` 單例，且核准／拒絕時不檢查建議是否屬於操作者的租戶；改由呼叫端傳入 `withTenant` 執行器並檢查 `tenantId`，建議狀態與合併在同一交易內完成。

### Added

- **跨渠道綁定（One ID）** — 同一位顧客在 LINE、Facebook、Instagram 的帳號可合併為同一位聯絡人，**不需要客戶自有會員庫、不收個資、不需簡訊**。顧客在任一渠道傳送綁定關鍵字（預設「綁定帳號」，整句相符才觸發），系統回覆其他渠道的導流連結與一次性代碼 `BIND-XXXXXXXXXX`（30 分鐘、單次有效）：LINE 為「加好友 → oaMessage 預填代碼」兩步、FB 為 `m.me/{粉專}?ref=`、IG 為 `ig.me/m/{帳號}?ref=`，並附純文字代碼作退路。顧客在另一渠道送回代碼後，系統先回覆顯示對方帳號名稱的確認訊息，**顧客回覆「確認綁定」才合併**（防止連結被轉傳時點擊者在不知情下被併入他人、點數與個資歸對方；10 分鐘未確認即作廢；代碼在確認時才用掉，別人點開連結但不確認不會讓本人的代碼失效），再以統一合併引擎合併（發碼方為存續聯絡人），`IdentityMap` 記為 `BINDING_CODE`，雙邊對話各收到確認訊息；7 天內可回覆「解除綁定」自助解除（只拆顧客目前所在渠道的那筆綁定）。**同一渠道只能綁一個帳號**：代碼被轉給同一個官方帳號的其他人、或合併後同一渠道會有兩個身分時一律拒絕，代碼放回給本人使用。FB/IG 重送同一 referral 事件（含「開始使用」postback、IG 第一則訊息夾帶的 ref）會被去重。IG Icebreaker 帶 ref 時只當 referral 事件處理，不進收件匣、不觸發 Bot。客服代發綁定連結會檢查渠道存取層級（CM-173）。解除合併時，合併當下從被合併方補到存續聯絡人（及其後續合併對象）的電話／email／頭像會一併清除（仍是當時補上的值才清），不把個資留在對方身上。沒有真的合併（代碼無效、同渠道衝突、索取代碼）的新顧客仍會收到首次招呼語。發碼超過頻率上限只回覆一次；邀請訊息沒送到顧客時回報失敗並作廢代碼。合併、解除、合併建議核准皆以條件式更新佔用，兩個操作同時進來時只有一個成功（避免點數重複轉回）；合併時同時鎖定被合併方與存續方（依 id 排序避免死結）。連環合併不照順序解除時，已轉回的點數會從後續合併紀錄扣抵，不會重複轉移。解除時聯絡人關係一併還原。身分縫合（stitcher）以電話／email 比對時排除已封存的聯絡人。新顧客的招呼語排在確認提示之前送出；沒有待確認時傳「確認綁定」視為一般訊息；確認時若合併失敗會放回代碼與待確認狀態。客服代發綁定連結另計次數，超限只回報給客服。渠道驗證、導流識別 API 與一般渠道設定儲存皆改用資料庫端 JSON 原子更新，系統維護欄位以寫入當下的現值為準，不會互相蓋掉。「傳送綁定連結」按鈕只在租戶啟用跨渠道綁定時顯示。入站管線在首次招呼語與 AI／關鍵字／自動化**之前**攔截，命中時不觸發 Bot。發碼每小時 5 次、兌換失敗每小時 10 次後不再回覆。功能預設關閉，於「設定 → 跨渠道綁定」啟用（`GET/PUT /api/v1/settings/identity-binding`）。
- **顯示渠道名稱** — 同一租戶可能接多個 LINE 官方帳號或粉專：收件匣（對話列表、對話標題、右側聯絡人面板）、聯絡人頁「渠道身份」、渠道編輯視窗的導流識別區塊、綁定確認與完成通知，都改為顯示「類型＋渠道名稱」（收件匣對話列表改為兩行：頭像右下角以官方渠道 logo 表示類型，渠道名稱以灰色小字獨立一行顯示在訊息預覽下方，過長截斷、滑鼠移上看全名；列表時間改為精簡中文格式「14:05／昨天／週一／9/28」，「Bot 中」縮為小標籤）（例如「LINE（總店官方帳號）」），不再只寫 LINE／Facebook。
- **FB／IG referral 解析** — FB `messaging_referrals`（既有對話）、「開始使用」postback 與訊息夾帶的 referral，以及 IG `messaging_referral` 與新對話第一則訊息／Icebreaker 夾帶的 referral，都會帶出 `ref`（原本整批被丟棄）。非綁定代碼的 referral 只記錄、不落地成空白訊息。
- **渠道導流識別** — 渠道其他設定視窗整包儲存 settings 時會保留導流識別與 FB 檢查結果，不會被舊快照洗掉。渠道驗證時自動存 LINE Basic ID、FB 粉專 username（無則 page ID）、IG username，並檢查 FB 是否設定「開始使用」按鈕；渠道編輯視窗可檢視與手動覆寫（`GET/PATCH /api/v1/channels/:id/binding-handle`，只更新這一欄）。附 `apps/api/src/scripts/backfill-binding-handles.ts` 為既有渠道補抓（預設 dry-run）。
- **客服代發綁定連結** — 收件匣聯絡人面板新增「傳送跨渠道綁定連結」（`POST /api/v1/contacts/:id/binding-link`，需 `inbox.reply` 與該渠道回覆層級存取）；聯絡人頁新增「合併紀錄」可逐筆解除。
- **解除合併** — `POST /api/v1/contacts/merge-logs/:logId/revert` 依合併紀錄恢復被合併的聯絡人，並搬回當次移走的所有紀錄（含 AI 長期記憶）與合併後才在該渠道新開的對話與案件（標籤、屬性不回收）；`GET /api/v1/contacts/:id/merge-logs` 查詢合併紀錄。合併與解除皆以 `contact.merge` 權限守門（原 `POST /contacts/merge` 只驗登入；三個預設角色皆有此權限，既有帳號不受影響）。

### Fixed

- **MCP 工具套用分店渠道可見性（CM-173）** — 原本 MCP 所有工具都不看分店渠道限制：任何持有 CLI token 的帳號（包含只綁部分渠道的分店帳號）可經 `crm_search_contacts`／`crm_get_contact`／`crm_list_cases`／`crm_get_case`／`crm_line_list_conversations`／`crm_line_get_conversation` 讀到其他分店的聯絡人、案件與對話，`crm_line_direct_send` 也能對看不到或唯讀的渠道發 LINE 訊息。現與 REST 同一套規則：列表只回可見渠道；單筆渠道不可見時，回應與「查無此資料」完全相同（無法藉此分辨他店資料是否存在，用渠道＋聯絡人查對話也一樣）；發訊息需回覆層級，預覽與確認送出前各檢查一次，預覽後權限被收回也送不出去，被擋時稽核紀錄記為 `rejected`；權限解析失敗時回通用錯誤，不把資料庫等內部訊息回給用戶端。**尚未涵蓋**（REST 與 MCP 相同的既有狀態）：讀自己渠道的單筆對話／案件時，附帶的聯絡人資料仍含其他渠道的身份；群發與報表不依渠道限制。總店（`channel.view_all`）不受影響。另外案件、對話、渠道列表的 service 函式「可見渠道」參數改為必填，新呼叫端漏傳會編譯失敗，不再悄悄不過濾。
- **`inbound-message-refactor` 測試失效** — 測試的假 Prisma 缺 `message.findFirst`（channelMsgId 去重查詢後加的），整支測試在 main 上就已失敗、失去守門作用；補齊後恢復。
- **聯絡人 API 補上權限守門** — `contact.view`／`contact.update` 權限點早已定義，但 10 條 `/api/v1/contacts/*` 路由（列表、詳情、編輯、貼標、時間軸、對話、案件、合併預覽、合併紀錄）只要登入即可存取，沒有權限的自訂角色也能列出所有聯絡人並查看其對話與案件。現改為依權限點守門：讀取需 `contact.view`、編輯與貼標需 `contact.update`、合併預覽需 `contact.merge`，聯絡人的對話另需 `inbox.view`、案件另需 `case.view`。三個預設角色皆已具備這些權限，既有帳號不受影響。另外，聯絡人的對話、案件、時間軸改依分店渠道可見性（CM-173）過濾，分店帳號不能再經由聯絡人頁讀到其他渠道的對話與案件（原本可繞過收件匣與案件列表的渠道限制）；聯絡人列表與詳情回傳的「渠道身份」也只列出可見渠道，不會看到其他分店渠道的名稱、顧客 uid 與暱稱。
- **移除 `POST /api/v1/fan/auth` 身分冒用漏洞** — 該端點憑任意 `{contactId, tenantId}` 即簽發顧客 token，不驗證呼叫者身分，任何人都能冒充任一顧客存取粉絲門戶。經查無任何呼叫者，直接移除。⚠️ 移除後暫無簽發 fan token 的路徑，`/api/v1/fan/*` 受保護路由（活動、點數）暫不可用；目前無顧客端頁面使用，待優惠券分支的 Account Link 驗證或會員登入頁接上。
- **LINE／FB Login 合併失敗** — 舊實作硬刪來源聯絡人，遇到點數或活動報名紀錄（外鍵 RESTRICT）會整筆失敗，且串聯刪除會連帶刪掉其他渠道身分。改走統一合併引擎後改為封存，且不再比對到已封存的聯絡人。

## [2026-09-22]

### Added

- **LINE delivery resilience 與 tenant-scoped MCP 操作** — LINE Push/Multicast/Broadcast/Narrowcast 發送新增 retry key、409 accepted 去重、request ID 與 BroadcastDeliveryAttempt 持久化，直接訊息將 delivery metadata 寫入 Message；新增 `crm_line_list_conversations`、`crm_line_get_conversation`、`crm_line_search_contacts`、`crm_line_get_broadcast` 唯讀工具，以及具 2-phase signed confirmation、scope/RBAC、quota gate、tenant audit 的 `crm_line_direct_send` 與 `crm_line_broadcast_initiate`。MCP 改用 request tenant Prisma，維持 RLS 隔離。

## [2026-09-15]

### Added

- **888a2a-lite A2A Bridge 整合與 dashboard Tree Navigation** — 新增 `open333 a2a:execute` CLI backend，供官方 `a2a bridge` 透過既有 CLI session 將 A2A prompt 交給 Open333CRM Agent；Hub key 僅由 bridge 以 runtime secret (`A2A_HUB_KEY`) 用於 registration/rotation，不進入 CRM adapter、瀏覽器或 repo。CLI 實作 Single-Flight 請求合併與短暫記憶體防重（Idempotency），避免重連時 duplicate delivery 重複觸發 LLM；加入 `SIGINT`/`SIGTERM` 優雅中斷處理（Graceful Shutdown），確保進程終止時非零退出由 bridge 保留任務重試。Dashboard 導覽升級為權限感知的階層式 tree，修正父子節點雙重選中樣式，並使 Knowledge Base、Marketing、LINE、Portal、Shortlinks、Settings 各子模組皆可直達 canonical routes（如 `/dashboard/settings/a2a`、`/dashboard/knowledge/chat-prompt`）。新增 A2A 狀態 API/UI，嚴格遮罩 Agent ID 且完全不暴露金鑰。提供 bridge 獨立守護進程（Systemd 與 Docker Compose）運行手冊。

- **首次進站招呼語（CM-176）** — 粉絲首次加入或第一次來訊時自動送出一則歡迎訊息，三渠道統一（LINE 的 `follow` 加好友事件亦觸發，不必等對方先開口）。招呼語為**真實訊息**：寫入對話紀錄、推播至後台收件匣、並經既有發送管線推送至該渠道（有別於 WEBCHAT 既有的 `welcomeMessage`，後者僅是前端顯示用的 greeting，兩者並存互不影響）。支援 `{{contact.name}}` / `{{contact.phone}}` / `{{contact.email}}` 變數，解析失敗時退回原字串不擋發送。設定存於 `channel.settings.firstContactGreeting`（**無 schema 變更**），留空即關閉，功能預設關閉。「只送一次」的保證來自 `ChannelIdentity` 的 `@@unique([channelId, uid])`——只有成功建立身分的請求會被標記為首次，併發或平台重複投遞的另一方撞 P2002 而不觸發；**刻意不用記憶體快取**，因本專案多實例部署會導致每個實例各送一次。整段 try/catch 隔離，招呼語失敗不影響 inbound 訊息落地（CM-175 教訓）。設定入口在渠道的「機器人設定」彈窗。
- **`contact.created` 事件補上發布點（CM-176）** — 該事件在 `packages/automation` 早有完整的型別、fact-builder 與 listener 支援，但 `apps/api` 從未發布過，自動化規則因此永遠等不到這個觸發點。現於首次建立渠道身分時發布，並在 `automation.worker` 接上訂閱轉為 `automation:evaluate` job。
- **ESM interop 守門（`scripts/check-workspace-esm.mjs`）** — 掃描 CJS 套件是否匯入了 ESM 套件的「轉出式 re-export」符號。此類退化編譯期完全不報錯（副檔名補齊後拿掉 `"type": "module"` 仍可編譯成功，產物只是默默退回 CJS），typecheck 也攔不到，故需獨立守門。`--strict` 供 CI 使用。
- **inbound 聯絡人解析防迴歸測試（`apps/api` `test:inbound-contact`）** — 五組情境：注入式 executor 生效、未綁定 UID 回 null 不拋錯、新 UID 首次進站建檔、既有身分歸戶不重複建檔、跨租戶相同 UID 互不污染。
- **LLM 2md 感知能力與防驚群容錯架構（integrate-2md-grounding-capabilities）** —
  - **防驚群與節點健康追蹤（Anti-Thundering-Herd & Circuit Breaker）**：在 `web-client.ts` 引入 `SingleFlightManager`，並發請求相同網址、搜尋詞或文檔/圖片 hash 時合併為單一 Promise 執行；加入 `BoundedMemoryCache` 提供短暫 TTL 快取；實作節點健康狀態機（Circuit Breaker），當節點連續失敗達到閥值自動進入冷卻狀態（OPEN）並以隨機抖動（Jitter）容錯切換至備援節點，避免瀑布式崩潰。
  - **多模態感知工具（Agent Multimodal Tools）**：在 `tool-registry.ts` 新增 `ocr_image`（呼叫 2md PP-OCRv4 引擎辨識截圖、收據與發票）與 `parse_document`（呼叫 2md AnyDoc 引擎將 PDF/DOCX/XLSX/CSV 解析為 Markdown），皆具備嚴格的 SSRF 防護、大小限制（10MB/20MB）與輸出字元上限。
  - **知識庫文檔解析現代化（KM Ingestion AnyDoc Modernization）**：重構 `packages/brain` 的 `MarkitdownService`，優先以 2md AnyDoc HTTP API 進行多節點文檔轉換，移除容器化環境對本地 Python `.venv` 的硬性依賴。

### Fixed

- **新客第一則訊息全部靜默掉失（CM-175，P0）** — `packages/core` 缺少 `"type": "module"` 被編成 CJS，而 `@open333crm/database` 是純 ESM。在 Node 24（UAT 執行環境）下，CJS `require()` 純 ESM 套件時，`export * from` 的符號可正常取得，但 `export { prisma } from './client.js'` 這類「轉出式 re-export」的符號會遺失，使 `identity-stitcher` 取到的 `prisma` 為 `undefined`，於 `resolveUidToContact` 存取 `.identityMap` 時拋 TypeError。影響面是「尚未建立 IdentityMap 的渠道 UID」——即每位新客的第一則訊息：webhook 進站、驗簽通過、訊息解析成功，但聯絡人建不出來、訊息不落地、收件匣完全看不到，且因 webhook 仍回 200 而無任何外部徵兆。已綁定身分的聯絡人走快路徑不受影響，因此表面上系統看似正常。修法：`packages/core` 補上 `"type": "module"`（產物轉為 ESM，並補齊相對匯入副檔名）；`identity-stitcher` 改為由呼叫端注入 Prisma executor，不再依賴套件層級的全域 `prisma` 單例——此舉同時消除未綁租戶連線在 Postgres RLS 下的隱患（同 CM-171／CM-172 病因）。
- **解除 Agentic LLM 預設關閉與舊版知識庫底層死鎖** — 
  - `AGENTIC_LLM_ENABLED` 於 `env.ts` 與 `.env.api.example` 改為預設啟用（`true`），並在 UAT `deploy.yml` 自動將伺服器配置校正為 `true`，使收件匣對話正常進入 Agent 工具調用迴圈（可使用 `ocr_image`、`parse_document`、`search_web` 等感知工具）。
  - 修訂 `llm.service.ts` 中的預設提示詞 `CRM_REPLY_SYSTEM_PROMPT`，移除死板硬編碼的「家電產品限定」與「未查獲即強迫回覆轉接專人」話術，恢復為通用的親切客服助理。
  - **Gemini 函式宣告結構相容化（`toGeminiParameters`）**：過濾 OpenAPI 3.0 的 `minLength` / `maxLength` 與不支援的 `format: 'uri'`，並將型別統一映射為大寫（`OBJECT` / `STRING`），解決 Google Gemini 嚴格 Schema 驗證拋 400 導致 Agent 靜默失敗而降級至 KB 的問題。
  - **Ollama 容器網路位址適應（`resolveOllamaBaseUrl`）**：在 Docker 容器化環境下，若租戶 DB 預設存有 `http://localhost:11434`，自動優先回退至 `process.env.OLLAMA_BASE_URL`（`http://ollama:11434`），防止連線拒絕。
  - 修訂 `gemini.provider.ts` 與 `ollama.provider.ts` 內嵌之 `kbContext` 提示詞模板，去除強硬的「超出範圍一律拒答轉接專人」文字，並在 `runner.ts` 捕獲 `generateToolTurn` 錯誤時印出詳細日誌。

## [2026-09-08]

### Added

- **人員直綁可用渠道（CM-173 延伸）** — 「一個帳號＝一個分店」場景：人員編輯彈窗新增「可使用的渠道」勾選，直接指定該帳號能看到/操作哪些渠道，跳過 team 中介。新增 `AgentChannelAccess`（`agent_channel_accesses`，正式 migration 含雙 FK RLS policy，比照 `case_relations`）。可見性解析取「agent 直綁 ∪ team 授權」聯集；legacy 語意調整為「未綁任何 team『且』未直綁任何 agent 的渠道才全租戶可見」（渠道一旦被任一種方式綁定即限縮）。新增 API `GET/PUT /agents/:id/channels`（權限 `channel.assign_team`、含稽核、交易內整組替換）。socket 授權同步此語意。team 那套（ChannelTeamAccess/指派 API/UI）保留，供未來「一分店多店員/派單/報表」使用。

- **總店/分店渠道級可見性（CM-173）** — 單一租戶內依帳號控制可見/操作哪些渠道（LINE/FB/IG）來的對話與案件。新增權限點 `channel.view_all`（總店，看全部渠道，給 admin/supervisor）與 `channel.assign_team`（指派渠道給團隊，給 admin）。核心解析 `channel-visibility.ts`（`getAccessibleChannelIds`：agent→teams→ChannelTeamAccess→channelId，未指派團隊的 legacy 渠道維持全租戶可見、無授權則 fail-closed 回空）。對話/案件列表依可見渠道過濾、單筆讀取不可見渠道回 404、對話操作（回覆/指派/關閉/轉真人）不可見回 403。`ChannelTeamAccess` 由 in-memory mock 改 Prisma 真 DB，新增渠道↔團隊指派 API（`GET/POST/DELETE /channels/:channelId/teams`）。socket room 授權的「總店」判定由寫死 ADMIN/SUPERVISOR 改為 `channel.view_all` 權限點。前端渠道編輯彈窗新增「指派團隊」區塊、收件匣渠道篩選改用可見渠道並加空狀態提示。與 Postgres RLS 分層（RLS 管跨租戶、本功能管租戶內渠道）。新增權限點部署後需跑 reconcile + 清權限快取。

- **人員管理拆分「停用」與「刪除」兩個動作（CM-174）** — 後台人員編輯彈窗新增獨立的「停用」與「刪除」入口。停用（`POST /agents/:id/deactivate`，權限 `agent.deactivate`）維持原行為：設 `isActive=false`、可再啟用、保留 email 佔用。刪除（`DELETE /agents/:id`，權限 `agent.purge`）為新功能：於交易內先清理對 `agents` 為 RESTRICT 的關聯（`notifications`/`cli_sessions`/`passkey_credentials`）再永久刪除 Agent，釋放 email 使其可在其他租戶重新加入（不可復原，前端加二次確認）。列表對停用中的人員顯示「已停用・email 仍被佔用」提示。新增權限點 `agent.deactivate`、`agent.purge`（部署後需跑 `scripts/reconcile-system-role-permissions.mjs` 並清權限快取）。

### Changed

- **`DELETE /agents/:id` 語義變更** — 由原本的「停用（軟刪，僅 `isActive=false`）」改為「永久刪除並釋放 email」，權限由 `agent.delete` 改為 `agent.purge`。停用改用新端點 `POST /agents/:id/deactivate`。`agent.delete` 權限點保留但標記淘汰。

## [2026-09-02]

### Added

- **上傳檔案內容類型偵測** — multipart upload 會在 storage/parser 前以 magic bytes 與 Magika 驗證真實類型；presigned upload 改為 quarantine → `complete-upload` scan/promote，並提供 `UPLOAD_CONTENT_DETECTION_ENABLED`（預設開啟）作緊急回退開關。此功能只做內容類型驗證，不代表病毒掃描。
- **Resend Email API 寄信支援** — 新增 `EMAIL_DELIVERY_MODE=resend`，使用 server-side `RESEND_API_KEY` 與已驗證的 `EMAIL_FROM` 發送試用、平台帳號、用量告警與畫布 Email；保留 `log`、`webhook` 與 SMTP rollback 模式。

### Fixed

- **建立不合法 body 的 `line_flex_template` 素材回 500 而非 400** — `assertLineFlexMessageBody` 呼叫 `normalizeLineFlexMessageBody` 時未接住其對不合法 body（如空物件、contents 非 bubble/carousel）拋出的 `LineFlexTemplateError`，導致冒泡成 500 `INTERNAL_ERROR`。修法：用既有的 `flexErrorToAppError` 把該錯誤轉成明確 400，並對 `validateLineFlexMessageBody` 的 `errors[0]` 加防禦性 fallback。本機實測：空 body 回 400 `INVALID_LINE_FLEX_PAYLOAD`、合法 body 仍 201 建立成功。（撰寫 Flex 操作手冊、建測試素材時發現）
- **AI route merge syntax** — 修正最新分支同步時 `/api/v1/ai/rewrite` 路由缺少結束括號，避免 API TypeScript 編譯失敗。
- **Cloudflare security audit findings** — 修正 authenticated Socket.IO 任意 room 訂閱越權；visitor socket 改為只接受 server-issued Chatbox session/claim；legacy WebChat visitor-token session route 改為安全停用/遷移路徑，message/media 加入 secure contract、3 天 session 上限、payload/檔案/IP/session/channel 限流；`xlsx` 替換為 `@e965/xlsx`，並更新 Engine.IO、Socket.IO parser、sharp、PostCSS 等 production-reachable 依賴。
- **Socket 訂閱限流與 RLS CI 修正** — 訂閱/取消訂閱限制改為每條連線每 60 秒 rolling window；Socket plugin 的 `prismaAdmin` 使用補上明確租戶/資源授權白名單，通過 strict RLS 白名單檢查。
- **Gemini 多工具回覆格式修正** — 連續的 tool responses 合併為同一個 Gemini `user` turn，避免多工具呼叫時產生不符合 API 規範的連續 user turns。
- **Agent retention 冪等清理** — 清理工具呼叫暫存資料時排除已標記為 `EXPIRED` 的資料，避免重複更新。
- **PR review 安全修補** — 修正 public Chatbox 的 RLS client、舊版 WebChat embed 相容性、team-scoped conversation room 授權、Agent bot mode/Wiki 權限/feature flag、Agent timeout 與 inbound history 重複，以及 workers retention 清理條件。
- **Agent retention RLS 與敏感內容清理** — standalone worker 優先使用 `DATABASE_URL_ADMIN` 執行跨租戶 retention；過期 AgentRun 會同步清除 user prompt，避免客戶上下文繞過三天保留政策。
- **Worker RLS fail-closed** — standalone workers 若未設定 `DATABASE_URL_ADMIN` 會在啟動時明確失敗，避免 forced RLS 讓 retention/scheduler 靜默變成 no-op。
- **PR review follow-up** — public WebChat 限流改讀 trusted reverse-proxy client IP；Agent 回覆寫入前以 `BOT_HANDLED` 條件 claim 對話；workers 範例改用已 provision 的 `app_admin` role。
- **Chatbox / Agent RLS race 修正** — public Chatbox 改用明確 admin client；Agent bot reply 以交易內條件 claim `BOT_HANDLED` 對話後才建立訊息，避免人工接管後仍送出 bot 回覆。
- **Open channel room 相容性** — 未設定 team access 的 channel 維持租戶內客服可存取；有明確 team 綁定時則嚴格依 team membership 授權。

## [2026-08-28]

### Security

- **UAT 對外暴露面收斂（docs/27 S0 / P1）** — `docker-compose.yml` 所有服務 port 發布改綁 `127.0.0.1`（postgres 5433 / redis 6380 / ollama 11434 / minio 9000-9001 / api 3001 / web 3000 / caddy 8888），對外流量一律走主機 nginx（80/443）；caddy 直接寫 `127.0.0.1:8888:80`，deploy.yml 原 sed 改埠步驟自然失效（no-op）。搭配 AWS Security Group 只留 22/80/443 為雙保險。主機側另已清除 `/tmp` 含密碼的 env 備份、啟用 fail2ban（sshd jail）。

### Security

- **UAT 對外暴露面收斂（docs/27 S0 / P1）** — `docker-compose.yml` 所有服務 port 發布改綁 `127.0.0.1`（postgres 5433 / redis 6380 / ollama 11434 / minio 9000-9001 / api 3001 / web 3000 / caddy 8888），對外流量一律走主機 nginx（80/443）；caddy 直接寫 `127.0.0.1:8888:80`，deploy.yml 原 sed 改埠步驟自然失效（no-op）。搭配 AWS Security Group 只留 22/80/443 為雙保險。主機側另已清除 `/tmp` 含密碼的 env 備份、啟用 fail2ban（sshd jail）。

### Added

- **平台帳號開通與自助管理（platform-user-management）** — 平台後台新增「平台帳號」管理頁，平台管理員可直接開通新的 `PlatformUser` 帳號（不再只能靠手動 SQL），涵蓋完整生命週期：**開通只需輸入 email/name，密碼由系統隨機產生**（高熵英數混合、排除易混淆字元）並寄信告知，帳號標記 `mustChangePassword: true`——**新帳號首次登入後，除「自助改密碼」外的所有平台 API 一律被擋（403 `MUST_CHANGE_PASSWORD`）**，直到改密碼成功、旗標清除為止；列表、編輯（name/email）、停用/啟用（防呆：不可停用自己、至少保留 1 個啟用帳號）、重寄開通信（會產生新臨時密碼取代舊值、重新要求改密碼），帳號詳細頁可查詢該帳號相關的 `PlatformAuditLog` 操作紀錄。同時補上系統原本完全沒有的密碼重設機制：已登入自助改密碼（需驗證舊密碼，成功後清除 `mustChangePassword`）＋忘記密碼自助重設（`resetTokenHash`/`resetTokenExpiresAt` 時效 token、sha256 雜湊、單次使用、防枚舉，比照 `TrialSignup.verifyTokenHash` 模式，成功後同樣清除 `mustChangePassword`）。新端點皆掛 `authenticatePlatformSuperuser` guard（公開的 forgot/reset-password 另加 IP rate limit），寫入操作皆記 `PlatformAuditLog`（不含明文密碼）。新增 `platform-user.service.ts`、`platform-password-recovery.service.ts`、`platform-user-emails.ts`（開通信/重設信模板，純 HTML inline-style，不走 MJML）、`shared/utils/temp-password.ts`（臨時密碼產生工具）；前端新增 `/admin/platform-users`（列表+開通表單，不含密碼欄位）、`/admin/platform-users/[id]`（詳細頁，顯示是否已改密碼）、`/admin/change-password`（支援 `?forced=1` 強制模式，不顯示側邊欄）、`/admin/forgot-password`、`/admin/reset-password`；登入頁與 API 攔截器偵測 `mustChangePassword`/`MUST_CHANGE_PASSWORD` 自動導向。OpenSpec change `platform-user-management`。
- **平台租戶詳細頁（點租戶往下鑽 + 編輯）** — 平台後台租戶管理的租戶名稱改為可點擊，進入 `/admin/tenants/[id]` 詳細頁：資料量統計（客服/渠道/聯絡人/對話/案件）、基本資料編輯（站台名稱、方案切換——方案變更即時失效權限天花板與租戶方案快取，比照 convertToPaid）、啟用/停用、合約期間編輯、成員清單（姓名/Email/角色/狀態）＋成員操作：**修改成員 Email**（即登入帳號，全域唯一衝突回 409）與**重寄開通信**（複用手動開通信模板，不含密碼）。新端點 `GET /platform/tenants/:id`、`PATCH /platform/tenants/:id`、`PATCH /platform/tenants/:id/agents/:agentId`、`POST /platform/tenants/:id/agents/:agentId/resend-welcome`（zod 驗證、寫 PlatformAuditLog）。
- **平台手動開通租戶寄開通信 + 顯示登入網址** — 補上手動開通後「不知道要去哪登入」的斷點：`provisionTenantViaApi` 開通成功後比照 trial 自動寄開通信給管理員 Email（新模板 `sendManualProvisionedEmail`，帶 `${WEB_BASE_URL}/login` 登入按鈕；**不帶密碼**——密碼由開通人員設定，信中註明請洽開通人員並建議登入後改密碼；fire-and-forget 寄信失敗不影響開通）；API 回傳加 `loginUrl`，平台後台開通成功訊息同步顯示登入網址與「已寄信／密碼請自行轉交」提示。

- **LINE 素材可點擊 action 點擊後貼標（點連結自動貼標的全面化）** — 把「短連結被點擊→貼標」擴大到 LINE 素材裡**所有可點擊處**（carousel 按鈕/endPage CTA、flex button、quick reply、imagemap 區域、video endCard）。使用者在素材編輯器每個 action 選一個標籤（來源設定/標籤管理的 CONTACT-scope 標籤），點了就對聯絡人貼標，並自動發 `contact.tagged`→既有自動化訂閱可據以分眾（零額外接線）。兩條路徑、貼標核心完全複用既有：**(1) postback 型**（按鈕/carousel/flex button/quick reply）——選標籤即把 action data 設 `tag:<tagId>`，webhook 新增 `handleTagOnClick` 攔截器（`inbound-postback-interceptors.ts`）收到就 `addTagToTarget(CONTACT, addedBy:system)`，不短路（貼完仍走 CSAT/KB/handoff 與正常訊息流程），標籤不存在/scope 不符/缺 contactId 皆靜默略過不中斷。**(2) uri 型**——選標籤寫進 `action.tagOnClick`，廣播送出時 `convertBodyUrlsToShortLinks` 把 tagId 灌進該 uri 的素材短連結（`findOrCreateMaterialShortLink` 帶入），沿用既有 `trackClick` 貼標；tagOnClick 是內部欄位，送出前 delete 掉不進 LINE payload。前端 `ActionConfigEditor`（carousel/imagemap/flex 共用）加「點擊後貼標」下拉（`useContactTags` hook SWR 快取、只列 CONTACT-scope），postback 選標籤附「接管回傳資料」提示、開啟時從 data 反解還原；message 型（含 imagemap message area）不提供貼標。端到端實測：模擬 LINE postback(正確 HMAC 簽章)→ 聯絡人被貼標(0→1, addedBy=system)、冪等(重複點仍 1)、無效標籤 webhook 仍 200 靜默略過。OpenSpec change `material-action-tagging`。
- **AI 描述生成 Flex 草稿 + AI 潤稿（差異化：一句話產出設計卡）** — Flex 素材（`line_flex_showcase`）新增兩個 AI 能力，接續填空編輯器（階段 1）：**(1) 一句話生成** — 起手空狀態加「✦ 用 AI 描述生成」入口，使用者描述想要的卡片 → 後端 `generateFlexFromPrompt` 組「只輸出合法 LINE Flex bubble JSON + few-shot」系統提示走既有 `llm.service.generateReply`（token 額度硬擋 / 累加 / provider 選擇皆自動生效，不重複包）→ `extractJsonObject` 容錯解析（去 markdown 圍欄、抓 `{…}` 區塊、失敗退階）→ 經既有 `validateLineFlexDraft`（實打 LINE API）驗證，不合法把錯誤餵回 AI 重試一次、再不行回 422 `FLEX_AI_GENERATE_FAILED` 建議改用範本（不硬塞壞 JSON 進編輯器）；產出以 `{ contents, altText, source:'ai' }` 載入**同一個填空編輯器**微調（extractFields 一樣掃出業務分組欄位），範本資訊卡對 AI 來源顯示「AI 生成草稿」。**(2) AI 潤稿** — 填空編輯器 text 類欄位（文字/按鈕文字/按鈕訊息）加「✦ 潤稿」鈕 → 下拉潤飾/縮短/換語氣 → `POST /ai/rewrite`（gemini 等失敗包成 422 `AI_REWRITE_FAILED` 不裸 500），潤稿後更新欄位 + 即時預覽，失敗靜默略過不阻斷編輯。附帶把 showcase 預設 body 改空，讓起手一律進「AI 生成 / 選範本」空狀態。端點：`POST /api/v1/marketing/materials/line-flex/ai-generate`（guard `marketing.manage`、prompt zod min(1)/max(500)）、`POST /api/v1/ai/rewrite`。驗證：後端鏈路 / 路由 / schema 邊界 / 錯誤傳播 curl 實測通過；前端空狀態入口與失敗提示瀏覽器實測；happy path 生成端以 ollama qwen2.5:3b 補驗（AI 產出結構完整合法 Flex、通過本機結構驗證）。無 AI key 時採「樂觀啟用 + 失敗友善提示」不擋範本主線。OpenSpec change `flex-ai-generate`。
- **Flex 範本填空編輯器分組 UI（零程式套用官方設計）** — 「精選範本」（`line_flex_showcase`）的編輯器從「平鋪所有可編輯欄位」升級為「依業務區塊分組填空」，讓非工程人員能像填表般套用官方 Flex 設計、不必理解 box/contents 樹狀結構。(1) `flex-fields.ts` extractFields 為每個掃出的欄位加 `group`（`FlexFieldGroup`：主圖 / 標題與內文 / 按鈕 / 其他），依位置與 kind 推斷（image/icon→主圖、text→標題與內文、button_*→按鈕），並預留 sample.slots 覆寫接口供後續更精準分組；(2) `LineFlexShowcaseEditor` 把欄位裝進業務卡片（帶區塊圖示 header），只顯示有欄位的區塊，欄位標籤用業務語彙（圖片/小圖示/文字/按鈕文字…）取代 JSON path；(3) 技術性的「新增 / 刪除元件」結構操作收進 `⚙ 進階` 摺疊區（`<details>`，預設收合），多數填空使用者不需動結構；(4) 填空即時反映右側手機預覽（沿用既有 renderer），存素材 body 結構（sampleId/contents/altText）不變、通過既有 line-flex validate。端到端實測：餐廳範本欄位正確分組（主圖/標題與內文）、改標題預覽即時更新、進階區容器編輯可展開。OpenSpec change `flex-template-fill`。
- **Rich Menu 分眾綁定（不同受眾看不同圖文選單）** — 台灣 LINE 平台入場券之一。現況零件其實都在（publish 流程完整、channel-plugin bulk-link 已自動每 500 分批），唯缺「把 Rich Menu 綁到分眾」的業務邏輯。補：(1) `resolveAudienceLineUids`——受眾（Segment 走 `calculateSegmentContacts`、或 tag 直接篩 contactTag）→ contactIds → `ChannelIdentity`（channelType LINE + 同 channel）取 uid 去重；(2) `bindRichMenuToAudience` / `unbindRichMenuFromAudience`——檢查 menu 為 published + 有 lineRichMenuId（draft/error 擋「請先發布」），解析 uid 入背景 queue `rich-menu-bind`，立即回 `{ queued: N }`；(3) worker handler 取 channel 憑證 → `plugin.extensions.ui.linkMenuToUsers/unlinkMenuFromUsers`（走背景因受眾大 + LINE bulk-link 有 rate limit）；(4) route `POST /line/rich-menus/:id/{bind,unbind}-audience`（沿用 `richmenu.manage` guard）；(5) 前端已發布 menu 卡片加「綁定受眾」按鈕 + `RichMenuBindDialog`（選分群 → 送出，顯示已綁定人數）。租戶隔離由 contactIds（經 tenantId 篩）+ 本租戶 menu 的 channelId 保證。全體 default 與分眾綁定並存（LINE 規則：per-user 綁定優先於 all-default）。4 項 worker 單元測通過。OpenSpec change `rich-menu-audience-targeting`。
- **素材級點擊歸因（差異化定位「證明哪則訊息有效」）** — 打通「素材 → 短連結 → 點擊 → 歸因回素材」鏈路，讓成效歸因到單則素材（競品只做到按鈕級）。現況原本斷兩處：`ShortLink` 無 `materialId`、且廣播發送完全不經短連結（URL 直發原網址、無點擊可追）。修復：(1) `ShortLink` 加 `materialId`（nullable 外鍵，onDelete SetNull，素材刪除保留短連結與點擊歷史）+ Material 反向關聯；(2) 廣播發送時 `executeBroadcast` 自動把素材 body 內的外部連結（遞迴找 `{type:'uri'}` 與 imagemap `linkUri`，涵蓋所有版型與 Flex）換成帶 materialId 的短連結——素材層共用一條（非 per-recipient）、同素材同 URL 複用既有（`findOrCreateMaterialShortLink`，避免短連結表膨脹）、已是本站短連結不二次包裝；(3) `getMaterialStats` 加點擊數（經 `ShortLink.materialId` 聚合 totalClicks）與點擊率（點擊數 ÷ 使用次數），無短連結歸因資料或未送出時回 null（不假造 0）；(4) 素材詳情頁「素材成效」面板顯示使用次數/點擊數/點擊率/回覆數/開案數，點擊率標「基於廣播發送」。端到端實測：點擊率 12/50=24% 正確、無資料回 null、前端面板正常渲染。OpenSpec change `material-click-attribution`。
- **短連結點擊 → 自動貼標的正規自動化路徑** — 打通「短連結被點擊 → 自動化規則 → 對聯絡人加標籤」這條之前斷掉的鏈路，讓行銷人能在自動化 UI 用「短連結被點擊」當觸發、對點擊者做多種動作（不只硬綁一個 tag）。修復兩處斷點：(1) `automation-engine` 註冊 `link.clicked` 為合法觸發事件（events.ts 加 LINK_CLICKED，category contact、provides contactScopes，合約驗證放行、UI 觸發器下拉自動列出）；(2) worker 動作執行器（`apps/workers/.../automation-actions.ts`）新增 `add_tag` 動作——依 `tagId` 或 `tagName`（找不到則同租戶建立）解析標籤、驗租戶隔離、冪等貼 `contactTag`（addedBy `automation`），缺 contactId/tagId 安全跳過不報錯。`link.clicked` 事件 facts 補 `shortLinkId` / `slug`，規則可判斷點的是哪一條連結。既有 `ShortLink.tagOnClick` 直接路徑保留，兩路徑並存靠 add_tag 冪等防重複。執行路徑：點擊 → link.clicked eventBus → enqueue automation queue → worker `executeWorkerAutomationActions`。5 項單元測試通過（貼標/冪等/缺 contact skip/跨租戶擋/依名稱建立）。OpenSpec change `line-material-basics-and-click-tag`。
- **素材庫治理：分類 / 標籤 / 版本 / 素材級成效** — 素材庫從「表單式單渠道 CRUD」補上治理面（對標競品研究：版本與素材級成效為業界普遍空白）。(1) **巢狀分類**：新增 `MaterialCategory`（tenant-scoped、parentId 自我關聯），列表頁左側分類樹（含每分類素材數）可篩選；分類管理 dialog 可新增 / 改名 / 搬移（後端擋自我循環 CATEGORY_CYCLE）/ 刪除（其下素材 categoryId 由 FK SET NULL 歸「未分類」，不刪素材）；Material 加 `categoryId`，保留舊 `category` 字串過渡。(2) **標籤**：Material 加 `tags[]`，列表頁標籤 chips 篩選（hasSome），`GET /materials/tags` 即時聚合租戶 distinct 標籤（無標籤表）。(3) **複合篩選 + 排序**：列表 `GET /materials` 支援 categoryId / tags / status / channelType / 關鍵字組合 + `sort`（最近使用[nulls last] / 使用次數 / 更新時間 / 名稱）；篩選中膠囊列可逐一移除。(4) **版本控制**：新增 `MaterialVersion`（versionNo 遞增快照），create / update（name 或 body 變動時）寫快照；`GET /materials/:id/versions` 檢視、`POST /materials/:id/versions/:no/restore` 還原（寫回舊內容並產生新版，線性歷史不破壞）；編輯頁時間軸版本歷史面板 + 還原。(5) **素材級成效**：`GET /materials/:id/stats` 由 `BroadcastRecipient` 歸因回覆數 / 開案數，列表使用率長條以租戶內 `maxUsageCount` 正規化 + 顯示既有 `lastUsedAt`（相對時間，null 顯示「—」）；點擊率無短連結歸因資料時回 null（UI 顯示「暫無資料」，不假造 0）。(6) **顯示狀態**：Material 加 `status`（draft / approved 手動切，送審核准狀態機另開 change）。兩張新表納入 Postgres RLS（NULLIF fail-closed policy），實測跨租戶隔離通過。OpenSpec change `improve-material-library-governance`。
- **LINE SafeReply Push Fallback** — LINE 回覆若在原始 webhook 後 30 秒內且仍有有效 `replyToken` 才使用 reply API；Agent 研究、KB 自動回覆或 keyword automation 超過安全窗口時自動改用 push，reply API 明確失敗時再補一次 push。原始 receipt timestamp／replyToken 已貫通 API 與 worker delivery，非 LINE 渠道維持原行為。

- **Agentic LLM 工具循環** — 新增可選啟用的 tenant-scoped Agent runner，支援 Ollama/Gemini tool calling，最多 100 輪並具備總時間、工具數、token、重複呼叫與月額度保護；提供 `search_web`、`read_web_page`、`get_live_weather` 與受權限控管的 `publish_wiki_report`。網頁搜尋／閱讀依序使用 `https://2md.aiurl.tw/`、`https://2md.glsoft.ai/`、`https://create360.ai`；Wiki 回覆只暴露公開 `shareUrl`。Agent 執行 trace、工具紀錄與報告狀態租戶隔離，暫存資料建立後 3 天清理，正式 CRM 對話與已發布 Wiki 內容保留；Agent 失敗時回退既有 KB 自動回覆。預設 `AGENTIC_LLM_ENABLED=false`，需設定相關環境變數後啟用。

- **試用租戶保留期屆滿軟刪 + 復原** — 平台試用政策的「到期後資料保留天數」(trial.dataRetentionDays)先前只儲存不生效，本次落實：trial scheduler 加軟刪分支，掃已停用(isActive=false)且 trialEndsAt 距今超過 dataRetentionDays 天且 purgedAt=null 的試用租戶，設 Tenant.purgedAt=now(標記，不真刪 DB、可復原)+寫稽核 tenant.trial.purge；保留期基準用 trialEndsAt。平台後台 restorePurgedTenant + PATCH /platform/tenants/:id/restore 可復原(清 purgedAt，不動 isActive)；試用管理頁顯示「已清除」狀態 + 復原按鈕。軟刪租戶因 isActive=false 沿用既有 TENANT_DISABLED 擋登入。Tenant 加 purgedAt(nullable migration 非破壞性)。
- **Postgres RLS 租戶隔離（DB 層強制）** — 多租戶隔離從純 app-layer（每 query where tenantId）強化為 **Postgres Row-Level Security**。機制：`app_tenant`（NOBYPASSRLS）連線 + 每個租戶操作於**交易內 `set_config('app.current_tenant', tid, is_local=true)`**（`lib/tenant-db.ts` 的 `withTenant` / `tenantScopedClient` $extends 自動綁定，含 raw query 覆寫），連線歸還池不殘留；白名單（平台/認證/scheduler/OAuth 回調）走 `app_admin`（BYPASSRLS）連線。policy 用 `NULLIF(current_setting(...),'')::uuid` 防未設定時空字串轉型錯（fail-closed）。涵蓋：core 表（contacts/conversations/cases + messages 用 conversationId subquery）、40 個有 tenantId 的租戶表（標準 policy）、23 個無 tenantId 子表（靠外鍵父表 subquery policy）。所有 route 接線：租戶→`request.tenantPrisma`、白名單/平台→`prismaAdmin`、交易 service→`withTenant`、公開端點(webhook)/跨模組(ai/mcp)→保留。實測跨租戶隔離/fail-closed/WITH CHECK 防越權寫入/子表關聯皆通過。**部署注意**：需設 `DATABASE_URL_TENANT`/`DATABASE_URL_ADMIN`（未設 fallback 現況 URL，RLS 未 FORCE 時行為不變）+ 建 app_tenant/app_admin role 密碼；軟回滾＝受約束連線暫切 admin（改 env 重啟，app-layer 仍在不裸奔）。機制與陷阱詳見 skill `postgres-rls-tenant-isolation`。
- **AI 用量告警（80%／100%）** — 租戶 AI token 月額度用量**剛跨越 80%（warning）與 100%（critical）**門檻時，發**站內通知 + email** 給該租戶所有 ADMIN。偵測掛在 `incrMonthlyTokens` 累加後（比較累加前後是否跨越門檻，單次巨量可同時觸發兩級不漏），冪等以 Redis 旗標 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}`（SET NX + 月底過期，跨月自動重置）確保每租戶每月每級僅一次。發送走 eventBus `usage.quota.threshold` → notification worker（複用既有 `notification:dispatch`）+ email（`usage-alert-emails.ts`，warning 琥珀／critical 紅，critical 說明 AI 自動回覆暫停、真人不受影響）。僅 `keySource='platform'` 且有 `monthlyTokens` 上限者觸發（BYOK／無上限不告警），全程 fire-and-forget 不阻塞回覆、不影響既有 `PLAN_LIMIT_EXCEEDED` 硬擋；env `USAGE_QUOTA_ALERTS_ENABLED=0` 可灰度停用。
- **租戶操作稽核日誌（TenantAuditLog）** — 新增租戶層操作稽核（有別於平台方看的 `PlatformAuditLog`），記錄租戶內敏感操作：系統設定變更（`settings.update`）、成員與角色權限變更（`agent.create`/`agent.role.assign`/`agent.password.reset`/`agent.delete`/`role.permission.update`）、聯絡人合併（`contact.merge`）、案件刪除（`case.delete`）、渠道建立/刪除（`channel.create`/`channel.delete`）。稽核於 route handler 主操作成功後以 `writeTenantAudit`（非阻斷，失敗只 log）寫入，payload 僅存非 PII 摘要。租戶 ADMIN 可經 `GET /api/v1/tenant/audit-logs`（需 `audit.view` 權限）分頁查詢並依 action/actor/日期篩選，一律 tenantId scoped。新增 `audit.view`/`data.export`/`data.erase` 三個權限點（feature core，預設只給 ADMIN）。
- **GDPR 資料匯出（可攜權，Art.20）** — 租戶可匯出自己的資料（聯絡人/對話/訊息/案件及附屬），非同步走 BullMQ `data-export` worker：cursor 分頁逐表撈本租戶資料 → 產 JSON（保關聯）+ CSV → 打包 zip（自實作 store 模式 ZIP，免第三方依賴）→ 上傳 MinIO（`export/{tenantId}/{requestId}.zip`）→ 站內通知發起者。API：`POST /api/v1/tenant/data-export`（建請求）、`GET /:id`（查狀態）、`GET /:id/download`（驗 completed + 未過期 + 同租戶，產 15 分鐘短時效下載連結、downloadCount++），皆需 `data.export` 權限。檔案預設保留 7 天，由 `data-export-cleanup` repeatable worker 到期標記 expired 並刪 MinIO 物件。
- **GDPR 資料刪除（被遺忘權，Art.17）** — 新增聯絡人粒度的資料刪除功能，兩種模式：(1) **anonymize（匿名化，預設）** — 抹去 `Contact` 的 PII 欄位（`displayName`→佔位、`avatarUrl`/`phone`/`email`→null）、刪除可識別子資料（`ContactAttribute`/`ChannelIdentity`/`IdentityMap`/`LongTermMemory`）、將該聯絡人所屬對話的 inbound 訊息 `content` 改為 redacted 佔位，但保留 `Conversation`/`Case`/`Message` 統計骨架不刪（報表數字不變）。(2) **hard_delete（硬刪）** — 於 transaction 內先算 affected 計數再連鎖刪除：`Conversation`（cascade 帶走 `Message`/`ConversationTag`/`ChatboxSession`）、`Case`（cascade 帶走 `CaseEvent`/`CaseNote`/`CaseTag`/`CaseRelation`）、`PortalSubmission`、`PointTransaction`，最後刪 `Contact`（cascade 帶走 `ContactAttribute`/`ChannelIdentity`/`IdentityMap`/`LongTermMemory`/`ContactTag`/`ContactRelation`），並刪除對應的 MinIO 媒體附件。API：`POST /api/v1/tenant/data-erasure`（建立請求）、`GET /api/v1/tenant/data-erasure/:id`（查狀態），皆需 `data.erase` 權限並先驗目標聯絡人同租戶（跨租戶回 404）。刪除非同步走 BullMQ `data-erasure` worker，只影響目標 contactId；完成後寫 `DataErasureRequest.status`/`affected` 並記租戶稽核（`data.erasure.request`/`data.erasure.complete`，payload 只含 contactId/mode/affected 計數，絕不含 PII）、通知發起者。
- **方案細粒度分級（功能點 deny／渠道數量／渠道 provider 白名單）** — 平台後台「方案與上限」頁擴充三塊管控，全部即時生效、對既有無方案租戶零影響：(1) **功能點細分** — 每個已勾選功能可展開列出其權限點，逐點取消勾選＝`deny`，`Plan.permissionOverrides { deny: string[] }`；有效天花板＝`permsForFeatures(features)` 減去 deny（deny 高階不連坐低階，如 deny `channel.create` 仍保留 `channel.view`）；改動會失效該方案所有租戶的權限快取。(2) **渠道數量上限** — 新增 `maxChannels` 數值上限，`channel.service.createChannel` 建立時 count 硬擋（達上限 `PLAN_LIMIT_EXCEEDED` 403），只算 isActive、比照 `maxAgents`。(3) **渠道 provider 白名單** — `Plan.allowedChannelTypes`（ChannelType[]），非空且欲建類型不在內即 `CHANNEL_TYPE_NOT_ALLOWED` 403；空陣列＝不限制、只擋新建不影響既有渠道。route schema 以 Prisma ChannelType enum 與 core `PERMISSION_CODES` 驗證輸入合法。兩個新 Plan 欄位皆 migration 非破壞性（有 default）。
- **平台方案設定功能清單動態化（可擴展性）** — 平台後台「方案與上限」頁的功能清單先前寫死於前端，後端新增 feature/權限點不會自動反映。改為由後端 `GET /platform/registry` 動態提供（單一資料源＝`@open333crm/core` 的 FEATURES + permissions registry + ChannelType）：`FEATURES` 加 `desc` 欄位、新增 `buildPlatformRegistry()`；前端方案頁改動態載入。未來於 core 新增功能即自動出現在方案設定，無需改前端。
- **平台層租戶合約日期記錄** — 平台後台租戶管理頁可為每個租戶設定與查看合約起訖日（`contractStartDate` / `contractEndDate`），純記錄供平台方管理，不觸發任何自動生命週期行為（與 `trialEndsAt` 的到期自動停用明確區隔）；受平台 superuser 認證保護、變更寫 PlatformAuditLog；迄日不可早於起日（422）。`Tenant` 加兩個 nullable 欄位（migration 非破壞性、對既有租戶零影響）。
- **租戶隔離 CI 檢查（`scripts/check-tenant-scoping.mjs`）** — 靜態掃描所有對 41 個「含 tenantId 欄位」租戶表的 Prisma query，抓出 where 完全未帶 tenantId 的跨租戶洩漏風險；排除平台層/scheduler/認證入口等合法跨租戶查詢，where 為變數時往上追其定義。`--strict` 模式在偵測到疑似漏帶時 exit 1，已接入 CI（Build 後）作回歸防護。目前 codebase 掃描結果 0 洩漏。
- **人員管理支援指派自訂角色** — 前端新增/編輯人員的角色下拉改為列出租戶所有角色（內建 + 自訂），選內建角色送 legacy `role`、選自訂角色送 `roleId`；成員清單以 `roleRef` 顯示角色名（自訂角色紫色 Badge）；並依 `agent.role.assign` 權限 gating、友善呈現 `ROLE_ESCALATION` 等錯誤。
- **Passkey / WebAuthn authentication** — 新增 Agent Passkey 憑證模型、Redis challenge 防重放、註冊/登入/撤銷 API 與嚴格 RP ID、origin、User Verification 驗證。
- **WebMCP 唯讀 CRM 工具** — 登入後的 CRM dashboard 若瀏覽器支援 WebMCP，會以目前登入 Agent 的 JWT 提供聯絡人、案件、分析與目前客服資訊查詢工具；不支援 WebMCP 的瀏覽器維持原有功能。

### Changed

- **API 外掛架構文件改為請求導向** — 將原本以六種設計模式為主線的說明，改為依序解釋 API 組裝、租戶請求生命週期、外掛作用域、依賴提供與註冊順序；設計模式名稱移至附錄，並修正外掛數量、易失效的路由統計、declaration merging 能力邊界，以及 `onClose` 與 HTTP 請求生命週期混用的說法。
- **系統現況文件改為分層導覽** — 將單一 `SYSTEM-MINDMAP.md` 拆成 `docs/ref/system/` 文件組：首頁只保留系統執行圖、核心元件與閱讀入口，部署、應用與套件、基礎設施、開發交付、實作落差分開維護；並集中執行時驗證紀錄，減少總覽中的重複資訊與閱讀尺度切換。
- Passkey 註冊端點新增 rate limit；未設定 WebAuthn 的部署不再顯示無法使用的登入與綁定控制項。
- Passkey 綁定流程新增裝置名稱輸入與既有 credential 重新命名功能；已綁定清單顯示自訂名稱、裝置類型與備份狀態，方便辨識多個 credential。

### Fixed

- **[安全] 已停用平台帳號仍能用未過期 JWT 存取平台 API（授權繞過）** — `authenticatePlatformSuperuser` guard 即時查 DB 只取 `mustChangePassword`，未查 `isActive`，導致管理員停用某平台帳號後，該帳號手上未過期的 JWT（TTL 2 小時）仍可呼叫所有平台 API，停用形同虛設。修法：guard 查詢一併 select `isActive`，停用帳號直接回 401 `PLATFORM_USER_DISABLED`（即時失效，不需等 token 過期）。本機端到端實測：token 原可用 → DB 設 isActive=false → 同一 token 立即被 401 擋 → 復原後恢復。（bot review 於 PR #170 標為 security concern）

- **對已停用平台帳號重寄開通信無意義卻仍執行** — `resendPlatformUserWelcomeEmail` 未檢查 `isActive`，對已停用帳號重寄會換掉臨時密碼、寄出信，但該用戶登入仍被 `isActive=false` 擋下，白做且讓管理員誤以為對方已能登入。修法：加 `isActive` 檢查，停用帳號重寄回 400 `PLATFORM_USER_DISABLED`（需先啟用再重寄）。（bot review 於 PR #170 指出）

- **平台帳號 email 未正規化（大小寫/空白可能繞過唯一檢查或登入失敗）** — `PlatformUser` 的開通/編輯/登入/忘記密碼查詢皆直接用原始 email 比對，而 Postgres text 欄位大小寫敏感：以 `Admin@X.com` 開通、之後用 `admin@x.com` 登入會查無而失敗，或以不同大小寫繞過唯一檢查建出重複帳號。修法：平台帳號 email 於 zod schema 層統一 `.trim().toLowerCase()` 後再驗格式（登入/開通/編輯/忘記密碼四處共用 `platformEmail`），service 層另加 `normalizeEmail`（`shared/utils/email.ts`）作為雙保險。本機實測：全大寫、前後帶空白的 email 皆能正確命中既有小寫帳號、錯密碼仍擋。範圍僅平台帳號鏈路（租戶端 agent 登入沿用未正規化的既有行為，全系統一致，若收斂需配既有資料 migration，另議）。（bot review 於 PR #170 指出）

- **平台帳號「至少保留 1 個啟用帳號」防呆有併發競態** — `setPlatformUserActive` 原本先 `count({ where: { isActive: true } })` 再 `update`，兩步驟未在同一交易中，若兩位平台管理員同時停用最後兩組啟用帳號，兩邊的 count 皆讀到 2 而各自放行，導致啟用帳號歸零、沒人能登入平台後台。修法：把目標帳號存在性/isActive 讀取、count 檢查與 update **全部**包進同一 `$transaction` 並用 `Serializable` 隔離級別（整個判斷鏈在同一快照，交易外只留不依賴 DB 狀態的「不可停用自己」比對），併發時第二個交易因序列化衝突 abort，防呆確實生效。本機實測正常停用/啟用、「停用自己」、不存在帳號防呆均正確。（bot review 於 PR #170 指出併發競態與交易內狀態一致性）

- **粉絲門戶功能在 RLS 上線後完全失效（CM-172）** — 與 CM-171 同族根因：`portal.routes.ts` 全部 12 處端點沿用未綁定租戶的 `app.prisma` 連線，活動 CRUD/發布/結束/抽獎/提交紀錄/積分查詢調整整個模組被 RLS 擋下。修法：路由改用 `request.tenantPrisma`；service 層（`portal.service.ts`/`points.service.ts`）簽章收斂為 `TenantDb`；`updateActivity` 因內部原本自開 `$transaction`（RLS 交易不可巢狀）特別改為呼叫端先 `withTenant(app.prisma, tenantId, tx => updateActivity(tx, ...))` 開好綁定交易、函式內直接用傳入的 `tx` 操作；公開端點（`portal-public.routes.ts`，粉絲 JWT 身分）用到的 `submitActivity`/`getActivityResult` 維持 `PrismaClient` 不變。Wave 5 E2E 測試（tenant-misc.spec.ts）建立測試活動時發現。

- **短連結功能在 RLS 上線後完全失效（CM-171）** — `shortlink.routes.ts` 全部端點沿用未綁定租戶的 `app.prisma` 連線（未設定 `app.current_tenant` session 變數），Postgres RLS policy 的 `tenantId = NULL` 比較永遠為 false，導致建立短連結直接 500（RLS policy violation）、列表查詢則靜默回空陣列（回 200，不報錯，UI 顯示「目前沒有短連結」）——比報錯更隱蔽。修法：路由改用 `request.tenantPrisma`（每次操作自動綁定租戶 RLS context），service 層對應函式簽章由 `PrismaClient` 收斂為 `TenantDb` 聯集型別；公開重定向端點（`/s/:slug`，無租戶身分）沿用的 `getLinkForRedirect`/`getChannelLiffId`/`trackClick` 維持 `PrismaClient` 不變。Wave 5 E2E 測試（tenant-misc.spec.ts）建立測試短連結時發現。

- **儀表板「開啟中案件」統計卡默默壞掉（CM-163）** — 首頁載入時前端送小寫 `status=open`，cases list API 用 `z.string()` 放行後直塞 Prisma enum（合法值大寫 `OPEN`）炸 400；前端 `Promise.allSettled` 吞錯，畫面看似正常但統計卡永遠拿不到資料。修法雙保險：API list schema 的 `status`/`priority` 改為「轉大寫再驗 enum」（亂值回明確 400 而非 Prisma 內部錯）；前端改送 `OPEN`。UAT E2E smoke（console error 檢查）抓到的第一隻 bug。

- **資料庫租戶隔離：6 張表補外鍵 + 收緊 tags.tenantId（CM-155）** — 修一組多租戶完整性缺口。(1) **問題 1**：`teams`/`tags`/`sla_policies`/`km_articles`/`message_templates`/`automation_logs` 過去有 `tenantId` 欄位卻無指向 `tenants` 的外鍵（2026-04-02 多租戶改造時該批 migration 補了欄位卻漏建這 6 條外鍵），可寫入不存在的 `tenantId` 而 DB 不擋、RLS 的 WITH CHECK 也只驗跨租戶不驗租戶存在。補上 `tenant Tenant @relation(... onDelete: Restrict)`（與其餘租戶表慣例一致）；`message_templates.tenantId` 保留 nullable（系統共用模板能力）故關聯為 optional。本機/UAT 均掃描確認 0 孤兒列，migration 不會被既有髒資料擋下。(2) **問題 3**：`tags.tenantId` 收緊為 `NOT NULL`——系統共用標籤（tenantId=null）為 schema 預留但從未實作、全 repo 無使用、DB 0 筆。(3) **問題 4**：收緊後 `@@unique([tenantId, name, scope])` 對所有列真正生效（Postgres 不把多個 NULL 視為重複），一併解決。(4) **問題 2**：清除 RLS 下讀不到的 `tenantId=null` 系統模板死碼——`marketing.service` 三處 `OR: [{ tenantId }, { tenantId: null, isSystem: true }]` 查詢分支簡化為 `tenantId`，`seed.ts` 移除 `tenantId: null` 寫入（未動 RLS policy，依單建議只走死碼清理路徑）。兩支 migration 皆產正式檔並實測外鍵擋下不存在租戶的寫入。

- **AI Chat 健康檢查誤報「GEMINI_API_KEY is not configured」（未走 BYOK three-tier fallback）** — 租戶已在後台自填 BYOK Gemini key，但「重新檢測 / 狀態」仍誤報 provider 異常。根因：健康檢查鏈路（`GET /settings/chat`、`POST /settings/chat/health`）呼叫 `checkChatHealth` 時**沒把租戶 key 傳進去**，`gemini.provider.health()` 只讀全域 env `GEMINI_API_KEY`；環境未設該 env（如 UAT）時即回「not configured」，與實際發訊息走 `resolveGeminiKey`（租戶自填 → 平台 → env）的三層 fallback 行為不一致。修復：`ChatProvider.health` 介面加 `apiKey?`，`gemini.provider.health` 改用 `getApiKey(apiKeyOverride)` 優先吃傳入的租戶 key，`checkChatHealth` 加 `apiKey` 參數轉傳，兩個 route 呼叫端在 provider 為 gemini 時先 `resolveGeminiKey` 取租戶 BYOK key 再傳入（ollama 不受影響）。修好後健康檢查與發訊息用同一把 key，如實反映 key 可用性。本機端到端實測：設租戶假 BYOK key → health 回 `Gemini API 400: API key not valid`（證明用了租戶 key 而非 env）、error 隨 BYOK key 變化。

- **貼標寫入路徑統一 + 補發 `contact.tagged` + 迴圈防護** — 修架構檢視發現的事件鏈斷點：先前貼標散落三處，只有人工貼標（`tagging.service.addTagToTarget`）會發 `contact.tagged`，短連結點擊貼標與自動化 `add_tag` 都繞過、不發事件，導致「以貼標為觸發」的下游自動化不會被這兩條路徑喚起。修復：(1) `addTagToTarget` 加 `addedBy`（'agent'|'system'|'automation'，預設 agent）、agentId 改選填，`contact.tagged` payload 帶 `source`；(2) `shortlink.trackClick` 點擊貼標收斂到 `addTagToTarget`（消除重複的 find→create，補發事件，source 'system'）；(3) worker `add_tag` 因跨 process 無法 import api service，改 `contactTag.upsert` 冪等貼標 + 透過新增的 redis `domain:event` 橋（`socket.plugin` 端 subscriber 轉成 in-process eventBus）發 `contact.tagged`（source 'automation'）；(4) **迴圈防護**：automation.worker 的 `contact.tagged` subscriber 對 source==='automation' 不再觸發評估，斷開「貼標→規則→又貼標」自我循環（人工/點擊貼標仍可觸發）。**⚠️ 行為變更**：短連結點擊貼標現在會發 `contact.tagged`，可能觸發既有的 contact.tagged 自動化規則（此為修復目的，部署前確認既有租戶無非預期規則）。OpenSpec change `unify-tagging-write-path`。
- **LINE imagemap 動作不再默默降級 postback** — LINE imagemap 官方僅支援 uri/message 動作，原本編輯器讓使用者選 postback、發送時才默默降級成 message。`ActionConfigEditor` 加 `allowedTypes` 白名單，imagemap 編輯器改傳 `['uri','message']`，從源頭不給選 postback，避免使用者誤設。
- **RLS 上線後 migration 全炸修補（部署阻斷，重要）** — Postgres RLS 啟用後 app runtime 的 `DATABASE_URL` 指向受 RLS 的 `app_tenant`（NOBYPASSRLS、非 table owner）。entrypoint 的 `prisma migrate deploy` 沿用同一連線跑 DDL（`ALTER TABLE` 等），被 Postgres 以 `must be owner of table X`（42501 / Prisma P3018）擋下——RLS 切換後的第一個新 migration（`add_tenant_purged_at`）即卡死，API 啟動失敗、UAT 部署中斷。`docker-entrypoint.sh` 改為 migrate/seed 一律走新的 `MIGRATE_DATABASE_URL`（指向 table owner，如 `crm`）；未設時 fallback 到 `DATABASE_URL`（相容 RLS 未啟用環境，行為不變）。此舉同時修好 seed 因 RLS WITH CHECK 擋 `INSERT roles` 的錯誤。部署環境需在 `.env.api` 補 `MIGRATE_DATABASE_URL`。
- **UAT 部署 build 因磁碟寫滿失敗（ENOSPC）修補** — 每次部署 `docker compose build` 疊一層 next/webpack build cache 從不清，累積把 40G 根分割區塞爆（曾達 100%），導致 `next build` 寫 `.next/cache` 時 `ENOSPC: no space left on device` → webpack 編譯失敗 → 部署中斷。`deploy.yml` 在 build 前新增 `docker builder prune -af --filter until=48h`（清 48h 前的 build cache、保留當日增量維持 build 速度），避免磁碟無上限累積。
- **啟動驗證加固：registry 必須保留 selfLock 權限** — `validatePermissionRegistry()` 新增第 6 項檢查：registry 若無任何 `selfLock:true` 權限點即啟動失敗（fail-loud）。避免未來重構誤刪 `role.manage` 的 selfLock 導致 agent.service 的「防自我降級鎖死」守門（`SELF_LOCK_CODES` 為空時整段跳過）無聲失效。（PR review bot 提出的邊界條件，加保險。）
- **自我降級鎖死租戶修補（RBAC self-demotion，安全性）** — `PATCH /agents/:id/role` 先前只擋「向上指派超出自身的角色」（`ROLE_ESCALATION`），降級一律放行，且 route 未傳操作者本人 agentId，使最後一位持有 `role.manage`（`selfLock`）的成員可把「自己」改成不含該權限的角色，令整個租戶失去所有能管理角色/權限的人，角色 CRUD 與權限矩陣頁全 403、只能手動改 DB 復原。現 route 將 `request.agent.id` 傳入 `updateAgentRole`；service 在解析出目標 roleId 後，若目標即操作者本人且新角色的有效權限不含任何 registry 標記 `selfLock:true` 的權限碼（動態抽取，非寫死 `role.manage`），即拋 `SELF_LOCK` 422。管理員改別人角色、或把自己改為仍含 `role.manage` 的角色皆不受影響。
- **RBAC 寫入權限退化修補（canvas / identity）（安全性）** — 延續細粒度權限 migration 的系統性疏漏排查：自動化畫布（canvas）與識別建議審核（identity）兩組路由先前僅有 module-level `authenticate`，完全未掛 `requirePermission`，使 registry 的 `canvas.use`、`identity.review` 權限點形同死碼、任何登入者皆可操作。現為 canvas 全部端點（GET 清單/詳情/analytics/executions、POST 建立/activate/trigger、PATCH 更新）補 `requirePermission('canvas.use')`，identity 全部端點（GET suggestions、POST approve/reject）補 `requirePermission('identity.review')`；registry 未定義獨立 view 權限，故讀取端點一併沿用同一 code 守門。預設 supervisor/agent 角色本就具備此兩權限，既有可用角色不受影響。
- **指派自訂角色不再無謂降級 legacy role** — 前端 `buildRolePayload` 對 custom role 固定送 `role: 'AGENT'`，會把成員原本的 legacy role（如 SUPERVISOR）覆寫成 AGENT，影響仍讀 legacy role enum 的舊功能（實際權限走 roleId 不受影響）。變更角色時改用成員當前 role 作為 legacy 回填值；並將 `Agent.role` 型別收窄為 enum union。（PR review bot 提出，經確認採納。）
- **試用信件模板未轉義使用者輸入（XSS 加固）** — trial 信件的 `{{siteName}}` 等變數來自申請時使用者自填（`siteName` 僅限長度、不限字元），原樣經 `renderTemplateBody` 字串替換進 email HTML 未轉義，可注入惡意 HTML。於 `trial-emails.ts` 的 `render()` 對所有變數值先做 HTML escape 再替換（不動共用 `renderTemplateBody`，避免影響行銷 LINE Flex 模板）。（PR review bot 提出，經確認 `siteName` 確為使用者可控故採納。）
- **新租戶儲存 BYOK Gemini key 失敗（P2025/404）** — `setTenantGeminiKey` 用 `prisma.tenantSettings.update`，但 `TenantSettings` 為延遲建立，新開通、尚未動過任何設定的租戶還沒有此列，直接呼叫 `PUT /settings/gemini-key` 會拋 P2025（回 404）導致 key 存不進去。改用 `upsert`（無列則建立、有列則更新），與本檔其他 TenantSettings 寫入一致。
- **角色指派健壯性：租戶缺系統角色時不再用 null 覆蓋既有 roleId（資料完整性）** — `resolveRoleAssignment` 走 legacy role 路徑時，若該租戶缺對應 system role，`resolveRoleId` 回 `null` 會被寫入 `agent.roleId`，使成員 `getEffectivePermissions(null)` 得空集合而被鎖在系統外（且與 legacy role 雙寫不一致）。現改為此情況直接拋 `SYSTEM_ROLE_MISSING` 錯誤（fail-loud），不再靜默用 null 覆蓋既有有效 roleId。正常 seed/provision 一定建齊三個 system role，不受影響；僅資料未正確初始化的租戶會明確報錯以利修復。
- **試用防濫用去重漏洞：Agent 檢查未正規化 email，gmail 別名可繞過（安全性）** — 試用申請的「是否已是某租戶 Agent」檢查 `emailIsAgent` 原以原始 email（僅 trim/lowercase）比對，gmail 別名（`foo.bar@gmail.com` 與 `foobar@gmail.com` 為同一 Google 帳號）被視為不同 email 而查無，讓已被平台手動開通成 Agent（從未走 trial、`TrialSignup.emailNormalized` 無紀錄）的真人得以申請到第二個試用租戶。改為以正規化值（去 gmail 點/+tag）比對：先撈同網域候選 Agent，再於應用層逐一比對正規化 email。
- **方案數值上限輸入非數字被靜默解除（資料完整性）** — 平台方案編輯頁 `setLimit` 對非純數字輸入（如 `abc`）以 `parseInt` 得到 `NaN`，經 `JSON.stringify` 後 `NaN` 序列化成 `null`，被後端誤解為「無上限」，平台管理員打錯字即可靜默解除 `maxAgents`／`monthlyTokens` 等上限。前端改為 `NaN` 時不更新該欄（維持原值），僅明確空字串／`∞` 才視為 `null`；後端 `updatePlanSchema` 的 `limits` 值改用 `z.number().int().nonnegative().nullable()` 作第二道防線，怪值一律回 422 而非靜默寫入。
- 修正月額度硬擋在解析 `keySource` 之前執行、誤擋 BYOK 租戶：`generateReply` 原先在得知 key 來源前就呼叫 `isMonthlyTokenExceeded`，導致租戶先用 platform key 累計到接近上限、之後切換成 BYOK（自備 Gemini key）仍被舊 platform 累計量擋成 `PLAN_LIMIT_EXCEEDED`。現將額度硬擋移到 `resolveGeminiKey` 解析 `keySource` 之後，且僅在 `keySource === 'platform'` 時執行，與 `incrMonthlyTokens` 只累加 platform 的設計一致（BYOK 略過額度檢查、成本租戶自付）。
- 修正月額度 Redis 計數器初始化的併發 lost-update：`getMonthlyTokens` 與 `incrMonthlyTokens` 冷 key 回填原用無條件 `SET` 覆寫，高併發下會蓋掉另一路徑已建立並累加的計數器（計數器低估、`isMonthlyTokenExceeded` fail-open 少擋）。改為原子 `SET NX + PXAT`（只在 key 不存在時寫入、保留月底過期）；`incrMonthlyTokens` 若 NX 沒搶到（別人剛建好 key，其初始值不含本次）補做一次 `incrby(tokens)`，搶到則初始值已含本次不再累加，確保各路徑本次 tokens 恰好計一次。
- **RBAC 寫入權限退化修補（安全性）** — 修正細粒度權限 migration 的系統性疏漏：知識庫、粉絲活動（portal）、行銷（marketing/material）、渠道（channel）、分析報表（analytics）等模組的一批寫入／有副作用路由，先前僅受 module-level `.view` 或群組 authenticate 保護，導致 registry 定義的 `.manage` / `.broadcast` / `.export` 等寫入權限點形同死碼、寫入保護退化為「只要能檢視即可寫入」。現為各寫入路由補上對應的 `requirePermission` per-route preHandler（建/改/刪、publish/archive/end、import/upload/embed、抽獎、點數調整補 `*.manage`；群發 send/cancel 補 `marketing.broadcast`；渠道 verify/setup-webhook/webhook-base-url 補 `channel.update`；`analytics/export` 補 `analytics.export`），GET 唯讀維持 `.view`。
- 修正月額度 Redis 計數器雙重計數：計數器冷 key（月初 / Redis 重啟 / key 過期）回填時，DB 加總已含剛寫入的本次用量，卻又額外 incrby 一次，導致付費租戶月用量灌水、`isMonthlyTokenExceeded` 在約半量時就誤擋 AI 回覆（`PLAN_LIMIT_EXCEEDED`）。回填分支改為只 set DB 值並保留月底過期，僅在 key 已存在時才 incrby。
- 平台側試用轉付費（`convertToPaid`）改 `planId` 後未失效方案快取，導致 RBAC guard 在 60 秒內仍沿用舊試用天花板、誤將剛付費租戶的新功能擋成 403；現改方案後一併失效權限天花板與租戶 plan 快取（比照升級審核路徑）。
- **自訂角色可經 API 指派給成員** — `POST /agents` 與 `PATCH /agents/:id/role` 新增 optional `roleId`（uuid）欄位，與 legacy `role` enum 並存（提供 `roleId` 時以其為準）；roleId 經 `loadTenantRole` 驗證屬同租戶（跨租戶回 404），並依角色 slug 反填 legacy `role`（system role 對映 enum、custom role 沿用既有值）。修正先前前端建立的自訂角色無法指派給任何成員（只能改 DB）的缺陷。
- **角色指派越權防護（安全性）** — 指派角色時比對指派者角色的有效權限集合，若目標角色含指派者本身沒有的權限即擋下（`ROLE_ESCALATION` 403），取代舊有僅擋「SUPERVISOR 指派 ADMIN」的 inline 硬規則；admin system role 指派者不受限。同時 `PATCH /agents/:id/role` 的權限碼由誤用的 `agent.manage` 改為專用的 `agent.role.assign`（`agent.manage` 保留給建立/編輯成員）。
- 修正一般專員（AGENT）開「我的績效」頁被 403：`GET /analytics/my` 原受 module-level `requirePermission('analytics.view')` 攔截，但預設 AGENT 只有 `analytics.view.self`（`analytics.view` 為 SUPERVISOR 以上），導致個人數據頁打不開、`analytics.view.self` 形同死碼。新增 `requireAnyPermission` guard，module-level 改為 `analytics.view` 或 `analytics.view.self` 任一即放行，其餘完整報表路由（overview/message-trend/cases/agents/channels/contacts/csat）各自補回 per-route `requirePermission('analytics.view')` 嚴格把關，確保只有 `view.self` 的 AGENT 僅能看 `/my`、打不到其他 analytics 端點。
- **降權延遲視窗修補（安全性）** — `POST /auth/refresh` 先前原封沿用舊 refresh token 內的 `roleId`／`role` 重簽 access token，導致管理員降權某成員後，該成員可靠 refresh 續命舊角色達 refresh token TTL（可能 30 天）。現改為 refresh 時從 DB 重讀該成員當前 `role`／`roleId`（帶 `tenantId` 且要求 `isActive`、租戶亦須啟用），停用者不再核發新 token。
- **角色權限矩陣切換角色載入失敗造成跨角色權限污染（資料完整性）** — `RolePermissionMatrix` 逐角色載入權限的 `api.get('/roles/:id/permissions')` 只有 `.then` 沒有 `.catch`，網路瞬斷或 403 時失敗完全靜默，draft/baseline 仍留著「上一個角色」的權限，使用者以為在編輯新角色、按下儲存會把新角色權限覆寫成錯的集合。現補上 `.catch`：載入失敗時清空 draft/baseline、設 `permLoadError` 旗標停用儲存與編輯、顯示明確錯誤與「重試」按鈕，並以 `finally` 收尾載入狀態。

## [v0.4.0] - 2026-08-18

### Added

- **Instagram / Threads 渠道支援** — 整合 Meta Graph API 與 Webhook，支援 Instagram Direct Message 訊息收發與渠道管理：
  - 支援 IG 訊息接收、真人私訊收發與 Bot 自動化回應
  - 渠道設定新增 **憑證設定指南（`ChannelFieldGuide`）**，提供 Meta for Developers / LINE Developers 圖文設定指引
  - 支援單一憑證局部安全更新與 Bearer Header 驗證，避免未填欄位覆蓋舊金鑰
- **多租戶登入與安全防護** — 完善多租戶架構之登入與帳號驗證：
  - `Agent.email` 新增全局唯一約束（Global Unique Constraint）資料庫遷移
  - 登入防枚舉機制：租戶啟用檢查移至密碼驗證後，防止惡意探測租戶狀態
- **系統操作手冊** — 建立完整 11 章 HTML 格式之系統操作手冊（位於 `apps/web/public/manual/`）：
  - 包含系統概觀、案件、聯絡人、自動化、知識庫、行銷、LINE、短連結、分析、設定等完整說明與實機截圖
  - 系統頂部導航列（Topbar）新增「操作說明」直接跳轉手冊
  - 新增 Playwright 自動化截圖測試以利維護最新手冊配圖
- **LINE Flex Message 素材匯入與編輯器** — 行銷素材支援 LINE Flex 訊息樣板：
  - 提供 `LineFlexTemplateEditor` 支援 JSON 匯入、即時渲染預覽與參數編輯
  - 自動化關鍵字回覆支援配置 LINE Flex 素材回覆
- **WebTalk 即時協作** — 新增 WebTalk 協作模組與全域組件（`WebTalkGlobal`），支援團隊即時跨組件協同
- **下游 Webhook 轉發（Downstream Webhook）** — 支援將 CRM 接收到的 LINE Webhook 即時轉發給自訂下游第三方系統
- **聯絡人渠道來源標記** — 聯絡人清單標註渠道來源 Provider（LINE、WebChat 等），並隱藏不必要的 WebChat 渠道資訊
- **MCP Streamable HTTP endpoint** — 新增受認證的 `/mcp` endpoint，提供 CRM 唯讀工具給外部 LLM / MCP client：
  - 支援 `initialize`、`tools/list`、`tools/call` 與 JSON response transport
  - 提供目前客服、聯絡人、案件、分析等 tenant-scoped 唯讀工具
  - CLI Token 可選擇授予 `mcp:read` scope，並加入明確 allowed origins、BigInt-safe response serialization 與反向代理路由
- **LLM Skill 快捷按鈕** — Topbar 右上角新增「Skill」按鈕，快速開啟 LLM Skill 文件

### Changed

- **UAT MCP reverse proxy** — Caddy now forwards `/mcp` requests to the API container, matching the Nginx deployment route.
- **MCP/CI hardening** — MCP route now claims Fastify response ownership before transport setup, and GitHub Actions uses Node.js 24-compatible action majors.
- **前端 UI 全面改版（對齊 Figma 設計系統）** — 86 個前端元件與頁面全面重構：
  - 統一 Tailwind 設計 Token、按鈕、分頁、卡片、狀態標籤、對話框與側邊欄樣式
  - 新增 `/design-preview` 設計系統預覽頁面
- **CLI Session 權限** — CLI Token 新增 `CLI_ANALYTICS_READ_SCOPE` 權限範圍
- **Watch 模式** — 開發環境支援檔案變更自動重載

### Fixed

- **MCP 權限與開發環境 Origin** — `/mcp` 僅接受具 `mcp:read` scope 的 CLI token；開發環境未設定 allowed origins 時保留本機同源/localhost MCP 存取。
- **Webhook identity 併發競態** — stitched contact 建立 `channelIdentity` 遇到 P2002 時改用並發請求已建立的 identity，並以 `isArchived` 保留孤兒 contact 的 soft-delete 語意。
- **Passkey 管理端點防護** — passkey rename 與 revoke endpoint 補上 rate limit。
- **Webhook verify token 隨機性** — Channel 編輯表單改用 `crypto.randomUUID()` 產生 Meta webhook verify token。
- **MCP Prisma 型別來源** — MCP server 改由 `@open333crm/database` 提供 PrismaClient 型別。

- **MCP 串流錯誤處理** — response stream 中途失敗且已送出 headers 時主動關閉連線，讓 MCP client 能辨識截斷回應並重試，避免誤判為成功。
- **Webhook Echo 迴圈防護** — 過濾 Meta Webhook 發送者為自身的 Echo 訊息，防止 Bot 自問自答死迴圈
- **訊息去重與併發防護** — 新增 `(conversationId, channelMsgId)` 資料庫唯一約束與 `P2002` 衝突捕捉，徹底防止平台重複重送或併發造成的重複回覆
- **首則真人訊息 Race Condition** — 修復多則訊息幾乎同時進線時 `channelIdentity` 建立的 P2002 衝突，改取已建立者並回收孤兒聯絡人
- **圖片訊息誤觸發 KB 知識庫問題** — 補傳 `contentType` 於訊息事件，Worker 僅對純文字訊息執行知識庫語意檢索
- **收件匣圖片顯示相容性** — 前端訊息氣泡補齊 `mediaUrl` 與 `url` 欄位解析，修復 Instagram 圖片無法正常顯示之問題
- **關鍵字自動回覆重複觸發** — 修復 `keyword.matched` 事件於背景 Worker 佇列處理時因缺乏 `ruleId` context 導致多條規則重複發送的問題
- **廣播錯誤捕捉** — 強化行銷活動廣播發送過程中的例外捕捉與狀態紀錄
- **Caddy Port 自動修正** — rsync 部署後自動將 Caddy port 改回 8888，避免與 nginx 衝突
- **Nginx SSL 設定保留** — 部署 rsync 排除 `Caddyfile.local`，保留伺服器上已有的 nginx SSL 設定

## [v0.3.2] - 2026-07-09

### Added

- **CLI 連線管理** — 設定頁新增「CLI 連線」分頁，支援：
  - 產生 CLI token 給 LLM 或 `open333` CLI 使用
  - 指定 token 名稱與過期時間（7/30/90/365 天或永不過期）
  - 列表顯示所有 token、最後使用時間、權限範圍
  - 一鍵撤銷 token，立即失效
- **LLM Skill 文件** — `public/skill.md` 供 LLM 自動探索可用 API
- **Skill 快捷按鈕** — Topbar 右上角「Skill」按鈕，快速開啟 Skill 文件
- **GitHub Actions CI/CD** — push to main 自動部署至 UAT 伺服器（self-hosted ARM64 runner）

### Changed

- README 新增「LLM / CLI 連線」使用說明

## [v0.3.1] - 2026-07-09

### Added

- **CLI 技能文件** — 新增 `@open333crm/cli` 完整技能文件 (`docs/cli/`) 供 LLM 代理使用：
  - `SKILL.md`：架構、現有 4 指令、類型、擴充模式
  - `references/quick-ref.md`：每日速查卡
  - `references/capability-gap.md`：20+ 系統功能對應 CLI 指令缺口分析
  - `references/capability-map.md`：優先級實作路線圖與 Checklist
  - `scripts/scaffold-command.ts`：新指令自動生成腳本
  - `assets/`：Command / API 端點模板
- **README 新增 CLI 區段** — 文件連結、使用範例、擴充指南

### Changed

- CLI 專案文件完整化，方便 LLM 代理直接上手擴充指令

## [v0.3.0] - 2026-07-08

### Added

- **短連結追蹤設定** — 後台設定頁新增「追蹤設定」分頁，支援租戶層級設定 GA4 Measurement ID 與 Meta Pixel ID。設定後短連結 redirect 微頁面自動注入對應追蹤腳本，BOT 爬蟲不注入。

### Changed

- **LINE/FB 素材分流** — 素材建立改為先選渠道再選內容類型，LINE 與 FB 各自獨立的 contentType。
- **自動化規則事件感知** — 條件與動作選項會依選定事件動態過濾，切換事件時自動移除不相容選項。
- **人員管理完善** — 支援 Admin/Supervisor 新增人員、角色變更、密碼重置、停用帳號。
- **Figma 設計系統對齊** — Dashboard、Inbox、案件建立等元件視覺收尾，新增 E2E Playwright 測試（13 spec）。

### Fixed

- **案件刪除與 SLA 政策選擇** — 案件列表新增 row-level 刪除，SLA policy dropdown 改為 controlled state。
- **IME 安全的 Enter 處理** — 中文/日文輸入法組字時按 Enter 不會誤送訊息。
- **Inbox 即時更新** — 改用 SWR + 分頁載入，handoff/status/assignment 變更即時反映。
- **通知去重** — BullMQ worker 不再重複發送通知。
- **Caddy WebSocket** — 補齊 `/socket.io/*` 路由，修復 Socket.IO 連線逾時。

## [v0.2.0] - 2026-03-25

### Added

- **AI Copilot** — AI 從全自動回覆改為「副駕駛」模式，提供建議由人工採用。支援 AI 生成行銷素材。
- **通知小鈴鐺** — 即時通知中心，WebSocket 推送案件指派、SLA 預警、CSAT 差評等事件。
- **點數耗盡自動化** — AI 點數不足時自動禁用 AI 功能並顯示警告。
- **團隊渠道授權** — 渠道綁定新增「部門授權」步驟，實現資料權限隔離。
- **AI 採用率分析** — 新增 AI 採用率與客服修正率報表。

### Changed

- **Bot 路由邏輯** — 辦公時間內 AI 從「自動回覆」改為「僅建議」。
- **DB Schema** — 新增 Notification 模型、AI 建議生命週期欄位。

## [v0.1.0] - 2026-03-18

### Added

- **Monorepo 架構** — pnpm workspaces + Turborepo，TypeScript 全端。
- **多渠道整合** — LINE / Facebook Messenger / WebChat 統一收件箱。
- **案件管理** — 完整 Ticket 生命週期， BullMQ SLA 監控。
- **自動化引擎** — json-rules-engine 規則引擎，支援 12 種動作類型。
- **知識庫** — LanceDB + BM25 混合搜尋，語意 + 關鍵字雙檢索。
- **長期記憶** — 聯絡人等級的對話摘要與相似度觸發檢索。
- **行銷系統** — 活動管理、廣播排程、模板變數替換。
- **Docker 基礎設施** — PostgreSQL + Redis + MinIO + Ollama + Caddy。
