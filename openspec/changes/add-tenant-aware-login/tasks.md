## 1. Schema 與 Migration

- [x] 1.1 `schema.prisma` 的 `Agent` model：`@@unique([tenantId, email])` → `@@unique([email])`（保留 `@@index([tenantId])`）
- [x] 1.2 部署前檢查：確認 DB 無跨租戶重複 email（`SELECT email, COUNT(*) FROM agents GROUP BY email HAVING COUNT(*) > 1`）——本機驗證無重複
- [x] 1.3 產出正式 migration `20260814000000_agent_email_global_unique`（`DROP INDEX agents_tenantId_email_key; CREATE UNIQUE INDEX agents_email_key ON agents(email)`），以 `migrate deploy` 套用本機

## 2. API — 登入租戶解析

- [x] 2.1 `auth.service.ts login()`：`findUnique({ where: { tenantId_email: { tenantId: DEFAULT_TENANT_ID, email } } })` → `findUnique({ where: { email } })`
- [x] 2.2 select 加 `tenant: { select: { isActive: true } }`；於密碼驗證前檢查 `if (!agent.tenant?.isActive) throw TENANT_DISABLED (403)`（optional chaining 防孤兒列）
- [x] 2.3 回傳值剝除 `passwordHash` 與 `tenant`：`const { passwordHash: _, tenant: __, ...agentData } = agent`
- [x] 2.4 移除 `import { DEFAULT_TENANT_ID }`

## 3. API — Webhook 停用租戶檢查

- [x] 3.1 `webhook.service.ts processWebhookEvent`：channel 查詢加 `include: { tenant: { select: { isActive: true } } }`
- [x] 3.2 加檢查：`if (!channel.tenant?.isActive) { logger.warn(...); return; }`（安靜丟棄；route 已早回 200，故 return 不 throw，避免 error 級 log 噪音）

## 4. API — createAgent 重複檢查

- [x] 4.1 `agent.service.ts createAgent()`：重複 email 檢查 `findFirst({ where: { tenantId, email } })` → `findUnique({ where: { email } })`（全域），維持 409 語意

## 5. Seed 與常數

- [x] 5.1 `seed.ts` agent upsert：`where: { tenantId_email: {...} }` → `where: { email }`（複合鍵已移除，否則 `prisma generate` 後 TS 編譯失敗）
- [x] 5.2 `shared/constants/tenant.ts`：保留 `DEFAULT_TENANT_ID`，更新註解標明僅供離線工具、勿用於線上流程

## 6. 驗測與 Code Review

- [x] 6.1 `prisma generate` + typecheck（api / database 皆退出碼 0）
- [x] 6.2 回歸驗測腳本（真實 DB）：正常登入解析租戶、密碼錯擋、停用租戶擋（TENANT_DISABLED）、email 全域唯一（P2002）、不存在 email 擋、createAgent 跨租戶撞 email 回 409 — 6/6 通過
- [x] 6.3 對抗性 code review：修掉 A1（seed.ts 複合鍵，高）、A4（createAgent 全域檢查，中）、B2/C1（optional chaining + webhook return，低）

## 7. 已知後續

- [x] 7.1 `analytics.scheduler.ts` 改為遍歷 active tenant（新增 `aggregateAllTenants` helper，移除 `HARDCODED_TENANT_ID`；單一租戶失敗不中斷其他）— 順手於本變更一併完成
- [ ] 7.2 租戶自助開通端點（建 tenant + 第一個 admin + 初始化）— 另開變更
- [ ] 7.3 部署到 UAT/prod 前，於目標環境跑 1.2 的重複 email 檢查
