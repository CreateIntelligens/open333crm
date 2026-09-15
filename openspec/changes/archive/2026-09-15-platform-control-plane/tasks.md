## 1. 前置：AI Token 記錄工程（計費/硬擋共同前提）

- [ ] 1.1 改 `ChatProvider.generate()` 介面回傳帶 usage（`{ text, usage:{promptTokens,completionTokens,totalTokens}, model }`），取代現況 `Promise<string>`
- [ ] 1.2 各 provider 解析 usage：Ollama 讀 `prompt_eval_count`/`eval_count`；Gemini 成功路徑讀 `usageMetadata`；embedding 讀 token
- [ ] 1.3 量測 AI 呼叫延遲（呼叫前後夾 `Date.now()`）
- [ ] 1.4 新增 `AiUsage` 表（tenantId/conversationId?/callType/provider/model/prompt+completion+totalTokens/latencyMs/success/errorCode?/keySource/createdAt + `@@index([tenantId,createdAt])`）+ migration
- [ ] 1.5 在 llm.service/ai.service/kb-autoreply 各 AI 呼叫點落地 AiUsage
- [ ] 1.6 補 provider usage 解析與落地的測試

## 2. Entitlement 資料層 + Feature 對應（依賴 rbac change 的權限點 registry）

- [ ] 2.1 新增 `Plan` 全域表（slug@unique/name/features Json/limits Json/isActive，明確註解 platform-global 無 tenantId）+ migration
- [ ] 2.2 `Tenant` 加 `planId` FK(nullable 過渡) / `featureOverrides` Json / `tokenQuotaMonthly` Int? + migration
- [ ] 2.3 建 `FEATURE` registry（feature→權限點對照）+ 啟動驗證（每權限點恰好歸屬一 feature、feature 的 code 都存在於權限 registry）
- [ ] 2.4 實作 entitlement 解析（plan.features ∪ grant \ revoke ∪ core；core 恆開）+ 快取 `entitlement:tenant:{id}`（TTL≤10min）
- [ ] 2.5 把 `licenseService` 從 mock 單例改成依 tenant 查 DB plan；`requireFeature` guard 呼叫端不動
- [ ] 2.6 seed 預設四方案（輕量版/標準版/專業版/企業版）與其 features + limits（maxAgents/maxTags/monthlyTokens，企業版 null=無上限）；`Tenant` 加 `limitOverrides` Json
- [ ] 2.7 【plan-limits】實作有效上限解析 `limitOverrides[key] ?? plan.limits[key]`（null=無上限）+ 平台後台改 Plan.limits/Tenant.limitOverrides API
- [ ] 2.8 【plan-limits】數量上限硬擋：createAgent 前檢查 maxAgents(count active agent)、createTag 前檢查 maxTags；達上限回 `PLAN_LIMIT_EXCEEDED`(含 key/當前/上限)；在權限+entitlement 檢查後執行；補測試

## 3. 平台認證 + 控制平面骨架

- [ ] 3.1 新增 `PlatformUser` 全域表 + 平台登入流程（獨立 secret / 專屬 JWT，簽發與租戶分離）
- [ ] 3.2 `auth.plugin.ts` 加 `authenticatePlatformSuperuser` decorator（第四條認證路徑）+ `requirePlatformSuperuser()` guard
- [ ] 3.3 新增 `PlatformAuditLog` 全域表（actorId/action/targetTenantId/payload/createdAt）+ 寫入 helper
- [ ] 3.4 新增 `apps/api/src/modules/platform/` + `index.ts` 註冊 `/api/v1/platform`
- [ ] 3.5 平台 API：plans CRUD、tenants 列表、tenant entitlement 讀寫（plan/overrides）；變更後失效 entitlement 快取 + 寫稽核
- [ ] 3.6 租戶開通流程 `POST /platform/tenants`（建 tenant + 三 system role + 預設 RolePermission + 指派 plan + 稽核）

## 4. 有效權限交集（平台×租戶接點）

- [ ] 4.1 權限判斷改為 `有效權限 = (角色權限 ∪ implies) ∩ entitlement 天花板`（後端強制，繞過前端仍 403）
- [ ] 4.2 `GET /me/permissions` 回傳交集後的有效權限
- [ ] 4.3 租戶權限設定頁：方案未含 feature 呈現 🔒 鎖定升級態（disabled）
- [ ] 4.4 補交集、快取失效、降級不刪資料、升回恢復的測試

## 5. 用量統計 + 平台儀表板

- [ ] 5.1 `DailyStat` 加 statType `ai_usage` / `channel_cost`，由 aggregator 每日彙總（複用 aggregateAllTenants）
- [ ] 5.2 補 `ChannelUsage` 寫入（broadcast 送訊等真實路徑）
- [ ] 5.3 平台 API：跨租戶總覽（排行/總成本/異常）、單租戶鑽取（用量/計費/健康度三類）、CSV 匯出
- [ ] 5.4 前端 `apps/web/src/app/admin/`（平台後台，獨立認證/layout）：設定方案 + 用量統計（圖表化：趨勢折線/面積、額度量表、佔比甜甜圈、健康度紅綠燈）
- [ ] 5.5 BYOK 租戶不計平台金額（依 AiUsage.keySource 區分）

## 6. AI Key per-tenant + BYOK

- [ ] 6.1 抽出共用 `crypto.ts`（encrypt/decrypt，channel 改 import）+ `CREDENTIAL_ENCRYPTION_KEY` 補進 env schema
- [ ] 6.2 `TenantSettings` 加 `aiKeysEncrypted`(加密 JSON 多 provider) / `aiKeySource` + migration
- [ ] 6.3 provider 收 `opts.apiKey`；fallback 收斂在 provider 一行（租戶→平台代設→env）
- [ ] 6.4 chat-settings 解密取 key 透傳；health 測連線用租戶 key
- [ ] 6.5 租戶側設定/清除 key API（回應遮罩）；平台後台代管 key（寫稽核）
- [ ] 6.6 存入前驗證 key 有效性（比照 channel verify）

## 7. Token 額度硬擋 + 升級/加購流程

- [ ] 7.1 Redis 即時計數器 `usage:tokens:{tenant}:{yyyy-mm}`（月初換 key 重置 + TTL 兜底）
- [ ] 7.2 AI 呼叫共用入口前置檢查：達額度即硬擋（回固定訊息、不呼叫 LLM、記被擋事件）；呼叫後 INCRBY。**硬擋涵蓋生成類 + embedding（KB 搜尋）**；真人人工回覆不受影響
- [ ] 7.3 80% 預警 / 100% 硬擋通知（走既有 notification，明示「AI 與知識庫搜尋已暫停」）；BYOK 預設不擋但提供 per-tenant `enforceQuotaOnByok` 開關
- [ ] 7.4 每日用 AiUsage 加總校準 Redis 計數器
- [ ] 7.5 `PlanChangeRequest` 表（含 `topupMode`: one_time_month / raise_monthly）+ 租戶發起 API（`POST /me/plan/requests`）+ 平台審核 API（approve/reject）
- [ ] 7.6 核准 upgrade → 改 planId + 失效 entitlement 快取（功能解鎖）；核准 topup → 依 topupMode（一次性只加本月 / raise_monthly 永久調高 tokenQuotaMonthly）提高額度 + 校準 Redis（解除硬擋）+ 通知 + 稽核

## 8. 租戶端「方案與用量」頁

- [ ] 8.1 租戶側 API：`GET /me/plan`（方案+功能含鎖定）、`GET /me/usage`（本月用量摘要）、`GET/PUT /me/ai-keys`
- [ ] 8.2 前端 dashboard 加「方案與用量」頁：唯讀方案/功能(🔒升級引導)/用量(額度環)
- [ ] 8.3 AI key 來源自選（平台提供/自備 BYOK）；平台提供顯示金額、BYOK 只顯示用量
- [ ] 8.4 超量呈現：額度環滿轉紅 + AI 暫停橫幅；發起升級/加購申請 + 申請中狀態
- [ ] 8.5 新增權限點 `billing.view`（歸 core）控管此頁存取

## 9. 收尾

- [ ] 9.1 部署前 pre-flight：全域表存在、三方案齊、feature↔權限點對應無缺、平台認證 secret 已設
- [ ] 9.2 部署網路隔離：nginx conf 對 `location /admin` 與 `location /api/v1/platform` 加 IP allowlist（`allow <平台網段>; deny all;`）——同域名不新增 server/憑證；縱深防禦搭配 requirePlatformSuperuser（2FA 第二階段）
- [ ] 9.3 更新 CLAUDE.md：平台層跨租戶授權例外的標示規範、feature registry SOP
- [ ] 9.4 分階段灰度上線（依 design Migration Plan 六階段）
