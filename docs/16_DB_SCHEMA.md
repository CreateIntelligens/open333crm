# 16 — CRM 資料庫設計決策

本文件說明 open333CRM 資料庫**為什麼這樣設計**：索引策略、關鍵取捨，以及目前已知的落差。

三份資料庫文件各有分工，請依用途查閱：

| 你想知道 | 看哪裡 |
| -------- | ------ |
| 欄位定義、型別、約束的**唯一真實來源** | `packages/database/prisma/schema.prisma` |
| 資料表關聯、每張表存什麼資料 | `docs/ref/DATABASE-ERD.md` |
| 為什麼這樣設計、索引策略、已知落差 | 本文件 |

> 本文件先前收錄一份完整的 schema 全文複本。該複本停留在設計階段的版本（約 540 行），與目前的 schema（2013 行、78 個 model）已經嚴重分歧，因此本次更新將它移除。欄位層級的內容請一律以 `schema.prisma` 為準：同一份定義若維護兩處，必然再度失準。

- **資料庫**：PostgreSQL 16 + pgvector + pgcrypto
- **規模**：78 張資料表、24 個 enum、114 條外鍵關聯
- **migration 數量**：44 份

---

## 索引策略

所有查詢都必須帶 `tenantId`，因此索引一律以 `tenantId` 開頭。以下索引都已在現行 schema 中驗證存在：

| 索引 | 用途 |
| ---- | ---- |
| `conversations(tenantId, status)` | 收件匣列表最常見的篩選條件 |
| `conversations(tenantId, lastMessageAt DESC)` | 收件匣依最新訊息排序 |
| `conversations(tenantId, contactId)` | 查某個聯絡人的所有對話 |
| `conversations(caseId)` | 從案件反查關聯對話 |
| `cases(tenantId, status)` | 案件看板依狀態篩選 |
| `cases(tenantId, assigneeId)` | 客服個人案件看板 |
| `cases(tenantId, slaDueAt)` | SLA worker 定時掃描到期案件 |
| `km_articles(tenantId, status)` | 知識庫列表 |
| `channel_identities(channelId, uid)` | 唯一鍵，webhook 進來時反查聯絡人 |

---

## 重要設計決策

### 1. 一個 Case 可以關聯多個 Conversation

`Conversation.caseId` 只建立一般索引，**沒有** `@unique` 約束，因此關聯是一對多：一個案件可以收攏多個對話。

> 設計初期這裡是 1:1（`caseId` 帶 `@unique`），目的是保證一個對話只開一個案件。後來為了支援「跨對話的案件」而放寬成 1:N。舊版文件仍記載 1:1，已不正確。

### 2. AutomationRule 的 trigger / conditions / actions 存 JSONB

規則結構會隨動作類型變動，用 JSONB 比拆成多張中介表更有彈性。Automation worker 撈出 JSON 後在應用層評估，不在資料庫內計算。

### 3. ChannelIdentity 用 `@@unique([channelId, uid])`

同一個渠道的同一個 uid，只能對應一位聯絡人。系統合併聯絡人時，會把舊聯絡人的 `channel_identities` 轉移到新聯絡人。

### 4. Message.content 存 JSONB

每種 `contentType`（text、flex、image 等）的內容結構都不同。系統用 JSONB 統一存放，再由應用層依 `contentType` 反序列化。

### 5. SLA Policy 鬆耦合

`Case.slaPolicy` 只存 policy 的 id 字串，不建外鍵。刪除 policy 之後，歷史案件的 SLA 紀錄不受連帶影響。

### 6. 租戶隔離由 Postgres RLS 在資料庫層強制執行

78 張資料表中有 71 張啟用 RLS 並掛上 `tenant_isolation` policy。未啟用的 7 張全部是平台層資料表：`tenants`、`plans`、`platform_users`、`platform_audit_logs`、`platform_settings`、`model_pricings`、`trial_signups`。這些資料表管理租戶本身，不屬於任何租戶。

要點：

- policy 同時 `ENABLE` 與 `FORCE`，因此連 table owner 也受約束。
- policy 讀 session 變數 `app.current_tenant`，由 `app_tenant` 連線在交易內以 `set_config` 注入。
- `app_admin` 連線帶 `BYPASSRLS`，供 scheduler 與認證流程做跨租戶查詢。
- 未設定租戶變數時，policy 以 `NULLIF` 轉成 NULL 而查不到任何列，屬於 fail-closed。

接線規則、新增資料表時的必要步驟與排查方式，寫在 `postgres-rls-tenant-isolation` skill，本文件不重複說明。

### 7. `trial_signups.tenantId` 是 soft ref，刻意不建外鍵

使用者送出試用申請時，系統還沒有建立租戶。系統在試用開通成功之後，才把租戶 id 回填到 `trial_signups.tenantId`。因此這個欄位是 soft ref，`schema.prisma` 的註解已明示不設 FK。

`trial_signups` 同時排除在 RLS 之外。試用防濫用流程需要跨租戶查詢候選資料，該路徑走 `prismaAdmin` 白名單（見 `20260827100000_rls_enable_tenantid_tables` migration 的註解）。

另有 6 張資料表帶 `tenant_id` 卻沒有外鍵。那 6 張不是設計決策，是改造遺漏，寫在下方「已知落差」第 3 項。完整清單與其他鬆耦合欄位，見 `docs/ref/DATABASE-ERD.md`。

---

## 已知落差

以下三項都尚未修復。第 1、2 項是 schema 宣告與實際資料庫不一致的地方，已在本機資料庫上實測確認。第 3 項是 schema 本身的缺口，從 migration 歷史與應用層程式碼確認。

### 1. embedding 欄位維度不符：schema 寫 1024，資料庫實際是 1536

`schema.prisma` 把 `km_articles.embedding` 與 `long_term_memories.embedding` 宣告為 `vector(1024)`，但唯一建立這兩個欄位的 migration（`20260323021754_init`）用的是 `vector(1536)`，之後沒有任何 ALTER。實測結果：

```text
     table_name     | column_name | actual_type
--------------------+-------------+--------------
 km_articles        | embedding   | vector(1536)
 long_term_memories | embedding   | vector(1536)
```

成因是 Prisma 不會為 `Unsupported()` 型別產生 migration。因此開發者修改 schema 宣告之後，資料庫不會同步變更，Prisma 也不會回報 drift。若要對齊兩邊，你需要手寫一份 migration 執行 `ALTER TABLE ... ALTER COLUMN embedding TYPE vector(1024)`，並確認既有向量資料的維度。

### 2. 向量索引不存在，語意檢索目前是全表掃描

舊版文件記載要建立這個 HNSW 索引：

```sql
CREATE INDEX km_articles_embedding_idx
  ON km_articles
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

實際上整個 repo 找不到任何 `hnsw`、`ivfflat` 或 `vector_cosine_ops` 字樣，資料庫裡也查不到 embedding 欄位上的任何索引：

```text
 tablename | indexname | indexdef
-----------+-----------+----------
(0 rows)
```

也就是說，知識庫的語意檢索目前對整張表做順序掃描。文章數量少的時候，影響並不明顯；文章數量成長之後，這個缺少的索引會成為效能瓶頸。

### 3. 有 6 張租戶資料表缺少指向 `tenants` 的外鍵

`teams`、`tags`、`sla_policies`、`km_articles`、`message_templates`、`automation_logs` 都有 `tenant_id` 欄位，但是 Prisma schema 沒有宣告對 `Tenant` 的關聯，資料庫也就沒有對應的外鍵約束。

repo 裡沒有任何設計文件或 commit 說明記載這 6 張表為什麼不建外鍵。migration 歷史顯示這是 2026-04-02 多租戶改造的遺漏：

1. `20260323021754_init` 建立這 6 張表。當時系統還是單租戶設計，這 6 張表都沒有 `tenant_id` 欄位。
2. `20260402040324` 一次替 15 張表補上 `tenant_id` 欄位。這 6 張表都在名單內。
3. `20260402041711` 一次替 24 張表補上指向 `tenants` 的外鍵。這 6 張表都不在名單內。
4. 上述兩份 migration 屬於同一個 commit `e26e53a`。該 commit 的訊息只描述 automation 欄位修正，沒有提到多租戶改造。
5. 2026-04-02 之後新增的每一張租戶資料表都建了外鍵。專案慣例是「資料表有 `tenant_id` 就建外鍵」，這 6 張表是例外。

以下兩項常被當成不建外鍵的理由，但是都不成立：

- **「`tags` 與 `message_templates` 的 `tenant_id` 可為 null」**：這兩張表用 null 代表系統共用列。Postgres 的外鍵允許欄位值為 null，因此建了外鍵之後，系統共用列仍然可以存在。
- **「避免刪除租戶時發生級聯刪除」**：現有指向 `tenants` 的外鍵，只有 `chatbox_sessions`、`tenant_audit_logs`、`data_export_requests`、`data_erasure_requests` 這 4 條使用 `ON DELETE CASCADE`，其餘都使用 `ON DELETE RESTRICT`。

**目前的實際影響**：應用程式沒有任何硬刪除租戶的路徑。`apps/api/src/modules/trial/trial.scheduler.ts` 的 purge 只寫入 `purgedAt` 做軟刪除，不刪資料列。因此級聯刪除不是眼前的問題。缺少外鍵造成的實際缺口在寫入端：這 6 張表可以寫入一個不存在的 `tenant_id`，資料庫不會擋下來。RLS 的 `WITH CHECK` 只阻擋跨租戶寫入，不驗證該租戶是否存在。

---

## 維護方式

你改動 schema 之後，請一併檢查本文件的設計決策是否仍然成立。

列出目前所有的 model 與 enum：

```bash
grep -nE "^(model|enum) " packages/database/prisma/schema.prisma
```

檢查某個 model 的索引與唯一鍵：

```bash
awk '/^model Case \{/,/^\}/' packages/database/prisma/schema.prisma | grep -E "@@index|@@unique"
```

對照資料庫實際狀態（開發環境）：

```bash
docker compose -f docker-compose.dev.yml exec postgres \
  psql -U crm -d open333crm -c "\d+ cases"
```
