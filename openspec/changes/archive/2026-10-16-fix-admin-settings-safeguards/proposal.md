## Why

2026-10-15 重寫操作手冊時盤點「分析與管理」群組，發現多個會蓋掉設定、造成安全問題或讓畫面與實際不符的問題（問題清單 G03–G20）：

- 追蹤設定的 GA4／Meta Pixel ID 沒有驗證，直接拼進短連結中轉頁的 `<script>`，是儲存型 XSS（G06）。
- 營業時間讀取失敗時畫面顯示預設值，按儲存會蓋掉正式設定（G07）。
- 「Webhook 公開網址」一按「套用」就改寫全租戶所有渠道的 webhook 網址，沒有確認，說明還叫人填 ngrok；後端也不驗證網址格式（G08）。
- 打開渠道管理頁就會更新 FB 渠道的「最後驗證」時間（G03）；Bot 最大回覆次數後端不驗證（G04）。
- 收過對話的渠道刪不掉，只顯示泛用錯誤，也沒有停用的按鈕（G15）。
- 停用的成員從列表消失、無法重新啟用（G17，AUDIT AUTH-09）；被停用的成員佔著角色，角色刪不掉，也看不出是誰（G18）。
- 只有個人報表權限的成員看不到「我的績效」；沒有設定權限的成員看得到 AI 設定頁（G09、A06）。
- SLA 的「設為此優先級預設」沒有作用；政策改名或刪除後，舊工單停止計時（G20，AUDIT SLA-03、SLA-04）。
- 匯出的 CSV 用 Excel 開啟中文亂碼（G12）。

## What Changes

- 追蹤設定：GA4 ID 只收 `G-` 加英數字，Meta Pixel ID 只收純數字；產生 script 時再驗一次並跳脫，不合格的值不輸出。
- 營業時間：讀取失敗時顯示錯誤與「重新載入」，停用「儲存」。
- Webhook 公開網址：後端只收 `https` 網址、不得帶查詢字串或片段；前端套用前顯示確認（會改寫幾個渠道），說明改為填正式的公開網域。
- 渠道狀態查詢（`GET /channels/:id/status`）不再寫入資料庫，停用的 FB 渠道也不查；「最後驗證」只由「測試連線」更新。
- Bot 最大回覆次數後端驗證為 1～50 的整數。
- 渠道卡片新增停用／啟用按鈕；刪除有對話等資料的渠道回 409 `CHANNEL_IN_USE`，訊息建議改用停用。
- 新增 `GET /api/v1/agents/inactive` 與 `POST /api/v1/agents/:id/reactivate`；人員管理頁列出停用的成員，可重新啟用。重新啟用套用方案人數上限。
- 刪除使用中的角色時，回應列出佔用的成員（含停用的成員）。
- 側邊選單：「報表」底下的「總覽」要 `analytics.view`、「我的績效」要 `analytics.view.self`；AI 設定（Embedding、Chat & Prompt）要 `settings.manage`。
- SLA：沒有指定政策時優先套用該優先級的預設政策；同租戶政策名稱不可重複；改名時同步更新工單上記的政策名稱；仍有未結案工單使用的政策不能刪除。
- 報表匯出的 CSV 以 UTF-8 BOM 開頭。

## Capabilities

### New Capabilities

- `tracking-settings`：追蹤 ID 的格式驗證與輸出。
- `channel-management`：渠道管理的 webhook 公開網址、狀態查詢、Bot 回覆上限、停用與刪除。
- `sla-policy-selection`：SLA 政策的挑選、命名、改名與刪除。
- `office-hours-settings`：營業時間設定頁讀取失敗時的行為。

### Modified Capabilities

- `agent-lifecycle`：「重新啟用成員」寫明端點與方案人數上限。
- `role-management`：「刪除使用中的角色」回應列出佔用的成員。
- `permission-check`：「前端依權限顯示選單」補報表與 AI 設定的權限。
- `analytics-reports`：新增「匯出的 CSV 以 UTF-8 BOM 開頭」。

## Impact

- API：`settings.routes.ts`、新 `tracking-settings.service.ts`、`tracking-snippet.ts`、`channel.routes.ts`、`channel.service.ts`、`fb-token-monitor.service.ts`、`agent.routes.ts`、`agent.service.ts`、`role.service.ts`、`sla.routes.ts`、新 `sla.service.ts`、`case.service.ts`、`analytics.service.ts`
- Web：`Sidebar.tsx`、`TrackingSettings.tsx`、`OfficeHoursSettings.tsx`、`ChannelManagement.tsx`、`AgentManagement.tsx`、`DateRangePicker.tsx`、報表頁、CLI／API 金鑰頁
- 不需要 migration，不新增權限點。既有資料裡格式不合格的追蹤 ID 不會再輸出，管理員需重新填寫；同名的 SLA 政策不受影響，但之後改名不可撞名。
