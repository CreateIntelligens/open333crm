# 25. 商用化就緒度技術評估 — 給 CTO / RD 的決策文件

> **文件目的**：這不是「缺什麼清單」，而是「要決定什麼」的清單。每個缺口都轉成一個需要 CTO 拍板的**技術決策點**，附現況證據、選項、取捨與建議，供 RD/CTO 會議逐項討論定案。
>
> **範圍**：涵蓋「可商用模組化 SaaS 系統上線販售」的全部就緒度缺口（Blocker / P1 / P2），金流實際扣款串接暫緩但資料模型要預留。
>
> **日期**：2026-08-31　**狀態**：待 CTO 會議定案

---

## 一、TL;DR — 需要 CTO 拍板的 12 個決策

| # | 決策點 | 等級 | 建議方向 | 影響 |
|---|--------|------|----------|------|
| D1 | 金流資料模型與 provider 抽象怎麼設計 | Blocker | Subscription/Invoice + PaymentProvider 介面，先只實作 MANUAL | 決定未來接金流商的改動成本 |
| D2 | 合約到期後的預設處置（停用 vs 唯讀 vs 寬限期） | Blocker | 唯讀 + 寬限期，複用試用到期 scheduler | 誤傷正常客戶的風險 |
| D3 | Observability 選型（Sentry SaaS vs self-host vs 其他） | Blocker | Sentry（先 SaaS 免費額度）+ Slack 告警 | 營運可見度、PII 合規 |
| D4 | 環境分層策略與「自動擴增」的定義 | Blocker | 先物理分離三環境；自動 provisioning 分階段 | 工程量從 3 天到 3 週的分歧點 |
| D5 | RLS 收尾與 FORCE RLS 是否全表套用 | Blocker | 全表 FORCE + 上線前實測連線身分 | 租戶隔離是否真的生效 |
| D6 | Per-tenant rate limiting 要不要現在做 | P1 | 上線前補一層 per-tenant quota | 單租戶拖垮全系統 |
| D7 | 備份 / DR 策略（RPO/RTO 目標） | P1 | pg_dump 每日 + PITR 評估 | 資料遺失的商業風險 |
| D8 | 成員邀請機制（email 邀請 vs 維持代設密碼） | P1 | 補 email 邀請自助設密 | 資安 + 交付體驗 |
| D9 | CI 品質閘（lint gate 恢復 + 單元測試 + 覆蓋率） | P1 | 恢復 lint、補測試 job | 交付品質、回歸風險 |
| D10 | 對外 API 文件（OpenAPI 產生機制） | P2 | @fastify/swagger 自動產生 | 開發者體驗、合作夥伴串接 |
| D11 | White-label / custom domain 何時做 | P2 | 上線後依大客戶需求排 | 差異化、企業客戶門檻 |
| D12 | 企業 SSO（SAML/OIDC）何時做 | P2 | 有企業客戶需求再做 | 企業客戶採購門檻 |

---

## 二、現況總覽 — 已完成的地基

先釐清「不是問題」的部分，避免會議上重複討論。以下均已完成並有程式碼證據：

- **多租戶隔離雙防線**：應用層 tenantId 隔離 + Postgres RLS（`scripts/check-tenant-scoping.mjs`、CI `rls-isolation` job 真跑 PG 驗證）
- **平台控制平面**：租戶管理、方案/額度硬擋、AI token 用量即時控管、試用管理（`apps/api/src/modules/platform/`、`apps/web/src/app/admin/`）
- **模組化基礎**：`packages/core/src/rbac/features.ts` 定義 **8 個 feature module**（7 可售 + core 恆開），slug 化且與權限系統打通 — **模組化銷售在架構上可行**
- **自助試用申請**（含 email 驗證）、**RBAC 49 權限點**、**雙層審計日誌**、**GDPR 匯出/刪除**、**用量超標告警**
- **對外 Webhook（outbound）**：`WebhookSubscription` + `WebhookDelivery`，HMAC 簽名、重試，租戶可自助訂閱系統事件 — **已上線齊全**
- **正式 Prisma migration 流程 + CI/CD 自動部署**（`.github/workflows/deploy.yml`）

**關鍵結論**：地基扎實。缺的不是核心功能，而是**「商業化中介層」（訂閱/計費/合約生命週期）與「營運級基礎工程」（環境分層/可觀測性/備份/限流）** — 這才是 BD 排不出銷售時程的真正原因，不是 RD 進度落後。

---

## 三、逐項決策 — Blocker（上線必要）

### D1 — 金流資料模型與 PaymentProvider 抽象

**現況**：`Plan.priceMonthly` 明確標註「顯示用、不接金流」；`PlanChangeRequest` 已支援「申請升級/加購 → 平台審核」，但**沒有 Subscription（訂閱狀態）與 Invoice（帳單留痕）model**。系統目前無法回答「這租戶付到何時、上月收了多少」。

**要決定的**：資料模型形狀 + provider 抽象邊界。

| 選項 | 說明 | 取捨 |
|------|------|------|
| **A（建議）** | 新增 `Subscription` + `Invoice` model；`PaymentProvider` 介面（`charge/refund/verifyWebhook`）本次只實作 `ManualPaymentProvider`；預留 `POST /api/webhooks/billing/:provider`（回 501） | 一次把資料模型做對，未來接 Stripe/綠界只加 adapter，不動 schema 與呼叫端。前期多花 1-2 天設計 |
| B | 只加 Invoice 記帳，不做 Subscription 狀態機 | 快，但合約生命週期（D2）沒有狀態可依附，等於半套 |
| C | 直接串真實金流 | 金流商資格未下來，無法進行；且卡住上線 |

**建議**：A。`Tenant.planId` 保留為「目前生效方案」查詢捷徑，`Subscription` 承載狀態機與歷程，兩者並存職責分離。模組化定價**複用既有 `Plan.features`**（8 個 module slug），不重造模組系統。

**風險**：人工開通若無雙重確認，易發生「業務忘記登記收款 → 誤停用」。Invoice 狀態變更須寫 `PlatformAuditLog`。

---

### D2 — 合約到期後的預設處置

**現況**：`Tenant.contractStartDate/contractEndDate` 存在，但 schema 註解明確寫「**MUST NOT 觸發任何自動生命週期行為**」（刻意的先前決策）。到期後不提醒、不停用、不轉唯讀。

**要決定的**：到期後系統該做什麼、複用哪套機制。

| 選項 | 說明 | 取捨 |
|------|------|------|
| **A（建議）** | 到期轉**唯讀** + 可設**寬限期**；複用既有試用到期 scheduler（`trialEndsAt` + `trialRemindersSent` 冪等閘模式，見 `add-trial-data-purge`） | 不誤傷已匯款但未登記的客戶；不另造機制 |
| B | 到期直接停用（斷線） | 簡單但高風險，客戶體驗差 |
| C | 只提醒不處置 | 形同沒做，靠人工盯合約表 |

**建議**：A。續約完成（Invoice 標記已收款）時，用**同一個事件**觸發解除限制 — D1 與 D2 必須共用事件鏈，不可各做一套 polling，否則兩套邏輯會打架。

**依賴**：D1 的 Subscription/Invoice 必須先落地。

---

### D3 — Observability 選型

**現況**：只有本地 pino/winston 文字 log，三個 process（api/web/workers）各寫各的，**無集中彙整、無即時告警**。健康檢查只有 `GET /health`（`index.ts:122`，固定回 ok 的 liveness，**未檢查 DB/Redis，無 readiness 端點**）。

**要決定的**：錯誤追蹤工具、監控範圍、告警通道、readiness 探測。

| 決策子項 | 選項 | 建議 |
|----------|------|------|
| 錯誤追蹤 | Sentry SaaS / Sentry self-host / Datadog / 無 | **Sentry**（先用 SaaS 免費額度，Fastify/Next/BullMQ 都有現成 SDK） |
| 監控指標 | Grafana 全套 / 現有 Docker + node_exporter / 雲商內建 | **先 node_exporter 求「看得到」**，不一次上 Grafana |
| 告警 | PagerDuty / Slack webhook / Email | **Slack webhook**（複用既有 webhook 基礎設施，團隊規模還不需 PagerDuty） |
| readiness | 補 `/ready` 檢查 DB+Redis / 不補 | **補**（部署健康判斷、未來 K8s 都需要） |

**導入順序**：API process（風險最高）→ workers（背景任務失敗目前完全無感知）→ 前端。

**風險 / 合規**：Sentry 預設收集完整 request payload，含租戶 PII。**必須設 `beforeSend` 過濾器**排除敏感欄位，否則違反已建立的 GDPR 標準。這點需 CTO 明確要求納入驗收條件。

---

### D4 — 環境分層策略 + 「自動擴增」的定義

**現況**：**唯一環境是 UAT**。`deploy.yml` 在 push main 時觸發 self-hosted runner，對單一 EC2 執行 rsync + docker compose。無 staging/production 分離，原維運負責人已離職、無正式接手人。

**要決定的（兩個獨立問題）**：

**問題 A — 環境分層**：

| 選項 | 說明 | 取捨 |
|------|------|------|
| **A（建議）** | SIT/UAT/PROD 物理隔離，各自 docker compose + env；CI/CD 依 branch 對應環境。**沿用現有 rsync + compose，不換技術棧** | 上線必要的基本紀律，工程量可控 |
| B | 只切 PROD，SIT/UAT 沿用現況 | 最快但仍留缺口 |

**問題 B — 「新租戶自動擴增」的定義（⚠️ 會議必須先釐清）**：這個詞有三種解讀，工程量差距達 3 週以上：

| 解讀 | 實際意涵 | 工程量 | 現況 |
|------|----------|--------|------|
| ① 新租戶自動建資料 | 共用系統裡自動建一筆租戶 + 預設角色/設定 | **小**（接近現有 provisioning） | 平台控制平面已有大半 |
| ② 流量自動水平擴展 | 負載升高時自動加開 API/worker 實例 | 中 | **水平擴展三卡點已在 PR #157 處理**（scheduler 鎖/socket adapter/廣播搶佔） |
| ③ 大客戶獨立部署 | 客製客戶自動開獨立環境 | **大**（需 IaC + K8s/ECS） | 完全未做 |

**建議**：問題 A 選 A（上線必要）。問題 B **請 CTO/副總先確認指的是哪一種** — 現行架構是「所有租戶共用一套部署靠 tenantId + RLS 隔離」，多數情況「自動擴增」其實是①（工程量小）。真正的全自動 IaC provisioning（③）建議先用「一鍵腳本」半自動化過渡，等客戶量驗證後再投資，避免過早優化。

---

### D5 — RLS 收尾與 FORCE RLS 全表套用

**現況**：RLS 地基、核心鏈路、全 route 接線已完成並實測（跨租戶隔離、WITH CHECK、fail-closed 全過），CI 有 `rls-isolation` job 真跑 PG。機制與陷阱已寫入 skill `postgres-rls-tenant-isolation`。分支 `feat/postgres-rls` 尚未 push。

**要決定的**：收尾範圍 + 一項必須上線前實測的驗證。

**剩餘收尾項目**：
- 少數子表的 subquery policy 補齊（多數表已用直接 tenantId 比對）
- 約 40 張表套用 `FORCE ROW LEVEL SECURITY`（目前 policy 已建但未強制，owner/superuser 身分理論上仍可繞過）
- OAuth 相關路由尚未接上 `app_tenant` 連線身分

**⚠️ 上線前第一步（本項唯一真正決定風險高低的問題）**：內部記錄對「UAT 是否已真正切換到 `app_tenant`（非 BYPASSRLS 身分）連線」**有矛盾說法**。若 UAT 仍用有 BYPASSRLS 權限的身分連線，前面所有「通過測試」只證明「規則寫對了」，不能證明「規則真的在擋」。**必須接一條真實連線實跑跨租戶查詢確認會被擋下**，不能只看 CI 結果。

**建議**：全表 FORCE + 上線前實測連線身分列為驗收硬條件。

---

## 四、逐項決策 — P1（上線後儘快補，部分建議上線前）

### D6 — Per-tenant rate limiting

**現況**：`@fastify/rate-limit@^10` 已裝，但 `global: false`，**只掛在敏感端點**（登入 10/min、trial signup、platform 登入、chatbox），`keyGenerator` 一律用 `request.ip`（非 tenantId）。**已登入的租戶 API（conversations/contacts/cases/agents 等）完全沒有限流，無 per-tenant quota。**

**決策**：是否上線前補一層 per-tenant 限流？
- **建議**：上線前至少補「per-tenant 全域 API quota」的粗粒度限流，防止單一租戶（或其被盜用的 API key）拖垮全系統。細粒度 per-route 可上線後補。

---

### D7 — 備份 / 災難復原

**現況**：**完全沒有**。`scripts/` 無 backup/dump/restore，`deploy.yml` 無備份步驟，唯一相關的 `sync-uat-db.sh` 是開發用單向拉取，非 DR。

**決策**：RPO/RTO 目標訂多少？備份方案？
- **建議**：先訂保守目標（如 RPO 24h / RTO 4h），實作 **pg_dump 每日排程 + 異地保存**；評估雲商 PITR（Point-in-Time Recovery）作為第二階段。**這是收費營運前不可缺的商業風險控管** — 沒有備份等於資料遺失時對客戶無法交代。

---

### D8 — 成員邀請機制

**現況**：**無 invite 流程**。建成員走 `POST /api/v1/agents`，由建立者在 request body **直接帶明文密碼**後端 hash 存入（`agent.service.ts:173,190`）。有 `resetAgentPassword` 供代重設。

**決策**：補 email 邀請自助設密，還是維持代設密碼？
- **建議**：補 email 邀請流程（發邀請信 → 受邀者自助設密）。現況「admin 知道每個成員初始密碼」有資安疑慮，且不符 SaaS 交付體驗預期。工程量小，建議上線後儘快補。

---

### D9 — CI 品質閘

**現況**：`ci.yml` 兩個 job。build job 的 **lint 被 skip**（`echo "skip for now"` + `continue-on-error`）；**無單元測試 job、無覆蓋率報告**；typecheck 靠 `pnpm build`（tsc）間接涵蓋。有 tenant scoping 檢查 + RLS 整合測試（已是亮點）。

**決策**：恢復 lint gate + 補測試的優先度。
- **建議**：①先恢復 lint gate（技術債會隨上線後客戶量放大）②補關鍵路徑單元測試（billing/合約生命週期/RLS 這些新增的商業邏輯尤其需要）③覆蓋率報告可作為長期指標，非上線硬條件。

**補充建議（根因盲點）**：memory 記錄過 RBAC 曾重複發生「加了權限點但路由沒掛 guard」的漏洞，`validateRouteCodes` 只驗碼存在、不驗路由有掛 guard。建議補一條 **registry→route 的反向 CI 檢查**，這類漏洞防範成本低但影響大。

---

## 五、逐項決策 — P2（可上線後排程）

### D10 — 對外 API 文件（OpenAPI）

**現況**：**完全沒有** swagger/openapi 機制（`@fastify/swagger` 未裝）。僅 partner-ingest 有一份手寫 `partner-ingest.openapi.yaml`。

**決策**：是否導入 `@fastify/swagger` 自動產生？
- **建議**：導入。租戶/合作夥伴要串接（尤其已有 outbound webhook 與 partner API），沒有 API 文件是採購與整合的摩擦點。優先度 P2，但成本低。

---

### D11 — White-label / Custom Domain

**現況**：**完全沒有實作**。`docs/11_ROADMAP.md:113` 有未勾選待辦「白標支援」；`docs/22_FAN_PORTAL.md` 的 `customDomain: true` 只是方案設定 JSON 範例欄位。

**決策**：何時做、做到什麼程度？
- **建議**：上線後依實際大客戶需求排。custom domain（客戶用自己的網域）與 branding（換 logo/配色）是兩件事，可分開評估。企業客戶常以此為採購門檻，但不該卡住首波上線。

---

### D12 — 企業 SSO（SAML / OIDC）

**現況**：**完全沒有**。認證僅密碼 + Passkey/WebAuthn（後者是個人無密碼登入/2FA，非企業 IdP SSO）。

**決策**：何時做？
- **建議**：有明確企業客戶需求再做。中小客戶不需要，大型企業客戶（要求接自家 AD/Okta）才需要。屬 P2，需求驅動。

---

## 六、模組化銷售可行性結論

**架構上可行，但需補一層商業對應。**

- **已具備**：`packages/core/src/rbac/features.ts` 定義 8 個 feature module（inbox/channels/automation/marketing/analytics/knowledge/portal + core 恆開），slug 化並與 49 權限點打通。`add-granular-plan-entitlement` 已讓平台能依方案限制可用模組/渠道/權限點。
- **目前模式**：「同一套後端全部部署，用權限交集在執行期隱藏功能」（entitlement gate），**不是**「客戶只買 Inbox+Contacts 就不部署 Marketing 程式碼」。
- **要補的一層**：D1 的「模組 × 價格」商業對應 + 金流串接。有了 Subscription/Invoice 疊在既有 feature module 上，就能表達「這個訂閱包含哪些模組、各值多少錢」，實現分模組計費 — **這層目前完全空白，是模組化銷售的最後一哩**。

**結論**：不需要重造模組系統，只需在既有 entitlement 之上加 billing 層（D1）。「真正的分模組部署」（不部署未購買模組的程式碼）在容器共用架構下並非必要，執行期 gate 已足夠達成「客戶只看到買的模組」的商業效果。

---

## 七、建議的會議決策順序

1. **先釐清 D4 問題 B**（自動擴增定義）— 這是唯一會讓整體工程量從數天暴增到數週的分歧點，不釐清無法估時程。
2. **確認 D5 的 UAT 連線身分實測**列為上線硬條件 — 這是租戶隔離是否真生效的關鍵。
3. **D1 → D2 綁定拍板** — 兩者共用事件鏈，必須一起決定。
4. **D3 選型 + PII 過濾納入驗收** — Observability 是營運可見度的前提。
5. **D6/D7/D8/D9 定上線前/後** — 哪些 P1 提前到上線前（建議 D6 rate limiting、D7 備份至少 pg_dump）。
6. **D10-D12 排入上線後 roadmap** — 需求驅動，不卡首波。

---

*本文件為技術決策評估，供 CTO/RD 會議定案使用。現況陳述均附程式碼證據路徑；時程估算另見「五項工程整合排程簡報」。定案後各決策點可轉為 OpenSpec change 進入實作。*
