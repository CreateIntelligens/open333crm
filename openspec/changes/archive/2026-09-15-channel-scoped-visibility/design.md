## Context

企業客戶的「總店／分店」結構落在單一租戶內：一租戶多個分店，各分店有自己的渠道（LINE/FB/IG OA）。目前系統的資料可見性只做到「租戶層」（靠 Postgres RLS 做跨租戶隔離），租戶內所有 agent 都看得到全部渠道對話，無法把分店彼此隔開。

現況盤點（實際 code）：
- Schema 已有 `ChannelTeamAccess`（`@@id([channelId, teamId])`）、`Team`、`AgentTeamMember`、`Channel`。
- `apps/api/src/services/channel-team-access.ts` 存在但是 **in-memory mock**：`accessList` 是記憶體陣列、初始塞 `mock-line-channel-id`/`team_sales`，`grant/revoke/check` 都只動記憶體，重啟即失。被 `inbound-router.ts`、`message.ts` import 使用（`checkAccess`）。
- Socket 層已有 team/channel 授權（`__tests__/socket-room-authorization.test.ts`，含「team-scoped 對話不 fallback 到 channel access」的案例）。
- **REST 查詢（conversation/inbox/case list）未接**「可見渠道」過濾——grep 不到。
- 剛上線 Postgres RLS（skill `postgres-rls-tenant-isolation`）：每 query 靠 token 的單一 tenantId 設 session 做租戶隔離。

## Goals / Non-Goals

**Goals:**
- 同一租戶內，依「agent → teams → ChannelTeamAccess → channels」解析可見渠道，套用到收件匣／對話／案件的 list 與單筆存取。
- 「總店」角色（全渠道可見）不受限；「分店」角色只看被授權渠道；無授權且非總店 → 空（fail-closed）。
- 後台可指派「渠道 ↔ 團隊」。
- REST 與既有 socket 授權行為一致。

**Non-Goals:**
- 不做「一個 email／身分跨多個租戶」（多租戶身分／MSP portal，屬另案，牽動認證＋RLS 重構）。
- 不改 Postgres RLS 的跨租戶隔離機制。
- 不做欄位級（單一對話內某些欄位遮蔽）或訊息級的細粒度遮蔽——粒度到「渠道」為止。
- 不在本 change 做跨分店的轉派工作流（分店 A 轉給分店 B）；僅做可見性。

## Decisions

### D1. 可見性以「渠道」為單位，透過 Team 間接綁定（而非 agent 直綁 channel）
- **做法**：可見性鏈為 `agent —(AgentTeamMember)→ team —(ChannelTeamAccess)→ channel`。agent 不直接綁 channel。
- **理由**：schema 既有結構就是 team 綁 channel；分店＝team、分店渠道＝掛在該 team 的 channels，語意自然；人員異動只需改 team 成員，不必逐一改渠道授權。
- **替代方案**：`AgentChannelAccess`（agent 直綁 channel）——粒度更細但管理成本高、且要新增表，捨棄。

### D2. 「總店／全渠道可見」用 RBAC 權限點，而非硬編角色
- **做法**：新增權限點（暫名 `channel.view_all`）。持有者略過渠道過濾、看全部渠道。授予給「總店主管」類角色。
- **理由**：與現有 permission-based RBAC 一致（見 rbac-granular-permissions），可由 Admin 在後台調整哪個角色是「總店」，不寫死。
- **連動**：新增權限點後，既有租戶 system role 不會自動取得 → 部署要跑 `scripts/reconcile-system-role-permissions.mjs` + 清權限快取（見 feedback「新增權限點要跑 reconcile」）。
- **替代方案**：`Team` 上加 `isHeadquarters` 旗標——但「看全部」是權限概念，放 RBAC 較一致，捨棄旗標。

### D3. 集中式解析函式 `getAccessibleChannelIds(ctx)`，查詢層統一呼叫
- **做法**：一個共用函式回傳當前 agent 的可見 channelId 集合：
  - 若持有 `channel.view_all` → 回該租戶全部 channelId（或回哨兵值 `ALL` 讓查詢略過過濾）。
  - 否則 → 查 agent 的 teams，再查這些 teams 的 `ChannelTeamAccess.channelId`，去重回傳。
  - 空集合 → 回空（fail-closed，查詢結果為空）。
- **理由**：單一事實來源，避免每個查詢各自拼邏輯漏接；便於加 Redis 快取（key 依 agentId／team 授權版本）。
- **查詢套用**：list 類加 `where: { channelId: { in: accessibleIds } }`；單筆讀取／操作先 assert `channelId ∈ accessible`，否則 404/403。

### D4. mock service → Prisma，保留現有介面
- **做法**：`channel-team-access.ts` 的 `grantAccess/revokeAccess/checkAccess/listChannelsForTeam/listTeamsForChannel` 介面不變，內部改用 `prisma.channelTeamAccess`。既有呼叫端（`inbound-router.ts`、`message.ts`）不用大改。
- **理由**：降低 blast radius；呼叫端只是從「假通過」變「真判斷」。
- **注意**：現在 mock 對未知 channel 的預設行為（可能預設通過）要改成 **fail-closed**；上線前確認 inbound-router 不會因此把合法訊息擋掉（inbound 是「訊息進站分派」，通常不該受 agent 可見性限制——見 R2）。

### D5. RLS 與渠道可見性分層疊加
- **做法**：RLS 先保證「本租戶資料」；渠道過濾在其上再收斂到「可見渠道」。查詢用 tenantPrisma（帶 RLS session）+ `channelId in (...)`。
- **理由**：兩層正交；RLS 管租戶邊界，本 change 管租戶內。切勿用 prismaAdmin（繞過 RLS）做這些查詢。

## Risks / Trade-offs

- **[R1] 查詢遺漏過濾＝分店看到別店資料** → 集中到 `getAccessibleChannelIds` 並在 list/read/操作三處都套用；新增整合測試逐一覆蓋 conversation list、case list、單筆 read、socket，CI 擋。
- **[R2] inbound-router／訊息進站被 fail-closed 誤擋** → 明確區分：「訊息進站分派」是系統行為，不套 agent 可見性（照渠道本身設定路由）；「agent 讀取／列表」才套可見性。改造時保留 inbound 路徑不受 agent 過濾。
- **[R3] 無授權 agent 收件匣全空，像壞掉** → 前端明確提示「尚未被指派任何渠道，請聯繫管理員」，非空白畫面；總店角色不受此影響。
- **[R4] 新權限點未 reconcile → 既有租戶總店角色反而看不到** → 部署 SOP 納入 reconcile + 清快取；migration/部署後驗證。
- **[R5] 可見渠道快取過期 → 授權改了沒生效** → 授權變更（grant/revoke、team 成員異動）時失效相關快取；快取 TTL 短。
- **[R6] socket 與 REST 不一致** → 以 `getAccessibleChannelIds` 為共同事實來源，socket room 授權與 REST 都走它。

## Migration Plan

1. Schema：確認 `ChannelTeamAccess` 欄位足夠（`accessLevel` 若沿用即免遷移）；如需擴充則產正式 migration（勿只 db push）。
2. 後端：實作 `getAccessibleChannelIds` + service 改真 DB；接 conversation/inbox/case 查詢；新增 `channel.view_all` 權限點。
3. 資料回填：既有租戶預設把所有現存 channel 指派給「預設團隊」或給總店角色 `view_all`，確保上線當下沒人突然看不到（避免營運中斷）。
4. reconcile：跑 `scripts/reconcile-system-role-permissions.mjs`，清權限快取。
5. 前端：渠道↔團隊指派 UI、收件匣渠道篩選只顯示可見、空狀態提示。
6. 測試 + 驗證：整合測試綠燈；UAT 用「分店帳號」實測拿不到他店對話。
7. Rollback：以 feature flag／權限預設「全開」為退路——旗標關閉時 `getAccessibleChannelIds` 一律回 `ALL`，行為等同現況（人人看全部），可快速回復。

## Open Questions

- **Q1** `accessLevel`（full/read-only 等）本期要不要落地？建議先只做「可見（full）」，read-only 留後續，避免範圍膨脹。
- **Q2** 一個 agent 屬多 team 時，可見渠道取聯集（預設如此）——是否有「限制型 team」需求（屬於某 team 反而縮小可見）？預設不做，取聯集。
- **Q3** case／contact 的可見性是否也完全依渠道？contact 可能跨渠道（同一人多渠道身分）——本期 case 依其 channelId 過濾，contact 可見性是否延伸需另議（列入 tasks 的待確認）。
- **Q4** 回填時「預設團隊」策略：全部渠道先給總店 `view_all` 是否足夠？分店 team 由客戶自行指派。
