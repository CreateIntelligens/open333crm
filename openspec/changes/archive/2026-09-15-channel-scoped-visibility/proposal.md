## Why

企業客戶常見「總店／分店」結構：一個公司（單一租戶）底下有多個分店，每個分店有自己的 LINE／FB／IG 官方帳號，分店店員只該看到、回覆自己分店渠道來的訊息，總店主管則要能綜覽全部。目前系統缺這一層「租戶內的渠道級可見性」——同一租戶內所有 agent 都看得到全部渠道的對話，無法把分店隔開。

這個需求**不是**「一個 email 管理多租戶」（那要重構認證與 RLS）；而是把問題降維成「同一租戶內、依帳號控制可見哪些渠道」，用現有的 `Team` + `ChannelTeamAccess` 骨架即可達成，成本低很多，且不動租戶隔離架構。

## What Changes

- **補完 `ChannelTeamAccess` 為真實資料流**：現況 `apps/api/src/services/channel-team-access.ts` 是 in-memory mock（寫死 `mock-line-channel-id` / `team_sales`，資料存記憶體陣列）。改為讀寫 schema 既有的 `ChannelTeamAccess`（`channelId × teamId × accessLevel`）資料表。
- **收件匣／對話／案件查詢接上「可見渠道」過濾**：REST 查詢（conversation list、inbox、case 等）依「當前 agent → 所屬 teams → 被授權的 channels」限縮結果。目前查詢層沒有這層過濾。
- **「總店」不受限、「分店」受限**：新增可見範圍語意——具備「全渠道可見」權限（總店主管）的 agent 不受渠道過濾；一般 agent 只看被授權渠道。以權限點與 team 授權組合實現，與現有 RBAC 對齊。
- **後台「渠道 ↔ 團隊」指派 UI**：渠道設定頁可指派該渠道給哪些團隊；人員／團隊設定可檢視對應關係。
- **fail-closed 預設**：agent 沒有任何渠道授權且非總店角色時，收件匣為空（看不到 = 安全），而非退回「看全部」。
- **與 socket 授權對齊**：既有 socket room 授權（`socket-room-authorization`）已依 team/channel 判斷；本 change 讓 REST 查詢與其一致，避免「即時推播看不到、但列表查得到」的漏洞。
- **與 Postgres RLS 分層**：RLS 負責「跨租戶」隔離（租戶 A 讀不到租戶 B）；本 change 負責「租戶內」渠道可見性（分店 A 讀不到分店 B）。兩層獨立、不衝突，但查詢實作需確認可見渠道過濾在 RLS session 之上正確疊加。

## Capabilities

### New Capabilities
- `channel-scoped-visibility`: 定義「租戶內渠道級可見性」的契約——agent 可見渠道集合如何解析（agent → teams → ChannelTeamAccess → channels）、總店（全渠道）與分店（受限）角色語意、fail-closed 預設、以及收件匣／對話／案件查詢套用此過濾的行為。
- `channel-team-assignment`: 渠道與團隊指派的管理契約——`ChannelTeamAccess` 的授予／撤銷 API、accessLevel 語意、後台指派 UI 的資料契約，以及此關聯的唯一性與清理規則（刪渠道／刪團隊時的連動）。

### Modified Capabilities
<!-- 無既有 spec 之 REQUIREMENT 被改寫；rbac 僅新增一個「全渠道可見」權限點，屬新增而非改寫既有需求，故不列 delta。實作面與 rbac 對齊細節寫在 design。 -->

## Impact

- **資料庫（packages/database）**：`ChannelTeamAccess` 表已存在，確認欄位（`channelId`、`teamId`、`accessLevel`、`grantedById?`、`grantedAt`）與索引足夠；若 accessLevel 需擴充則產正式 migration。
- **後端（apps/api）**：
  - `services/channel-team-access.ts` in-memory mock → Prisma 真實實作（含 tenant 綁定、快取）。
  - 新增共用函式 `getAccessibleChannelIds(agent)`（agent → teams → channels；總店角色回全部）。
  - conversation／inbox／case 的 list 查詢加入 `channelId in accessibleChannelIds` 過濾；單筆讀取與操作加存取檢查。
  - RBAC：新增權限點（如 `channel.view_all` 或 role 級「總店」旗標）供「全渠道可見」判斷；需跑 reconcile 讓既有租戶 system role 拿到。
- **前端（apps/web）**：渠道設定頁新增「指派團隊」；收件匣渠道篩選僅顯示可見渠道；人員／團隊設定顯示渠道對應。
- **即時層（socket）**：確認 REST 過濾與既有 socket room 授權一致。
- **測試**：新增整合測試——分店 agent 的 conversation list／case list／單筆讀取／socket 皆拿不到未授權渠道；總店 agent 看得到全部；無授權且非總店 → 空。
- **部署**：新增權限點後需跑 `scripts/reconcile-system-role-permissions.mjs` 並清權限快取；資料遷移（若有）走正式 migration。
