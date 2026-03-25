# 15 — License Server 設計（自建）

## 定位

License Server 是**平台方（公司）自己維護**的獨立服務：
- 管理所有 Tenant 的授權、方案、功能開關
- 儲存與核算 Credits 用量
- 提供 License JSON 供各 Tenant 實例定時拉取
- 提供 BD 後台做充值、開案、監控

它與各 Tenant 的 open333CRM 實例**完全隔離**，獨立部署。

---

## 整體架構

```
[BD Admin Portal]  [公司內部]
       │
       ▼
┌──────────────────────────────────────┐
│         License Server               │
│   Node.js + Fastify + PostgreSQL     │
│                                      │
│  /admin/*   → BD 管理介面 API        │
│  /v1/licenses/:key → 供 Tenant 拉取  │
│  /v1/usage/deduct  → Tenant 回報用量 │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────┐   ┌──────────────┐
│  PostgreSQL  │   │    Redis     │
│  (授權資料)  │   │  (Rate Limit)│
└──────────────┘   └──────────────┘

對外：https://license.open333crm.com （或內部域名）
```

---

## 資料庫 Schema

### tenants（租戶基本資料）

```sql
CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key     VARCHAR(64) UNIQUE NOT NULL,  -- 對外識別碼
  name            VARCHAR(200) NOT NULL,
  plan            VARCHAR(50) NOT NULL DEFAULT 'starter',  -- starter / professional / enterprise
  bd_owner        VARCHAR(100),                -- 負責業務
  contract_note   TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### tenant_features（功能開關）

```sql
CREATE TABLE tenant_features (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  feature_path    VARCHAR(100) NOT NULL,  -- e.g. 'ai.imageGeneration'
  enabled         BOOLEAN NOT NULL DEFAULT false,
  override_value  JSONB,                  -- 數量限制等複雜設定
  updated_by      VARCHAR(100),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, feature_path)
);
```

### plan_templates（方案模板，套用後批量設定功能）

```sql
CREATE TABLE plan_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(50) UNIQUE NOT NULL,  -- starter / professional / enterprise
  features    JSONB NOT NULL,               -- feature_path → enabled/value 的 map
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### credits（點數帳本）

```sql
CREATE TABLE credits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  credit_type    VARCHAR(50) NOT NULL,   -- 'llm_tokens' | 'image_gen' | 'broadcast_msgs'
  remaining      BIGINT NOT NULL DEFAULT 0,
  total_ever     BIGINT NOT NULL DEFAULT 0,  -- 歷史累計充值量
  reset_policy   VARCHAR(20) DEFAULT 'never',  -- 'never' | 'monthly'
  reset_day      INT,                           -- monthly reset 的日期
  UNIQUE(tenant_id, credit_type)
);
```

### credit_transactions（充值 & 扣點明細）

```sql
CREATE TABLE credit_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  credit_type    VARCHAR(50) NOT NULL,
  type           VARCHAR(20) NOT NULL,    -- 'recharge' | 'deduct' | 'reset'
  amount         BIGINT NOT NULL,         -- 正整數（含義依 type 而定）
  balance_after  BIGINT NOT NULL,
  note           TEXT,                    -- 充值方式 / 業務備註 / deduct 的 feature
  actor          VARCHAR(100),            -- BD 人員名稱 or 'system'
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
-- 用於對帳、查用量報表
```

### license_signature_secrets（HMAC 簽名金鑰）

```sql
CREATE TABLE license_signature_secrets (
  tenant_id    UUID PRIMARY KEY REFERENCES tenants(id),
  secret       VARCHAR(128) NOT NULL,    -- per-tenant HMAC secret
  rotated_at   TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 扣點 API (Deduction API)

```
POST /v1/usage/deduct
Header: X-License-Key: {licenseKey}
Body: { "creditType": "llmTokens" | "imageGen", "amount": 1253 }
```

**業務邏輯 (Business Logic)**:
1. **即時性**: 每次 API 呼叫 (AI 建議生成或生圖) 成功後，立即回報。
2. **原子性**: `UPDATE credits SET remaining = remaining - $amount WHERE remaining >= $amount`。
3. **事件反饋**: 若 `UPDATE` 影響行數為 0，則 License Server 回傳 402，Tenant 實例隨即觸發 `credits.depleted` 自動化事件。


### BD Admin API（內部，需 Admin JWT）

```
# Tenant 管理
GET  /admin/tenants                    # 列表（可搜尋）
POST /admin/tenants                    # 建立新 Tenant + 選擇方案
GET  /admin/tenants/:id                # 詳情
PATCH /admin/tenants/:id               # 更新（改方案/到期日/BD負責人）
POST /admin/tenants/:id/activate       # 啟用
POST /admin/tenants/:id/deactivate     # 停用（立即讓 Tenant 實例降級）

# 功能開關（精細控制，覆蓋方案預設）
GET  /admin/tenants/:id/features       # 目前所有功能狀態
PATCH /admin/tenants/:id/features      # 批量設定功能開關

# 套用方案模板
POST /admin/tenants/:id/apply-plan
  Body: { "plan": "professional" }

# Credits
GET  /admin/tenants/:id/credits        # 各類型點數餘額
POST /admin/tenants/:id/credits/recharge
  Body: { "creditType": "llm_tokens", "amount": 5000000, "note": "2024Q2 充值" }
GET  /admin/tenants/:id/credits/transactions  # 充值/扣點明細

# 報表
GET /admin/reports/usage?from=&to=     # 所有 Tenant 用量總覽
GET /admin/reports/expiring            # 即將到期 Tenant（30 天內）
```

---

## License JSON 產生邏輯

License JSON 是**動態產生**的（每次 GET 時組裝），不是靜態檔案：

```typescript
async function buildLicenseJson(licenseKey: string): Promise<LicenseJson> {
  const tenant = await db.tenants.findByLicenseKey(licenseKey);
  const features = await db.tenant_features.findAll(tenant.id);
  const credits = await db.credits.findAll(tenant.id);
  const secret = await db.license_signature_secrets.find(tenant.id);
  const remoteServices = buildRemoteServices(tenant.plan); // API Key 從環境變數取

  const json = {
    licenseKey,
    tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, expiresAt: tenant.expiresAt },
    features: buildFeaturesMap(features),
    credits: buildCreditsMap(credits),
    remoteServices,
    meta: {
      version: '1.0',
      issuedAt: new Date().toISOString(),
      fetchUrl: `${process.env.LICENSE_BASE_URL}/v1/licenses/${licenseKey}`,
      refreshIntervalMinutes: 60,
      signature: computeHmac(json, secret),
    }
  };

  return json;
}
```

**LLM API Key 存在 License Server 的環境變數中**，依方案不同使用不同 Key（方便分帳）：

```env
# License Server 環境變數（BD 管理，不外洩）
LLM_API_KEY_STARTER=sk-starter-pool-xxx
LLM_API_KEY_PROFESSIONAL=sk-pro-pool-xxx
LLM_API_KEY_ENTERPRISE=sk-enterprise-pool-xxx
IMAGE_GEN_API_KEY=sk-image-shared-xxx
EMBEDDING_API_KEY=sk-embedding-shared-xxx
```

---

## 扣點並發安全

多個 Tenant Worker 可能同時扣點，需要防止超扣：

```sql
-- 使用 FOR UPDATE + 條件 UPDATE，不用悲觀鎖
UPDATE credits
SET remaining = remaining - $amount
WHERE tenant_id = $tenantId
  AND credit_type = $creditType
  AND remaining >= $amount    -- 餘額夠才扣
RETURNING remaining;
-- 若 UPDATE 0 rows → 表示餘額不足，回傳 402
```

---

## Credit 月度重置（resetPolicy = 'monthly'）

```typescript
// BullMQ Cron Job：每天凌晨 00:05 跑
async function monthlyResetJob() {
  const today = new Date().getDate();
  const creditsToReset = await db.credits.findAll({
    resetPolicy: 'monthly',
    resetDay: today,
  });
  for (const credit of creditsToReset) {
    const plan = await getPlanConfig(credit.tenantId);
    const monthlyQuota = plan.credits[credit.creditType].monthlyQuota;
    await db.credits.update(credit.id, { remaining: monthlyQuota });
    await db.credit_transactions.insert({
      tenantId: credit.tenantId,
      creditType: credit.creditType,
      type: 'reset',
      amount: monthlyQuota,
      balanceAfter: monthlyQuota,
      note: '月度自動重置',
      actor: 'system',
    });
  }
}
```

---

## BD Admin Portal（前端）

一個輕量的內部後台，技術選型：**Next.js + 簡單 UI（Ant Design 或 shadcn/ui）**

### 主要頁面

| 頁面 | 功能 |
|------|------|
| Tenant 列表 | 搜尋、狀態篩選、到期提醒標示 |
| Tenant 詳情 | 方案資訊、功能開關精細設定 |
| Credits 管理 | 各類點數餘額、充值按鈕、明細記錄 |
| 用量報表 | 各 Tenant 本月 Token/圖片/廣播消耗圖表 |
| 到期預警 | 30/7/1 天內到期清單，一鍵寄提醒 Email |
| BD 帳號管理 | 新增/停用 BD 帳號 |

---

## 部署

License Server 是**獨立服務**，不含在 Tenant 的 Docker Compose 中：

```yaml
# license-server/docker-compose.yml
services:
  license-api:
    build: .
    env_file: .env
    depends_on: [license-postgres, license-redis]

  license-admin:
    build: ./admin-portal

  license-postgres:
    image: postgres:16-alpine

  license-redis:
    image: redis:7-alpine

  caddy:
    image: caddy:2-alpine
    # 對外：license.open333crm.com
```

**建議規格**：1 Core / 2GB RAM — 流量很低（每個 Tenant 每 60 分鐘拉一次），
即使有 100 個 Tenant 也只有每分鐘 2 次請求左右。

---

## 安全清單

| 項目 | 設計 |
|------|------|
| License JSON 防竄改 | HMAC-SHA256 per-tenant secret 簽名 |
| BD Portal 防未授權 | JWT + IP Whitelist（限公司 VPN / 固定 IP）|
| 扣點防超扣 | DB 層原子性 UPDATE WHERE remaining >= amount |
| API Key 不外洩 | 只存 License Server 環境變數，不進 JSON（僅在 build 時注入）|
| Tenant 間隔離 | 所有 Query 強制帶 tenant_id WHERE 條件 |
| Rate Limit | Redis：每個 licenseKey 每分鐘最多 5 次 GET |
