## Context

系統現有稽核只覆蓋平台層：`PlatformAuditLog`（`packages/database/prisma/schema.prisma` :1818）+ 寫入 helper `writePlatformAudit()`（`apps/api/src/modules/platform/platform-audit.service.ts`），記錄平台 superuser 對租戶的操作（開通/停用/改 plan），供平台方查。租戶**內部**的敏感操作沒有任何留痕。

多租戶隔離的鐵律是每個 query 的 `where` 都帶 `tenantId`（見 CLAUDE.md 與 `scripts/check-tenant-scoping.mjs`）；RBAC 是 49 權限點的 registry（`packages/core/src/rbac/permissions.ts`），`resource.action` 命名。非同步重工作走 BullMQ worker（`apps/workers`，Path B），大檔存 MinIO（`packages/core/src/storage/minio-provider.ts`）。

聯絡人（`Contact` :432）關聯眾多：`ChannelIdentity` / `ContactAttribute` / `ContactRelation`（皆 `onDelete: Cascade`）、`Conversation`（:590，含 `Message` cascade）、`Case`（:683）、`LongTermMemory`、`IdentityMap`、`PortalSubmission`、`PointTransaction`。刪除策略必須決定這些關聯怎麼處理。

同期另有 `add-postgres-rls` change（目前僅空殼 `.openspec.yaml`）在做 PostgreSQL RLS，本 change 新增的表都要納入其 policy。既有 `add-trial-data-purge` change 已確立「軟刪可復原、硬刪另開 change」的取捨慣例，可借鑑其欄位語意設計（用時間戳而非 boolean）。

## Goals / Non-Goals

**Goals:**
- 租戶內敏感操作可被租戶 ADMIN 事後查證（誰/何時/對哪筆/做了什麼）。
- 租戶可自助把自己的業務資料匯出帶走（GDPR Art.20），非同步不阻塞。
- 租戶 ADMIN 可對特定聯絡人執行合規的個資移除（GDPR Art.17），預設匿名化、可選硬刪。
- 三個新表全數 `tenantId` scoped 並可被 RLS 納管。

**Non-Goals:**
- 不做「整租戶」層級的匯出/刪除（那是平台方職責，走現有 trial-purge / 未來硬刪 change）。
- 不做稽核 log 的竄改防護（hash chain / WORM 儲存）——本 change 先做「有記錄可查」，防竄改留後續。
- 不做刪除的自動排程（如「聯絡人 inactive N 天自動抹除」）——本 change 只做「ADMIN 手動發起」。
- 不做前端頁面完整實作（後端能力優先；前端於 tasks 標後續）。
- 不做匯出的增量/差異匯出——只做「當下全量快照」。

## Decisions

### 決策 1：TenantAuditLog 獨立 model，比照 PlatformAuditLog 但 tenantId scoped

新 model（不複用 `PlatformAuditLog`，因語意/讀者/隔離邊界完全不同）：

```prisma
model TenantAuditLog {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String   @db.Uuid
  actorId    String?  @db.Uuid   // 動作的 Agent；null = 系統/排程動作
  action     String              // e.g. contact.delete | settings.update | role.permission.update | channel.create
  targetType String?             // contact | setting | role | channel | export | erasure ...
  targetId   String?
  payload    Json?               // 變更摘要（before/after 或關鍵欄位），刻意不存整包敏感資料
  ip         String?             // 來源 IP（選配）
  createdAt  DateTime @default(now())

  tenant Tenant  @relation(fields: [tenantId], references: [id])
  actor  Agent?  @relation(fields: [actorId], references: [id])

  @@index([tenantId, createdAt])
  @@index([tenantId, action, createdAt])
  @@index([tenantId, actorId, createdAt])
  @@map("tenant_audit_logs")
}
```

寫入 helper `writeTenantAudit(prisma, { tenantId, actorId, action, targetType, targetId, payload, ip })`，比照 `writePlatformAudit` 的最小介面，放 `apps/api/src/modules/tenant-audit/tenant-audit.service.ts`。

**攔截方式：service/route 內顯式呼叫，不用全域 Fastify hook。** 理由：（a）稽核要記的是「語意動作」（"刪聯絡人"），不是 HTTP 層的 method+path，全域 hook 拿不到語意與 before/after payload；（b）敏感操作是有限清單（下方），逐點插入可控且 payload 精準；（c）全域 hook 會產生大量無意義雜訊（每個 GET 都記）。取捨：顯式呼叫需開發者記得加——用 code review + 清單化緩解。

**要記的操作清單（v1）**：
- 系統設定：`settings.update`（office-hours/tracking/embedding/chat/api-keys/cli-sessions）
- 人員與權限：`agent.create` / `agent.delete` / `agent.role.assign` / `role.permission.update` / `agent.password.reset`
- 聯絡人：`contact.delete`、`contact.merge`（合併會抹掉一邊）
- 案件：`case.delete`
- 渠道：`channel.create` / `channel.delete`
- 行銷：`marketing.list.export`（匯出名單＝個資外流點）
- 本 change 自身：`data.export.request` / `data.erasure.request` / `data.erasure.complete`

寫入失敗策略：稽核寫入包在 try/catch，**失敗只記 log 不阻斷主操作**（稽核是側效，不能因稽核 DB 故障讓刪聯絡人失敗）。但若要「合規強一致」可改為同 transaction——v1 選非阻斷（可用性優先），此取捨寫入 spec。

### 決策 2：權限點新增 audit.view / data.export / data.erase（feature: core）

加入 `PERMISSIONS` registry：

```ts
{ code: 'audit.view',   group: '稽核與合規', feature: 'core', label: '檢視操作稽核', description: '查詢租戶操作稽核日誌' },
{ code: 'data.export',  group: '稽核與合規', feature: 'core', label: '匯出租戶資料', description: '發起資料可攜匯出並下載（GDPR Art.20）' },
{ code: 'data.erase',   group: '稽核與合規', feature: 'core', label: '刪除個資',     description: '對聯絡人執行匿名化或硬刪（GDPR Art.17）', dependsOn: ['contact.view'] },
```

三者皆屬高敏感，預設只給 ADMIN。`data.erase` 依賴 `contact.view`（要先能看才能刪，符合現有 dependsOn 慣例）。不加 `adminLock`（讓租戶能授權給合規專員角色），但 default role 種子只給 ADMIN。

替代方案：複用既有 `settings.manage` / `analytics.export`。否決——合規操作風險等級遠高於一般設定，混在一起無法單獨授權與稽核，且語意不清。

### 決策 3：資料匯出——請求表 + worker 產 zip + 一次性下載

新 model `DataExportRequest`：

```prisma
model DataExportRequest {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId    String   @db.Uuid
  requestedBy String   @db.Uuid          // Agent
  status      String   @default("pending") // pending | processing | completed | failed | expired
  scope       Json                        // 要匯出的資源清單（v1 固定全量，保留擴充）
  fileKey     String?                      // MinIO object key
  fileSizeBytes BigInt?
  downloadCount Int    @default(0)
  error       String?
  expiresAt   DateTime?                    // 檔案保留到期時間
  completedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant   Tenant @relation(fields: [tenantId], references: [id])
  requester Agent @relation(fields: [requestedBy], references: [id])

  @@index([tenantId, status, createdAt])
  @@map("data_export_requests")
}
```

**流程（Path B）**：`POST /tenant/data-export`（權限 `data.export`）→ 建 `DataExportRequest(pending)` + 寫稽核 `data.export.request` → `eventBus.publish` 橋接 BullMQ → `apps/workers` export consumer：逐表撈該 `tenantId` 的資料（Contact/Conversation/Message/Case + 附屬）→ 產 JSON（結構完整）+ CSV（扁平主表，給人看）→ 打包 zip → 上傳 MinIO（`export/{tenantId}/{requestId}.zip`）→ 更新 status=completed、fileKey、expiresAt（now + 保留天數）→ Redis pub/sub 發站內通知給 requester。

**下載**：`GET /tenant/data-export/:id/download`（權限 `data.export` + 必須同租戶 + status=completed + 未過期）→ 產 MinIO presigned URL（短時效）或串流回傳，`downloadCount++`。

**保留期**：預設 7 天（設定值），到期由既有的清理排程（或新增 worker cron）把 status→expired 並刪 MinIO 物件。理由：匯出檔含全租戶 PII，不能無限期留在物件儲存。

**格式決策**：zip(JSON + CSV)。JSON 保留關聯完整性（機器可讀、可再匯入）；CSV 給非技術使用者用 Excel 開。單一 zip 一次交付。否決純 CSV（丟關聯）、純 JSON（使用者不會看）。

大資料量走 worker（Path B）而非 API 同步：避免長 HTTP 阻塞、避免 API 記憶體爆（大租戶可能數十萬訊息）。

### 決策 4：資料刪除——聯絡人粒度，預設匿名化、可選硬刪

新 model `DataErasureRequest`：

```prisma
model DataErasureRequest {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId    String   @db.Uuid
  requestedBy String   @db.Uuid
  contactId   String   @db.Uuid          // 目標聯絡人
  mode        String                      // anonymize | hard_delete
  status      String   @default("pending")// pending | processing | completed | failed
  reason      String?                      // 資料主體要求原因（合規記錄）
  affected    Json?                        // 完成後記錄影響的資料量（對話/案件/訊息數）
  error       String?
  completedAt DateTime?
  createdAt   DateTime @default(now())

  tenant   Tenant  @relation(fields: [tenantId], references: [id])
  requester Agent  @relation(fields: [requestedBy], references: [id])

  @@index([tenantId, status, createdAt])
  @@index([tenantId, contactId])
  @@map("data_erasure_requests")
}
```

**兩種模式**：

- **anonymize（預設）**：抹除 `Contact` 的 PII 欄位（`displayName`→`"[已刪除]"`、`phone`/`email`/`avatarUrl`→null）、刪 `ContactAttribute`、刪 `ChannelIdentity`（斷開平台身分綁定，`profileName`/`profilePic` 一併消失）、清 `LongTermMemory`（含 AI 記住的個資）、把 `Message.content` 中的 inbound 使用者訊息內容抹為佔位（保留訊息骨架供統計，但抹文字/媒體）。**保留** Case/Conversation 的統計骨架（狀態/時間/CSAT 分數）——匿名化的目的是「抹個資、留營運統計」。`Contact.isArchived=true` 標記。
- **hard_delete**：真 `DELETE` `Contact`——靠 schema 既有 `onDelete: Cascade`（ChannelIdentity/ContactAttribute/ContactRelation）連鎖，並顯式刪 `Conversation`（→ Message cascade）、`Case`、`LongTermMemory`、`IdentityMap`、`PortalSubmission`、`PointTransaction`。**不可復原**。

**為何預設匿名化而非硬刪**：GDPR Art.17 的「刪除」在多數實務下匿名化即滿足（資料主體不再可識別），且保留營運統計對商家有價值、對他人（如同對話裡的客服 agent 記錄）衝擊最小。硬刪是不可逆重手段，明確標為選項而非預設，且流程要 ADMIN 二次確認。此取捨與既有 `add-trial-data-purge`「硬刪高風險」的立場一致，但此處因是**單一聯絡人 + 資料主體法定請求**，允許在明確確認下硬刪。

**非同步**：兩模式都走 worker（連鎖刪除可能觸及大量 Message，同步會阻塞）。`POST /tenant/data-erasure` 建請求(pending)+寫稽核`data.erasure.request`→worker 執行→完成寫稽核`data.erasure.complete`（含 `affected` 統計）。

**刪除動作本身的稽核不受影響**：`TenantAuditLog` 記的是 `contactId` + 動作 + 影響量，**不含**被刪的 PII 本身（payload 只存 id 與計數），所以刪 PII 不會讓稽核又變成 PII 洩漏點。這是刻意設計。

### 決策 5：三個新表納入 RLS 與租戶隔離掃描

三表皆有 `tenantId`。必須：（a）加進 `add-postgres-rls` 的 policy 清單（該 change 落地時一併處理）；（b）加進 `scripts/check-tenant-scoping.mjs` 的納管掃描，確保所有 query 帶 `tenantId`。查詢 API 一律 `where: { tenantId: req.tenant.id, ... }`。

## Risks / Trade-offs

- [顯式稽核呼叫漏加] → 敏感操作沒留痕。緩解：清單化（design 上方清單）+ code review + 未來可加「registry→呼叫點」CI 檢查（本 change 先不做，記 open question）。
- [稽核寫入非阻斷，DB 故障時丟稽核] → 合規缺口。緩解：v1 可用性優先；高合規客戶未來可切同 transaction 模式（設定開關）。
- [匿名化不完整，PII 殘留在 Message metadata / 附件] → 沒真正忘掉。緩解：完整列出所有 PII 落點（Contact 欄位/Attribute/ChannelIdentity/LongTermMemory/Message content），逐一處理；媒體附件（MinIO）也要刪。附件刪除列入 tasks。
- [硬刪連鎖誤刪跨聯絡人資料] → 刪多了。緩解：連鎖只沿 `contactId` FK；`ContactRelation` 只刪關聯列不刪對方聯絡人；worker 內用 transaction，先算 `affected` 再刪。
- [匯出檔外洩] → 全租戶 PII 一次外流。緩解：presigned URL 短時效、保留期到期自動刪、`downloadCount` 稽核、下載需 `data.export` 權限 + 同租戶。
- [大租戶匯出/刪除 worker OOM 或超時] → job 失敗。緩解：分批查詢（cursor 分頁）、串流寫檔而非全載入記憶體；失敗 status=failed 可重試。

## Migration Plan

1. Prisma schema 加三 model + `Agent`/`Tenant` 反向關聯 → 產正式 migration（`prisma migrate dev` 產 SQL，不可只 db push，見 MEMORY 慣例）。
2. 部署 migration（`migrate deploy`）——純加表，對既有資料零影響，可安全前滾。
3. 上權限點 registry（新增三 code）+ default role 種子給 ADMIN。
4. 上 API 模組 + worker consumer。
5. 在既有敏感 route/service 插入 `writeTenantAudit` 呼叫（可分批、獨立小 PR）。
6. 前端頁面（後續）。
7. 與 `add-postgres-rls` 協調：該 change 落地時把三表加進 policy。

**Rollback**：純新增，回滾 = 停用新路由 + 隱藏權限點；表可留（空表無害）。稽核已寫入的資料無回滾需求。

## Open Questions

- 稽核 payload 要不要存 before/after 完整快照，還是只存變更欄位？（v1 傾向只存關鍵變更 + id，避免稽核表自己變成 PII 大水庫。）
- 匯出保留期預設天數（7 天暫定）與是否讓平台方可設。
- 是否需要「registry→稽核呼叫點」的 CI 檢查來防漏加（建議後續 change）。
- 稽核防竄改（hash chain / append-only）是否要在受管制客戶落地前補上。
- 匿名化後的 `Message` inbound 內容抹除粒度：全抹 vs 只抹符合 PII pattern 者（v1 傾向全抹 inbound content 保守處理）。
