# 平台層 — 數據圖表化、Token 額度硬擋、升級/加購流程

> 承接平台層 usage 統計。這裡規劃三件事：(1) 統計數據的分類與圖表化；(2) AI token 用量上限（quota）+ 超量硬擋；(3) 升級方案 / 加購 token 的操作流程。
> 依已定案：**超量硬擋**（達 100% 停用 AI）；**租戶發起 → 平台核准**（加購/升級申請制）。

---

## 1. 數據分類 + 圖表化

前面盤點的指標分三類，各配**合適的圖表類型**（非全用數字卡）。呈現沿用 dataviz 慣例：語意色（good/warn/bad）獨立於品牌色、金額 tabular-nums、趨勢有面積填色與強調端點。

### 1.1 用量類（Usage）— 看「量」與「趨勢」

| 指標 | 圖表 | 資料源 |
|---|---|---|
| AI Token（prompt/completion）| **堆疊面積圖**（時間軸） | 🔴 AiUsage（須補） |
| 訊息量（inbound/outbound/BOT）| **多線折線圖** | 🟢 Message JOIN Conversation |
| 對話數 / 案件數 / 聯絡人數 | **折線圖 or 數字卡+迷你 sparkline** | 🟢 |
| 各渠道訊息分布 | **橫向長條圖 / 甜甜圈** | 🟢 |
| 自動化執行、broadcast、短連結點擊 | **數字卡 + 週對比** | 🟢 |

### 1.2 計費類（Billing）— 看「錢」與「額度」

| 指標 | 圖表 | 資料源 |
|---|---|---|
| AI Token 用量 vs 額度 | **量表 / 進度環（gauge）** 顯示已用 % | 🔴 AiUsage + quota |
| AI 成本（依 model 分布）| **堆疊長條 / 甜甜圈** | 🔴 AiUsage × Pricing |
| 各租戶成本排行 | **橫向長條排行** | 🔴 |
| 渠道訊息費 | **數字卡** | 🟡 ChannelUsage（須補寫入） |

### 1.3 健康度類（Health）— 看「好壞」與「異常」

| 指標 | 圖表 | 資料源 |
|---|---|---|
| AI 成功率 / 延遲 | **儀表 + 趨勢線**（延遲用線） | 🔴 AiUsage |
| SLA 達成率 / CSAT | **量表 + 好壞色** | 🟢 Case |
| Webhook 成功率 / 自動化失敗率 | **數字卡 + 紅綠燈** | 🟢 |
| KB 👎 率 | **數字卡 + 閾值色** | 🟢 KbArticleFeedback |
| 活躍 Agent vs 上限 | **進度條** | 🟢 |

> **圖表選型原則**：趨勢→折線/面積；佔比→甜甜圈/堆疊長條；額度用量→量表/進度環；單點好壞→數字卡+語意色；排行→橫向長條。避免全部塞數字卡（可掃描性差）。

---

## 2. AI Token 額度（Quota）+ 超量硬擋

### 2.1 額度定義（平台可設，per-tenant）

- 每租戶的 token 月額度來自**方案預設**（`Plan.limits.monthlyTokens`），並可由平台**單租戶覆寫**（加購時提高）。
- 存放：`Tenant` 或 entitlement 上加 `tokenQuotaMonthly`（覆寫；null = 用方案預設）。
- 平台後台可直接設定/調整某租戶的 token 上限（設定方案頁旁）。

### 2.2 硬擋的技術實作 —— 關鍵：需要即時計數器

> **每日彙總（DailyStat, T+1）擋不住即時超量**——租戶可能今天狂用、明天才被統計發現。硬擋必須「即時可查用量」。

**設計：Redis 即時月度計數器 + 每次 AI 呼叫前檢查**

```
每次 AI 呼叫（llm.service / kb-autoreply / ai.service）:
  1. 讀 Redis usage:tokens:{tenantId}:{yyyy-mm}（本月已用 token）
  2. 若 已用 >= 額度 → 直接擋下，不呼叫 LLM
        → 回覆固定訊息「已達本月 AI 額度，請聯絡管理員加購」
        → 記一筆「被擋」事件（供平台看誰卡額度）
  3. 未超 → 正常呼叫 LLM
  4. 呼叫後：把本次 totalTokens 累加回 Redis 計數器（INCRBY）
     並同時寫 AiUsage 一列（供對帳/統計/計費）
```

- **計數器 key 帶月份**（`{yyyy-mm}`），月初自動換 key = 自然月重置；設 TTL 兜底。
- **Redis 為即時真相、AiUsage 為持久對帳**：兩者可能短暫不一致（並發），以 Redis 擋、以 AiUsage 事後校正（如每日用 AiUsage 加總回寫校準 Redis）。
- **擋的位置**：收斂在 AI 呼叫的共用入口（`llm.service.generateReply` 前），一處判斷，涵蓋 reply/summarize/kb-autoreply 各路徑。
- **BYOK 租戶**：用自己的 key、自付成本 → **預設不受平台額度硬擋**（成本不歸平台）；除非平台方要為 BYOK 也設用量上限（可選開關）。

### 2.3 分級提醒（搭配硬擋）

即使硬擋，仍先做預警，避免客戶措手不及：
- 80% → 通知租戶 admin「AI 額度已用 80%」
- 100% → 硬擋 + 通知「已達額度，AI 已暫停，請加購」
- 通知走既有 notification 機制（站內鈴鐺 / email）。

### 2.4 租戶端呈現

- 租戶「方案與用量」頁的 token 進度條達 80% 轉橘、100% 轉紅並顯示「AI 已暫停」。
- 被擋期間，AI 客服自動回覆改為固定提示，且收件匣顯示「因額度暫停」狀態，方便真人接手。

---

## 3. 升級方案 / 加購 Token 流程（租戶發起 → 平台核准）

### 3.1 資料模型：`PlanChangeRequest`（申請單）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `tenantId` | uuid FK + index | 哪個租戶申請 |
| `type` | string | `upgrade`（升級方案）/ `token_topup`（加購 token） |
| `requestedPlanId` | uuid? | 升級目標方案（type=upgrade） |
| `topupTokens` | int? | 加購 token 數（type=token_topup） |
| `note` | string? | 租戶備註 |
| `status` | string | `pending` / `approved` / `rejected` |
| `requestedBy` | uuid | 租戶 admin agentId |
| `reviewedBy` | uuid? | 平台 superuser |
| `reviewNote` | string? | 平台審核備註 |
| `createdAt` / `reviewedAt` | datetime | |

### 3.2 流程

```
① 租戶站內（方案與用量頁）
   點「升級方案」或「加購 token」→ 選方案/數量 + 備註
   → 建立 PlanChangeRequest(status=pending)
   → 通知平台方（有新申請）
   → 租戶頁顯示「申請處理中」

② 平台後台（新分頁「申請審核」）
   列出所有 pending 申請
   審核 → 核准 / 駁回（填 reviewNote）

   核准 upgrade → 改 Tenant.planId → 失效 entitlement 快取 → 功能即時解鎖
   核准 token_topup → 提高 Tenant.tokenQuotaMonthly → 校準 Redis 計數器上限
                    → 若原本被硬擋 → 立即恢復 AI
   → 通知租戶「申請已核准」

③ 租戶端
   收到通知，方案/額度即時更新；被擋的 AI 恢復
```

### 3.3 API

**租戶側（租戶 token）**
| method | path | 說明 |
|---|---|---|
| POST | `/me/plan/requests` | 建立升級/加購申請 |
| GET | `/me/plan/requests` | 看自己的申請狀態 |

**平台側（superuser）**
| method | path | 說明 |
|---|---|---|
| GET | `/admin/plan-requests?status=pending` | 待審清單 |
| POST | `/admin/plan-requests/:id/approve` | 核准（觸發改方案/加額度 + 快取失效 + 通知 + 稽核） |
| POST | `/admin/plan-requests/:id/reject` | 駁回 |
| PUT | `/admin/tenants/:id/token-quota` | 平台直接調額度（不經申請，主動加/減） |

- 核准/駁回寫 `PlatformAuditLog`。
- 加購生效 = 提高額度 + 校準 Redis + 若被擋則解除。

---

## 4. 與既有規劃的串接

- **entitlement**：升級改 `planId` 走既有 entitlement 快取失效鏈，功能即時解鎖。
- **AiUsage / Redis 計數器**：硬擋讀 Redis、對帳用 AiUsage；兩者都依賴「補 token 記錄」前置工程（見 SPEC-PLATFORM-USAGE §4）——**這是硬擋能成立的前提**。
- **AI key 來源**：BYOK 租戶預設不受平台額度擋（成本不歸平台）。
- **licenseService**：現有 `credits.llmTokens` 額度 mock 改成「Redis 即時計數 + Plan.limits 上限」，`requireCredits` guard 可複用為「AI 呼叫前的額度檢查」。

---

## 5. 待拍板

- **額度重置週期**：自然月（月初 1 號）還是租戶各自的計費週期起始日？（建議先自然月，簡單。）
- **加購 token 是「當月一次性」還是「永久提高月額度」**：`token_topup` 是加到本月、還是調高每月額度？建議申請時可選「本月一次性加購」vs「調整月額度」。
- **BYOK 是否也可被平台設上限**：預設不擋；是否給平台一個「即使 BYOK 也設用量上限」的開關（防濫用）。
- **硬擋粒度**：只擋「AI 自動回覆/生成」，還是連 embedding（KB 搜尋）也擋？建議只擋生成類，embedding 影響搜尋體驗較大，可另計或不擋。
- **金流**：本階段加購/升級是「申請→平台核准」的人工流程，不接金流；日後可加自助付款。
