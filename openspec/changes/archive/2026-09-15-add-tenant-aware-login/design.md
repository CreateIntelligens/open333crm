# Design：Tenant-aware Login

## 背景

系統的資料層與 request 鏈路早已 tenant-aware（JWT 帶 `tenantId`、query 帶 tenant 隔離、webhook 靠 channel 解租戶），唯一寫死的是登入。因此本變更不是「把系統改成多租戶」，而是「解除登入這一個單點的寫死 + 補停用租戶檢查」。範圍刻意小而聚焦。

## 關鍵決策

### 決策 1：租戶解析方式 → email 全域唯一

多租戶登入要回答「這個 email 屬於哪個租戶」，有三種做法：

| 方案 | 做法 | 取捨 |
|---|---|---|
| **A. email 全域唯一（採用）** | `@@unique([email])`，登入只需 email+password，agent.tenantId 即答案 | 最簡單、登入 UX 最乾淨；大多數 B2B SaaS 做法（Slack/Notion/Linear）。代價：一個 email 不能跨租戶重用 |
| B. 子網域 / 租戶代碼 | 每租戶一個子網域或登入時選公司 | email 可跨租戶重複，但登入流程複雜、前端要改 |
| C. email 撞多筆時選租戶 | email 可重複，撞多筆時讓使用者選 | 彈性最高但登入 UX 最複雜 |

**選 A**：POC 階段資料量小、目標客層為中小企業，全域唯一最省事且符合主流。此決策在資料量小時定案最省事——之後帳號一多再改會痛（需資料遷移）。

### 決策 2：停用租戶在登入的處理位置 → 密碼驗證之前

`tenant.isActive` 檢查放在 bcrypt 密碼驗證**之前**。權衡：
- 放前面（採用）：省一次 bcrypt 運算；但會在密碼驗證前就回 `TENANT_DISABLED`，理論上洩漏「此 email 存在且租戶被停用」。
- 這與既有的 `ACCOUNT_DISABLED`（帳號停用，本來就在密碼驗證前）同性質，未新增可觀測的 enumeration 差異，故沿用既有慣例、擺前面。

### 決策 3：webhook 停用租戶 → 安靜 return，不 throw

webhook route（`webhook.routes.ts`）對 inbound 一律**先 `reply.status(200)` 再 fire-and-forget** 呼叫 `processWebhookEvent`。因此：
- 停用租戶是**預期內、非錯誤**的情況。用 `throw` 會被 route 的 `.catch` 吞掉並記成 **error 級**堆疊 → log 噪音、看起來像故障。
- 平台端（LINE/Meta）已收到 200，`throw` 或 `return` 都不會觸發重試或「連續失敗自動停用 webhook」。
- 故採 `logger.warn(...)` + `return`（安靜丟棄），語意最貼切。

### 決策 4：孤兒列防禦 → optional chaining

`Agent.tenantId` / `Channel.tenantId` 皆 non-null 且有 relation（預設 `onDelete: Restrict`），正常情況 `agent.tenant` / `channel.tenant` 不會是 null。但為防「繞過 Prisma 手動刪 tenant」「未來改 onDelete」等情況導致 `.isActive` 讀取 crash（500），一律用 `?.` 並把「租戶缺失」視為停用擋下。

## 不在範圍

- 租戶自助開通 / signup（建 tenant + 第一個 admin + 初始化預設資料）
- `analytics.scheduler.ts` 等寫死租戶的離線/排程流程改 per-tenant
- 前端變更（本變更前端零改動）

## 部署風險

`@@unique([email])` 的 migration 在目標環境**若已有跨租戶重複 email 會失敗**（DROP 舊索引後 CREATE 新 unique 索引時撞重複值）。UAT/prod 部署前必須先跑重複檢查。POC 本機僅單一租戶、無重複，已驗證安全。
