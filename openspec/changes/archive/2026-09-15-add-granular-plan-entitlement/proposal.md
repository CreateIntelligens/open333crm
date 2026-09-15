## Why

目前平台層方案（Plan）的功能天花板只到「功能模組」粒度（`plan.features` 一個 feature 一個開關），無法做更細的分級。對標競品 [Omnichat](https://docs.omnichat.ai/features/she-ding/ji-hua-gong-neng-xian-zhi)，成熟對話商務 SaaS 用三種手段混合控制方案：整功能開關（已有）、數量上限（已有）、**功能點細分**（如「能看報表但不能匯出」）、**渠道限制**（如免費只能連渠道不能自動化、或限定渠道種類/數量）。open333 底層其實已具備細分能力（權限點體系、plan.limits），只是平台後台未開放設定。本 change 補齊三塊細粒度，讓方案分級對標 Omnichat 等競品。

## What Changes

### A. 功能點細分（Boolean entitlement 更細）
- 平台後台方案設定 MUST 能勾選到**權限點**層級（如 `analytics.export`、`marketing.broadcast`、`case.delete`），而非只有整個 feature 開關。
- Plan 天花板從「feature 集合」擴展為「feature 集合 + 額外可獨立開關的權限點覆寫」；有效天花板 = feature 展開的權限點，**再套用權限點層級的細分覆寫**（可在某 feature 內關掉個別權限點，如開 marketing 但關 broadcast）。
- 既有只設 feature 的方案行為 MUST 不變（無覆寫 = 沿用 feature 全展開）。

### B. 渠道數量上限（Quantity entitlement）
- `plan.limits` 新增 `maxChannels`（複用既有數值上限機制）；建渠道時 count 硬擋，超限回 `PLAN_LIMIT_EXCEEDED`。

### C. 渠道 provider 限定（Resource restriction）
- Plan 新增 `allowedChannelTypes`（渠道類型白名單，如 `[LINE, WEBCHAT]`）；建渠道時 MUST 檢查 `channelType` 在白名單內，否則擋。
- 空/null = 不限制（既有方案零影響）。

### D. 可擴展性 — 功能清單動態化（讓未來新功能自動可納入分級）
- 現況破口：平台後台方案頁的功能清單（`ALL_FEATURES`）與標籤/說明**寫死在前端**，後端加新 feature/權限點不會自動反映 → 每加新功能都要手改前端、易漏。
- 新增端點吐「功能 + 權限點 registry」（feature slug/label/desc + 各 feature 下的權限點 code/label），前端方案頁**動態載入**，不再寫死。
- 效果：未來加新功能只需在後端 `@open333crm/core`（features + permissions registry）加定義，平台後台方案頁**自動**顯示可勾選/可 deny，無需改前端。這是「新功能可設定加入哪個方案」的架構保證。

## Capabilities

### New Capabilities
- `granular-plan-entitlement`: 方案天花板的權限點層級細分（A）與渠道 provider/數量限制（B、C）。

### Modified Capabilities
- `tenant-entitlement`: 有效權限天花板的計算從「feature → 權限點」擴展為「feature → 權限點，再套權限點層級覆寫」（A 改變天花板計算 requirement）。
- `plan-limits`: 新增 `maxChannels` 數值上限與建渠道硬擋（B）。

## Impact

- **Schema**：`Plan` 加 `permissionOverrides Json`（權限點層級細分）、`allowedChannelTypes Json`（渠道白名單）；`plan.limits` 用既有 Json 加 `maxChannels`。migration 非破壞性（皆 nullable/default）。
- **後端**：`permission.service` 的 `getEffectiveTenantPermissions` 天花板計算加權限點覆寫；`channel.service.createChannel` 加 maxChannels 硬擋 + allowedChannelTypes 檢查；平台方案更新 service/route 加新欄位。
- **前端**：平台後台方案頁——feature 下可展開勾權限點（A）、渠道白名單多選（C）、maxChannels 數值（B）。
- **無破壞性**：既有方案（無覆寫/白名單/maxChannels）行為完全不變。
- **依賴**：延伸 `platform-control-plane`、`rbac-granular-permissions`（權限點體系）。
- **分階段建議**：B（maxChannels，最簡）→ C（allowedChannelTypes）→ A（權限點細分，最複雜，影響天花板計算核心）。
