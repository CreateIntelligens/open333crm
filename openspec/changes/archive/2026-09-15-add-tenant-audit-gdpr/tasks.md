## 1. 資料模型與共用基礎

- [x] 1.1 在 `packages/database/prisma/schema.prisma` 新增 `TenantAuditLog` model（tenantId/actorId/action/targetType/targetId/payload/ip/createdAt + 三個 index），並在 `Tenant`、`Agent` 加反向關聯
- [x] 1.2 新增 `DataExportRequest` model（tenantId/requestedBy/status/scope/fileKey/fileSizeBytes/downloadCount/error/expiresAt/completedAt）與反向關聯
- [x] 1.3 新增 `DataErasureRequest` model（tenantId/requestedBy/contactId/mode/status/reason/affected/error/completedAt）與反向關聯
- [x] 1.4 產正式 Prisma migration（`prisma migrate dev`，不可只 db push），確認 SQL 檔產生
- [x] 1.5 在 `packages/core/src/rbac/permissions.ts` 新增 `audit.view` / `data.export` / `data.erase` 三個權限點（feature: core，分群「稽核與合規」，`data.erase` dependsOn contact.view），build core 套件
- [x] 1.6 更新 default role 種子，將三個新權限點指派給 ADMIN
- [x] 1.7 把三個新表加進 `scripts/check-tenant-scoping.mjs` 納管掃描，並與 `add-postgres-rls` change 對齊 RLS policy 清單

## 2. 租戶操作稽核（Audit）

- [x] 2.1 建立 `apps/api/src/modules/tenant-audit/tenant-audit.service.ts`，實作 `writeTenantAudit()`（比照 `writePlatformAudit`，含 try/catch 非阻斷）
- [x] 2.2 建立 `tenant-audit.routes.ts`：`GET /tenant/audit-logs`（preHandler 檢查 `audit.view`），支援分頁 + action/actor/日期篩選，where 帶 tenantId
- [x] 2.3 在系統設定變更點插入稽核（`settings.update`）
- [x] 2.4 在成員與角色權限變更點插入稽核（`agent.create`/`agent.delete`/`agent.role.assign`/`role.permission.update`/`agent.password.reset`）
- [ ] 2.5 在聯絡人刪除/合併點插入稽核（`contact.delete`/`contact.merge`）
- [x] 2.6 在案件刪除點插入稽核（`case.delete`）
- [x] 2.7 在渠道建立/刪除點插入稽核（`channel.create`/`channel.delete`）
- [ ] 2.8 在行銷名單匯出點插入稽核（`marketing.list.export`）
- [x] 2.9 撰寫測試：稽核寫入含正確欄位、寫入失敗不阻斷主操作、查詢跨租戶隔離、無權限 403

## 3. 資料匯出（GDPR Art.20 可攜權）

- [x] 3.1 建立 `apps/api/src/modules/data-export/data-export.service.ts` 與 routes：`POST /tenant/data-export`（檢查 `data.export`）建 pending 請求 + 寫稽核 `data.export.request` + 入列 BullMQ job（Path B）
- [x] 3.2 在 `apps/workers` 新增 export consumer：cursor 分頁逐表撈本租戶資料（Contact/Conversation/Message/Case + 附屬），串流產 JSON + CSV，打包 zip
- [x] 3.3 上傳 zip 至 MinIO（`export/{tenantId}/{requestId}.zip`），更新請求 status=completed/fileKey/fileSizeBytes/expiresAt
- [x] 3.4 完成後經 Redis pub/sub 發站內通知給發起者（成功/失敗皆通知）
- [x] 3.5 實作 `GET /tenant/data-export/:id`（查狀態）與 `GET /tenant/data-export/:id/download`（同租戶 + completed + 未過期，產短時效下載連結，downloadCount++）
- [x] 3.6 實作保留期清理（cron worker）：到期把 status→expired 並刪 MinIO 物件
- [x] 3.7 撰寫測試：匯出只含本租戶資料、過期不可下載、跨租戶下載被拒、失敗記錄 error

## 4. 資料刪除（GDPR Art.17 被遺忘權）

- [x] 4.1 建立 `apps/api/src/modules/data-erasure/data-erasure.service.ts` 與 routes：`POST /tenant/data-erasure`（檢查 `data.erase` + 目標聯絡人同租戶）建 pending 請求 + 寫稽核 `data.erasure.request` + 入列 job
- [x] 4.2 在 `apps/workers` 新增 erasure consumer——`anonymize` 分支：抹 Contact PII 欄位、刪 ContactAttribute、刪 ChannelIdentity、清 LongTermMemory、抹 inbound Message content，保留 Case/Conversation 統計骨架
- [x] 4.3 erasure consumer——`hard_delete` 分支：transaction 內先算 affected，再連鎖刪 Conversation/Message/Case/LongTermMemory/IdentityMap/PortalSubmission/PointTransaction 與 Contact（靠 cascade + 顯式刪），並刪對應 MinIO 媒體附件
- [x] 4.4 完成後更新 status=completed/affected，寫稽核 `data.erasure.complete`（payload 只含 contactId/mode/計數，不含 PII），通知發起者
- [x] 4.5 撰寫測試：匿名化後不可識別且統計保留、硬刪連鎖生效且不波及他人聯絡人、刪除稽核不含 PII、跨租戶目標被拒

## 5. 收尾

- [x] 5.1 更新 `CHANGELOG.md`（Added：租戶操作稽核、資料匯出、資料刪除、三個權限點）
- [x] 5.2 `openspec validate add-tenant-audit-gdpr --strict` 通過
- [ ] 5.3 （後續）前端頁面：稽核查詢頁、匯出請求/下載入口、聯絡人刪除入口（含硬刪二次確認）
