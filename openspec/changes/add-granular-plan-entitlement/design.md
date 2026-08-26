## Context

現有平台 entitlement：`getEffectiveTenantPermissions(roleId, planId)` = 角色權限 ∩ `permsForFeatures(plan.features ∪ core)`。天花板粒度到「feature 展開的權限點集合」。`plan.limits`（Json）已支援數值上限（maxAgents/maxTags/monthlyTokens）+ `Tenant.limitOverrides` 單租戶覆寫。渠道有 `channelType`（LINE/WEBCHAT/FB/THREADS...），但建渠道無任何 provider/數量限制。

競品 Omnichat 用「整功能開關 + 數量上限 + 功能點細分（能看不能匯出）+ 渠道限制（連得上 vs 能自動化 / 渠道種類）」混合分級（見 proposal 引用）。本 change 補齊 open333 缺的三塊：功能點細分（A）、渠道數量（B）、渠道 provider（C）。

## Goals / Non-Goals

**Goals:**
- 方案天花板可細到權限點（A）：如「開 marketing 但關 broadcast」「開 analytics 但關 export」。
- 渠道可限數量（B）與 provider 種類（C）。
- 三塊皆對既有方案零影響（無設定 = 現行行為）。
- 複用既有機制（權限點體系、plan.limits、天花板交集），不另造平行系統。

**Non-Goals:**
- 不做「渠道連得上但不能觸發 bot」這種 Omnichat 式的渠道功能深度分級（那需在 bot router 加 entitlement 判斷，另議；本 change 的渠道限制是「能不能建該類渠道」與「數量」）。
- 不做租戶端可見的方案比較頁（那是行銷頁，另做）。
- 不改角色 RBAC（權限點細分是「方案天花板」層，非「角色授權」層——兩者仍交集）。

## Decisions

### 1. A（功能點細分）用「feature + 權限點覆寫」而非純權限點清單
天花板 = `permsForFeatures(features)` 再套 `permissionOverrides`（權限點層級的 allow/deny 覆寫）。
- 為何不改成「plan 直接存一組權限點」丟掉 feature：feature 是給人看的分組（UI/計費/行銷都用 feature），丟掉會讓方案難懂、破壞既有 UI。保留 feature 當基底、覆寫當微調，最小改動、向後相容。
- `permissionOverrides` 形狀：`{ deny: string[] }`（先只支援「在 feature 內關掉個別權限點」，如開 marketing 但 deny marketing.broadcast）。**先不做 allow**（在 feature 外額外開權限點）——allow 會讓天花板超出 feature 語意、複雜且少用；deny 覆蓋 Omnichat 的「能看不能匯出」情境已足夠。
- 有效天花板 = `permsForFeatures(features) 減去 permissionOverrides.deny`。dependsOn/implies 閉包：deny 一個高階權限點不自動 deny 其 implies 的低階（如 deny broadcast 不影響 marketing.view），符合直覺。

### 2. B（maxChannels）純複用 plan.limits
`plan.limits.maxChannels`（number|null，null=無上限），建渠道時 `getEffectiveLimit(override ?? plan, 'maxChannels')` + count 硬擋，比照 maxAgents 現有作法。零新機制。

### 3. C（allowedChannelTypes）獨立白名單欄位
`Plan.allowedChannelTypes Json`（`string[]`，如 `['LINE','WEBCHAT']`；空陣列或 null = 不限制）。
- 為何獨立欄位而非塞進 features/limits：channelType 是「資料維度」，不是權限點（功能維度）、也不是數量。業界（Schematic/Dodo）明確建議資源限制與 feature flag 分開。塞進 features 會污染權限點語意。
- 建渠道時檢查 `channelType ∈ allowedChannelTypes`（或白名單空則放行），否則 `CHANNEL_TYPE_NOT_ALLOWED` 403。
- 單租戶覆寫：先不做（plan 層級即可；若日後要 per-tenant 放行特定渠道，比照 limitOverrides 加）。

### 4. 天花板計算的快取失效
A 改變 `getEffectiveTenantPermissions` 的結果，快取 key `perms:tenant:{roleId}:{planId}` 已含 planId；改 plan.permissionOverrides 時須失效該 plan 的快取（比照現有改 plan.features 的 `invalidatePlanPermissions`）——把 permissionOverrides 納入同一失效路徑。

### 5. 執行點：全部在既有 guard / service，不新增中間層
- A：`getEffectiveTenantPermissions` 加一步減 deny。所有 requirePermission guard 自動生效（不需改路由）。
- B/C：`channel.service.createChannel` 加兩個檢查（count + type 白名單）。單一執行點，不散落。

### 6. D（可擴展性）— registry 動態端點 + 單一資料源
- **問題**：前端 `ALL_FEATURES`/`FEATURE_LABELS`/`FEATURE_DESC` 寫死，是「新功能自動納入分級」的唯一破口。後端 feature→權限已是 `buildFeaturePerms()` 自動推導（單一資料源），前端卻另維護一份 → 會漂移。
- **解**：新增 `GET /api/v1/platform/registry`（或併入既有平台端點），吐 `{ features: [{slug,label,desc,perms:[{code,label}]}], channelTypes: [...] }`——由 `@open333crm/core` 的 FEATURES + permissions registry 動態組出。前端方案頁改為載入此端點，不再寫死。
- **label/desc 的家**：feature 的 label 已在 core `FEATURES`；desc（如「收件匣、案件…」）目前只在前端。決策：把 desc 移進 core `FEATURES` 定義（加 `desc?` 欄位），讓 registry 端點統一吐出，前端零維護。權限點 label 已在 permissions registry。
- **channelTypes 也動態**：白名單多選的可選項（LINE/WEBCHAT/FB/THREADS...）由 registry 端點吐（來自 Prisma enum 或 core 常數），未來加新渠道類型自動出現。
- **效果**：加新功能 = 在 core 加 feature/權限點定義（＋desc）→ 平台後台方案頁自動可設定。前端方案頁不需再改。這是本 change 對「未來擴展」的核心保證，也順帶修掉現有前端寫死的技術債。

## Risks / Trade-offs

- **A 改動天花板計算核心**：`getEffectiveTenantPermissions` 是所有 guard 的天花板來源，改錯影響全租戶權限。緩解：deny 是「減法」（只會更嚴、不會放寬），最壞情況是誤擋（可查覺、可回復），不會誤放行（安全方向正確）；充分測試；既有無 override 方案 deny 為空、結果不變。
- **deny 與 dependsOn 的語意**：deny 高階權限點時，前端角色矩陣若仍讓角色勾該權限、但天花板擋掉 → 角色「有此權限但用不了」。這是天花板 ∩ 角色的正常結果（角色權限 ∩ 天花板），但 UI 可能需提示「此權限被方案限制」。列為前端優化，非阻斷。
- **allowedChannelTypes 對既有渠道**：白名單縮小後，既有「已建但現在不允許」的渠道怎麼辦？決策：**只擋新建，不影響既有渠道運作**（避免縮方案就讓客戶現有渠道全掛）。spec 明列。
- **channelType enum 演進**：未來加新渠道類型（如 WhatsApp），白名單要能容納。用字串陣列（非 enum 限定）較有彈性，但要驗證值合法（在已知 channelType 內）。
- **三塊一起做風險大**：建議照 proposal 分階段（B→C→A），B/C 簡單風險低可先上，A 最複雜最後做並充分驗證。
