# 14 — 平台授權 & Billing 控制系統

## 定位與設計原則

> **這一層是「太上皇」**：公司（平台方）對每個部署的 open333CRM 實例的控制層。
> 租戶（企業客戶）**看不到**、**摸不到**這個系統。
> 所有功能開關、AI 用量額度，都由平台方統一設定。

核心設計決策：
- **遠端 License JSON**（靜態 JSON + 簽名）優先，實作最簡單、部署無依賴
- 系統定期拉取 → 快取在本地 → 所有功能呼叫前檢查
- 網路斷線時使用上一次快取，不影響已有功能（Graceful Degradation）
- 餘額不足時優雅降級（功能 off），不崩潰

---

## License JSON 結構

每個客戶部署有一個唯一的 `licenseKey`，對應平台方服務的一份 JSON：

```json
{
  "licenseKey": "lic_david_appliance_2024",
  "tenant": {
    "id": "tenant_david_appliance",
    "name": "XX 家電股份有限公司",
    "plan": "professional",
    "expiresAt": "2026-12-31T23:59:59Z",
    "note": "業務：David Chen，2024Q4 簽約"
  },
  "features": {
    "channels": {
      "line":     { "enabled": true,  "maxCount": 3 },
      "fb":       { "enabled": true,  "maxCount": 2 },
      "webchat":  { "enabled": true,  "maxCount": 1 },
      "whatsapp": { "enabled": false },
      "telegram": { "enabled": true,  "maxCount": 2, "messageFee": 0, "messageFeeCurrency": "USD" },
      "threads":  { "enabled": false }
    },
    "inbox": {
      "unifiedInbox": true,
      "maxAgents": 15,
      "maxTeams": 10,
      "maxConcurrentConversations": 500
    },
    "caseManagement": {
      "enabled": true,
      "sla": true,
      "escalation": true,
      "subCases": false
    },
    "automation": {
      "enabled": true,
      "maxRules": 50,
      "advancedTriggers": true,
      "webhookAction": true
    },
    "marketing": {
      "broadcast": true,
      "maxBroadcastPerMonth": 10,
      "abTesting": false,
      "appointmentSystem": false
    },
    "km": {
      "enabled": true,
      "maxArticles": 200
    },
    "ai": {
      "llmSuggestReply": true,
      "imageGeneration": true,
      "sentimentAnalysis": false,
      "autoClassify": true
    },
    "contacts": {
      "maxContacts": 50000,
      "relationGraph": true,
      "customAttributes": true,
      "maxCustomAttributes": 20
    }
  },
  "credits": {
    "llmTokens": {
      "remaining": 8500000,
      "total": 10000000,
      "unit": "tokens",
      "resetPolicy": "never",
      "lastRechargedAt": "2026-02-15T00:00:00Z"
    },
    "imageGen": {
      "remaining": 450,
      "total": 500,
      "unit": "images",
      "resetPolicy": "never",
      "lastRechargedAt": "2026-02-15T00:00:00Z"
    },
    "broadcastMessages": {
      "remaining": 28000,
      "total": 30000,
      "unit": "messages",
      "resetPolicy": "monthly",
      "resetDay": 1
    }
  },
  "remoteServices": {
    "llm": {
      "provider": "openai",
      "model": "gpt-4o",
      "endpoint": "https://api.openai.com/v1",
      "apiKey": "sk-platform-shared-key-xxxx",
      "maxTokensPerRequest": 4000
    },
    "imageGen": {
      "provider": "openai",
      "model": "dall-e-3",
      "endpoint": "https://api.openai.com/v1",
      "apiKey": "sk-platform-shared-key-xxxx"
    },
    "embedding": {
      "provider": "openai",
      "model": "text-embedding-3-small",
      "apiKey": "sk-platform-shared-key-xxxx"
    }
  },
  "meta": {
    "version": "1.0",
    "issuedAt": "2026-01-01T00:00:00Z",
    "fetchUrl": "https://license.open333crm.com/v1/licenses/lic_david_appliance_2024",
    "refreshIntervalMinutes": 60,
    "signature": "sha256-hmac:abcdef1234567890..."
  }
}
```

---

## 系統讀取機制

### 啟動流程

```
API Server 啟動
  ├── 讀取環境變數 LICENSE_KEY + LICENSE_URL
  ├── 嘗試從遠端拉取 License JSON
  │   ├── 成功 → 驗證 HMAC 簽名 → 快取至 Redis（TTL: 70分鐘）
  │   └── 失敗 → 讀上一次快取（若無快取 → 啟動失敗，記錄 error log）
  └── LicenseService 初始化完成，供全系統查詢
```

### 定期刷新（Background Job）

```
每 60 分鐘（依 meta.refreshIntervalMinutes）
  → 重新拉取 License JSON
  → 驗證簽名
  → 更新 Redis 快取
  → 廣播 license.updated 事件（讓各 worker 感知變更）
```

### 網路斷線時的 Graceful Degradation

```
遠端 JSON 拉取失敗
  ├── 若 Redis 快取還在（< 24 小時）→ 繼續使用，記錄 warning
  ├── 若快取超過 24 小時 → 進入「降級模式」：
  │   ├── 基礎功能（收件匣/Case/Contact）仍正常
  │   ├── AI 功能暫停（credits 無法更新）
  │   └── 後台顯示警告橫幅給 Admin
  └── 記錄告警，通知平台方
```

---

## LicenseService API（內部使用）

```typescript
class LicenseService {
  // 功能開關檢查
  isFeatureEnabled(feature: string): boolean;

  // 數量限制
  getLimit(key: string): number;
  // 範例：licenseService.getLimit('contacts.maxContacts')
  // 範例：licenseService.getLimit('inbox.maxTeams')  ← 新增

  // 部門數限制（Q3 決策）
  isTeamCreationAllowed(): boolean;  // 檢查此時 teams.count < maxTeams

  // 渠道檢查（支援多組賬號）
  isChannelEnabled(channelType: string): boolean;
  getChannelMaxCount(channelType: string): number;  // maxCount 授權上限
  getMessageFee(channelType: string): { amount: number; currency: string } | null;

  // 遠端服務設定
  getRemoteService(service: 'llm' | 'imageGen' | 'embedding'): RemoteServiceConfig;

  // Credits 相關
  getCredits(type: 'llmTokens' | 'imageGen' | 'broadcastMessages'): CreditInfo;
  hasCredits(type: string, amount?: number): boolean;

  // 扣點（即時預扣制，Q2 決策）
  deductCredits(type: string, amount: number): Promise<DeductResult>;

  // 完整 License 物件給後台 Admin 顯示
  getLicenseSummary(): LicenseSummary;  // 不包含 API Key
}
```

---

## 功能 Guard 實作

所有進階功能的 API 端點加上 Guard：

```typescript
// middleware: check-feature.guard.ts
export function requireFeature(featurePath: string) {
  return (req, reply, done) => {
    if (!licenseService.isFeatureEnabled(featurePath)) {
      return reply.status(402).send({
        success: false,
        error: {
          code: 'FEATURE_NOT_ENABLED',
          message: '此功能未在您的授權方案內，請聯繫客服升級',
          featurePath,
        }
      });
    }
    done();
  };
}

// middleware: check-credits.guard.ts
export function requireCredits(creditType: string, estimatedAmount: number = 1) {
  return (req, reply, done) => {
    if (!licenseService.hasCredits(creditType, estimatedAmount)) {
      return reply.status(402).send({
        success: false,
        error: {
          code: 'INSUFFICIENT_CREDITS',
          message: `${creditType} 點數不足，請充值後再試`,
          creditType,
          remaining: licenseService.getCredits(creditType).remaining,
        }
      });
    }
    done();
  };
## 餘額不足自動化通知鏈 (Credit Depletion Automation)

當 License Service 拒絕扣點（如 Token 用罄）時，系統將觸發降級流程。

### 1. 觸發事件 (Events)
- `license.credits.depleted`: 點數不足事件。Payload 包含 `creditType` (llmTokens/imageGen)。

### 2. 系統回應動作 (Actions)
- **前端即時通知 (`internal.push_ui_notification`)**:
    - 客服 Inbox 彈出紅色提示：「⚠️ 點數不足，AI 建議回覆已暫停。」
    - 禁用「AI 建議」與「AI 素材生圖」按鈕。
- **自動標記**: 可透過 Automation 將相關對話標記為「需人工優先處理」。

---

## 計費與點數核算邏輯 (Deduction)

### 1. AI 建議回覆 (llmTokens)
- **時機**: 當客服點擊「取得建議」且系統成功返回內容時。
- **模式**: Copilot (輔助) 模式，由人工審核「採用」。

### 2. 素材生圖 (imageGen)
- **時機**: 當管理員在模板或 Rich Menu 編輯器中點擊「生成圖片」成功後。

---

## 授權 Guard 實作 (Middleware)
... (其餘不變)


```
客服觸發「AI 建議回覆」
  │
  ├─ Guard 檢查：feature.ai.llmSuggestReply === true ✅
  ├─ Guard 檢查：credits.llmTokens.remaining >= 2000 ✅
  │
  ├─ 從 License 取得 LLM API Key + Model
  ├─ 呼叫 OpenAI API（使用平台方統一 API Key）
  │
  ├─ 取得回應 + 實際用量（prompt_tokens + completion_tokens）
  │
  └─ 回報用量給 License 服務
       → POST https://license.open333crm.com/v1/usage/deduct
         { licenseKey, type: "llmTokens", amount: 1253 }
       → 平台方扣除該 tenant 的點數餘額
       → 回傳最新 remaining（更新本地快取）
```

**關鍵設計**：LLM API Key 存在 License JSON 的 `remoteServices` 中，
**不讓 tenant 知道**，也不存在 tenant 的環境變數裡。
所有 AI 呼叫都透過系統代理，tenant 無法繞過點數機制。

---

## Credits 充值流程

### 客戶自主充值（線上）
```
客戶（非 tenant 後台，而是平台方的客戶門戶）
  → 登入 open333CRM 客戶門戶
  → 查看目前餘額
  → 選擇充值方案（如：100 萬 Tokens = NT$500）
  → 線上付款（綠界 / 藍新 / 信用卡）
  → 平台方更新 License JSON 中的 remaining
  → 系統下次 refresh 時自動取得最新額度
```

### 業務手動充值
```
業務人員登入 платформ Admin 後台
  → 找到客戶 licenseKey
  → 輸入充值數量
  → 儲存 → 遠端 License JSON 更新
  → 系統 60 分鐘內自動同步（或手動觸發 refresh）
```

---

## 環境變數設定（Tenant 部署端）

只需兩個 License 相關環境變數：

```env
# 授權金鑰（唯一識別此部署）
LICENSE_KEY=lic_david_appliance_2024

# 授權 JSON 的遠端 URL（平台方提供）
LICENSE_FETCH_URL=https://license.open333crm.com/v1/licenses/lic_david_appliance_2024

# 驗證 HMAC 簽名用的 Secret（防止 JSON 被竄改）
LICENSE_SIGNATURE_SECRET=hmac-secret-per-tenant-xxx
```

**Tenant 完全不知道：**
- OpenAI API Key 是什麼
- 點數餘額的計算方式
- 哪些功能是付費才有的（只會看到「功能未啟用」）

---

## 平台方後台（Platform Admin）功能清單

> 這是公司內部使用的後台，與客戶 tenant 完全隔離部署。

| 功能 | 說明 |
|------|------|
| Tenant 管理 | 建立/編輯/停用授權 |
| 方案管理 | 設計 starter / professional / enterprise 方案模板 |
| 功能開關 | 精細控制每個 tenant 的 feature flag |
| Credits 管理 | 查看用量、手動充值、設定充值紀錄 |
| 用量監控 | 所有 tenant 的 LLM 用量圖表 |
| 授權到期提醒 | 到期前 30/7 天發提醒給業務 |
| License JSON 重新發布 | 更新後強制推送（讓 tenant 60 分鐘內同步）|

---

## 方案示例（Plan Templates）

| 方案 | Starter | Professional | Enterprise |
|------|---------|-------------|------------|
| 月費 | NT$2,900 | NT$6,900 | 客製 |
| 渠道數 | 1 LINE | LINE+FB+Chat | 不限 |
| Agent 數 | 3 | 15 | 不限 |
| 聯繫人 | 5,000 | 50,000 | 不限 |
| 自動化規則 | 10 | 50 | 不限 |
| LLM Token/月 | 100萬 | 1,000萬 | 依需求 |
| AI 生圖 | ❌ | 500張/月 | 依需求 |
| KM 文章 | 20 | 200 | 不限 |
| SLA / 升級 | ❌ | ✅ | ✅ |
| 關係鏈 | ❌ | ✅ | ✅ |
| WhatsApp | ❌ | ❌ | ✅ |

---

## 安全考量

| 風險 | 對策 |
|------|------|
| 有人竄改本地快取的 JSON | HMAC-SHA256 簽名驗證，簽名不符拒絕載入 |
| 有人直接改 Redis 快取 | Redis 設定 requirepass；簽名連同存入 Redis |
| Tenant 嘗試用自己的 API Key 繞過 | LLM 呼叫全部走 LicenseService，不接受外部 Key |
| License Server 被 DDOS | License JSON 是靜態檔案，可放 CDN |
| License 過期仍在使用 | checkLicenseExpiry() 在每次 guard 時檢查 |
