# 租戶端「方案與用量」頁 — 設計

> 租戶**不登入平台層**；但在自己的 333 站台內有一個唯讀自助頁，看得到方案、功能、用量，並能自選 AI key 來源。
> 依已定案：**唯讀資訊 + 升級引導 + AI key 來源自選**。這是 control plane（平台方設定）在 data plane（租戶站內）的「檢視鏡像」。

---

## 1. 定位

| | 平台後台（control plane） | 租戶「方案與用量」頁（data plane） |
|---|---|---|
| 誰進 | 平台方 superuser（`psk_`/平台 JWT） | 租戶 admin（一般租戶 JWT） |
| 能做什麼 | **設定**租戶方案、entitlement、代管 key | **檢視**方案/功能/用量 + **自選 AI key 來源** |
| 資料來源 | 跨租戶讀寫 | 只讀自己租戶（tenantId 來自 token） |
| 改方案 | 可 | 不可（改方案 = 洽詢平台方 / 升級引導） |

租戶頁是「看得到結果、改不到平台設定」——唯一的例外自助是 **AI key 來源選擇**（因為那是租戶自己的憑證，理應自己管）。

---

## 2. 頁面內容（租戶站內，需 `settings.manage` 或專屬 `billing.view`）

### 2.1 目前方案
- 方案名稱（Free/Pro/Enterprise）、方案含哪些功能。
- 不顯示價格細節（除非日後接計費）；升級走「聯絡我們 / 洽詢」CTA。

### 2.2 功能清單（含鎖定升級引導）
- 已開功能：正常列出。
- 未開功能（entitlement 沒有的 feature）：顯示 🔒 +「升級 Pro 解鎖」+ 洽詢入口——與租戶權限頁的鎖定態一致（同一份 entitlement 資料）。
- 呈現與「顯示但鎖住」決策一致：看得到有這功能、知道要升級才能用。

### 2.3 本月用量（唯讀摘要）
- AI token 用量（本月累計）、訊息發送量、AI 呼叫次數等關鍵數字（讀 `DailyStat` / `AiUsage` 彙總）。
- 若有方案額度（limits）：顯示「已用 X / 額度 Y（Z%）」，接近上限時提示。
- **金額顯示規則**：
  - 若該租戶 AI key 來源 = **平台提供** → 可顯示平台換算的成本/計費金額。
  - 若 = **自備（BYOK）** → **只顯示 token 量、不顯示金額**（成本進租戶自己雲帳號，顯示金額會誤導成向他收費）。

### 2.4 AI API Key 來源（唯一的自助設定）
租戶在此選擇 AI key 用**平台提供**還是**自己提供**：

```
AI API 金鑰來源
 ◉ 使用平台提供的金鑰
   （由 333 平台代管，token 成本計入你的方案）
 ○ 使用我自己的金鑰（BYOK）
   Gemini  [ AIza…4b2c  ] [更換] [清除]
   OpenAI  [ 未設定       ] [設定]
   （帳單直接進你自己的雲帳號；平台只記錄用量、不向你收 AI 費用）
```

- 選「平台提供」→ 走三層 fallback 的平台代設/env key（見 `SPEC-PLATFORM-AI-KEY.md`）。
- 選「自己提供」→ 填各 provider 的 key，寫入 `TenantSettings.aiKeysEncrypted`、`aiKeySource='tenant'`。
- key 一律**加密儲存、遮罩顯示**（`AIza…4b2c`），存入前建議即時驗證有效性（比照 channel verify）。
- 切換來源即時反映到 §2.3 的金額顯示規則與 `AiUsage.keySource`（計費歸屬）。

---

## 3. API（租戶側，帶租戶 token）

| method | path | 權限 | 說明 |
|---|---|---|---|
| GET | `/me/plan` | 登入即可 / `billing.view` | 目前方案 + entitlement feature（已開/鎖定） |
| GET | `/me/usage` | `billing.view` | 本月用量摘要（讀 DailyStat/AiUsage） |
| GET | `/me/ai-keys` | `settings.manage` | 各 provider key 狀態（遮罩，`{ hasKey, masked, source }`） |
| PUT | `/me/ai-keys` | `settings.manage` | 設定/清除自己的 key + 切換來源 |

- 全部 `tenantId` 來自 token，只讀寫自己租戶。
- 這些是 data-plane 端點，**與平台後台 `/admin/*` 完全分離**。
- 新增權限點 `billing.view`（歸屬 `core` feature，恆開）——讓「看方案用量」可授權給特定角色。

---

## 4. 與其他文件的關係

- **entitlement 天花板**：本頁的「功能鎖定」與租戶權限頁的 🔒 用**同一份 entitlement**（`entitlement:tenant:{id}`），不重複定義。
- **AI key**：完整機制在 `SPEC-PLATFORM-AI-KEY.md`；本頁是它的租戶自助入口（§2.4）。
- **usage 統計**：數字來自 `SPEC-PLATFORM-USAGE.md` 的 `DailyStat`/`AiUsage`；本頁是租戶唯讀視角（平台方看跨租戶，租戶看自己）。
- **定義順序**：本頁顯示的 feature 清單來自平台 FEATURE registry（見 `ARCH-PLATFORM-LAYER.md` §0.1），與平台後台同源。

---

## 5. 待拍板

- 用量頁的權限點：用既有 `settings.manage` 就好，還是獨立 `billing.view`（可只給老闆看用量、不給一般 admin）？傾向獨立 `billing.view`（歸 core）。
- 升級 CTA 行為：純「聯絡我們」表單，還是日後接自助升級 + 金流？本階段先洽詢。
- BYOK 是否需平台方允許：某些租戶方案可能規定「只能用平台 key」——是否讓平台在 entitlement 加一個「允許 BYOK」開關？（可延後，預設允許。）
