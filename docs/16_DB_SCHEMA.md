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

### 7. 有 6 張資料表帶 `tenant_id` 但不建外鍵

`teams`、`tags`、`sla_policies`、`km_articles`、`message_templates`、`automation_logs` 有 `tenant_id` 欄位，卻沒有宣告對 `Tenant` 的關聯。刪除租戶時，資料庫不會對這 6 張資料表執行級聯刪除，應用層必須自行清理。完整清單與其他鬆耦合欄位，見 `docs/ref/DATABASE-ERD.md`。

---

## 已知落差

以下兩項是 schema 宣告與實際資料庫不一致的地方，已在本機資料庫上實測確認。兩項都尚未修復。

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
