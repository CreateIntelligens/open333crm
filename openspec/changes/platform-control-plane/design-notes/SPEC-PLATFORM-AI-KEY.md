# Per-Tenant AI Key 設計 — 平台配置 + 租戶自帶（BYOK）

> 把 AI/LLM API key 從「後端 env 全平台共用」改成「每租戶各自的 key」，並讓平台層可代管。
> **依 codebase 實查撰寫**——現況 90% 已就緒：租戶級 AI 設定機制（`TenantSettings` + chat-settings.service）已能設 provider/model/baseUrl/參數，通用加密（`encryptCredentials` AES-256-GCM）可直接沿用。**唯一缺口是「key 憑證欄位」+ fallback 鏈**。
> 依兩項已定案決策撰寫：(1) 三層 fallback（租戶自填 → 平台代設 → env 預設）；(2) 多 provider 各自一把 key（加密 JSON）。

---

## 1. 現況與缺口

| 面向 | 現況 | 缺口 |
|---|---|---|
| 租戶級 AI 設定 | `TenantSettings` 已有 chatProvider/model/baseUrl/溫度/maxTokens/prompt/embedding 參數；baseUrl 已 per-tenant | **無任何 key 欄位** |
| Gemini key | provider 內部自讀 `env.GEMINI_API_KEY`（`gemini.provider.ts:31`），全平台共用一把 | 未 per-tenant |
| Ollama | 本地、無 key，只用 baseUrl（已 per-tenant） | 無需改 |
| 加密 | `encryptCredentials`/`decryptCredentials`（AES-256-GCM，通用純函式，現用於 channel） | 需抽成共用工具供 settings 用 |
| provider 入參 | `ChatGenerateOptions` 有 baseUrl，**無 apiKey**（`types.ts` 註解明寫 "Gemini reads global API key"） | 需加 `apiKey?` |
| fallback | 無（直接讀 env） | 需三層 fallback |

---

## 2. 三層 fallback（已定案）

AI 呼叫時，key 的解析優先序：

```
1. 租戶自填 key（站內設定頁，租戶 admin 填自己的）
        ↓ 無則
2. 平台代設 key（平台後台幫該租戶指定的）
        ↓ 無則
3. 平台預設 key（env.GEMINI_API_KEY，過渡 / 共用池）
        ↓ 無則
   throw（該 provider 未設 key）
```

- 「租戶自填」與「平台代設」**存同一個加密欄位**（見 §3）——差別只在「誰寫的」與「來源標記」，讀取時是同一份。平台代設可視為「平台幫租戶預先填好」。
- **語意選擇**：兩者存同欄位，用一個 `aiKeySource` 標記（`tenant` / `platform`）記錄由誰設定，供 UI 顯示「此 key 由平台代管」或「你自己設定的」。若要嚴格區分「租戶填的優先於平台填的」，則需兩個欄位——**本設計採單欄位 + source 標記**（較簡單，符合「兩者皆可、同一把生效」的需求；真正要分兩層優先的情境少見）。
- Ollama 不走此鏈（無 key）。

---

## 3. 資料模型

### 3.1 `TenantSettings` 新增欄位

| 欄位 | 型別 | 說明 |
|---|---|---|
| `aiKeysEncrypted` | String? | AES-256-GCM 加密的 JSON：`{ gemini: "...", openai: "..." }`（多 provider 各自一把）；null = 該租戶用平台預設 env key |
| `aiKeySource` | String? | `tenant`（租戶自填）/ `platform`（平台代設）——僅供 UI 顯示與稽核，不影響解析 |

> 加密 JSON 正好搭配 `encryptCredentials` 收 `Record<string, unknown>`。多 provider 各自一把 → 依 `TenantSettings.chatProvider` 取對應 key。日後加 OpenAI/Anthropic 只是 JSON 多一個 key，無需改 schema。

### 3.2 共用加密工具（抽出）

把 `channel.service.ts` 的 `encryptCredentials`/`decryptCredentials` 抽到 `apps/api/src/shared/utils/crypto.ts`（channel 與 settings 共用，避免 settings 反向 import channel 模組）。同時把 `CREDENTIAL_ENCRYPTION_KEY` 補進 `env.ts` 的 zod schema（目前直接 `process.env` 讀）。

---

## 4. Provider 改造（最小改動）

1. `providers/types.ts`：`ChatGenerateOptions` 新增 `apiKey?: string`。
2. `gemini.provider.ts`：`const apiKey = opts.apiKey ?? getConfig().GEMINI_API_KEY;`（租戶優先、缺則平台 env、都無則 throw）——**fallback 收斂在 provider 一處**。
3. `llm.service.generateReply`：從 `getChatSettings` 取解密後的 key，`provider.generate({ ..., apiKey })` 傳入。
4. `chat-settings.service.getChatSettings`：解密 `aiKeysEncrypted`，依 `chatProvider` 取對應 key，放進回傳（**僅供內部呼叫，API 回應遮罩**）。
5. `checkChatHealth`（設定頁測連線）：一併透傳租戶 key，讓「測試連線」用的是租戶自己的 key。
6. Ollama provider 不改。

---

## 5. 兩個設定入口（呼應「兩者皆可」）

### 5.1 租戶站內（租戶 admin，需 `settings.manage`）
- 在既有「聊天設定」頁加「API 金鑰」區：填/清除各 provider 的 key。
- 回應**務必遮罩**：只回 `{ gemini: { hasKey: true, masked: 'AIza…4b2c' }, openai: { hasKey: false } }`，**絕不回明文**（比照 Partner API key 的 `keyPrefix…keySuffix` 遮罩）。
- 寫入時 `aiKeySource = 'tenant'`。

### 5.2 平台後台（superuser，`/admin`）
- 在租戶詳情頁加「AI 金鑰代管」：平台方可幫該租戶填/清 key。
- 寫入時 `aiKeySource = 'platform'`；寫 `PlatformAuditLog`（`tenant.aikey.set`，payload 不含明文、只記 provider 與遮罩）。
- 平台後台顯示各租戶「key 來源」：租戶自填 / 平台代管 / 用平台預設（env）。

---

## 6. 與前面三層權限 / usage 的串接

- **與 entitlement**：可加一個 feature `ai`（或沿用既有 AI 相關 feature）控制「此租戶能不能用 AI」；BYOK 與否是租戶設定，不佔 entitlement。
- **與 usage 計費（SPEC-PLATFORM-USAGE）**：`AiUsage` 逐次記錄需**加一欄 `keySource`（tenant/platform）**——因為：
  - 租戶自帶 key（BYOK）→ 成本進租戶自己雲帳號，平台**不計費**、只記用量。
  - 平台代設 / 平台預設 key → 成本算平台的，需換算金額向租戶收（反映在方案費）。
  - 平台 usage 儀表板據此區分「平台承擔成本的 token」vs「租戶自付的 token」，計費才正確。
- **與 model guard / 換算單價**：`AiModelPricing` 只對「平台承擔」的呼叫換算金額。

---

## 7. 安全要求

- key **一律加密儲存**（AES-256-GCM），DB 不存明文。
- API 回應**一律遮罩**，明文只在後端解密後即用即丟（傳給 provider header），不記 log、不進錯誤訊息。
- 平台後台代設 key 屬高敏感操作，寫稽核（不含明文）。
- `CREDENTIAL_ENCRYPTION_KEY` 補進 env schema，正式環境必須設定（非 fallback 預設值），否則加密形同虛設。
- 遷移期：既有 env `GEMINI_API_KEY` 保留為第三層 fallback，讓未設 key 的租戶不中斷；待所有租戶都設定後再評估移除。

---

## 8. 最小改動檔案清單

| 檔案 | 改動 |
|---|---|
| `packages/database/prisma/schema.prisma` | `TenantSettings` 加 `aiKeysEncrypted` / `aiKeySource` + migration |
| `apps/api/src/config/env.ts` | 補 `CREDENTIAL_ENCRYPTION_KEY` 進 zod schema |
| `apps/api/src/shared/utils/crypto.ts`（新） | 抽出 encrypt/decrypt（channel 改 import 此處） |
| `apps/api/src/modules/settings/chat-settings.service.ts` | 讀寫/解密 key、依 provider 取、遮罩回應 |
| `apps/api/src/modules/ai/providers/types.ts` | `ChatGenerateOptions.apiKey?` |
| `apps/api/src/modules/ai/providers/gemini.provider.ts` | `opts.apiKey ?? env` fallback |
| `apps/api/src/modules/ai/llm.service.ts` | 傳入 apiKey |
| `apps/api/src/modules/settings/settings.routes.ts` + 前端 | 租戶側設定/遮罩 key |
| `apps/api/src/modules/platform/*`（新） | 平台後台代管 key + 稽核 |
| `AiUsage`（SPEC-PLATFORM-USAGE） | 加 `keySource` 欄位供計費區分 |

---

## 9. 待拍板

- **單欄位 + source 標記 vs 雙欄位（租戶/平台各一，租戶嚴格優先）**：本設計採單欄位（簡單，同一把生效）。若商業上需要「平台設了 key，租戶仍可自己覆蓋且以租戶為準」的嚴格兩層，才改雙欄位。傾向先單欄位。
- **BYOK 租戶是否顯示用量金額**：租戶自付成本，平台可只顯示 token 量不換金額（避免誤導成向他收費）。
- **key 驗證**：存入前是否即時打一次 API 驗證 key 有效（比照 channel 的 verify）——建議做，避免存入無效 key 到實際對話才失敗。
- **embedding key**：目前 embedding 走 Ollama 無 key；若日後 embedding 也用需 key 的服務，同機制擴充（`aiKeysEncrypted` JSON 加對應 key）。
