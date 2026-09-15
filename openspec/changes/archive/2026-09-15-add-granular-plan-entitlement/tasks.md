## 1. 階段 B — 渠道數量上限（最簡，先做）

- [x] 1.1 前端方案頁 `LIMIT_KEYS` 加 `maxChannels`（label「渠道數上限」）——複用既有數值上限 UI
- [x] 1.2 `channel.service.createChannel` 加 maxChannels 硬擋：`getEffectiveLimit(override ?? plan.limits, 'maxChannels')`，達上限拋 `PLAN_LIMIT_EXCEEDED` 403（比照 agent.service 的 maxAgents）
- [x] 1.3 後端 plan 更新 schema 的 limits 已支援任意 key（確認 maxChannels 走既有路徑）
- [x] 1.4 驗證：方案設 maxChannels=1，建第 2 個渠道 → 403；null → 不擋

## 2. 階段 C — 渠道 provider 白名單

- [x] 2.1 `Plan` schema 加 `allowedChannelTypes Json @default("[]")`；migration（非破壞性）
- [x] 2.2 `channel.service.createChannel` 加白名單檢查：白名單非空且 channelType 不在內 → `CHANNEL_TYPE_NOT_ALLOWED` 403；只擋新建，不影響既有渠道
- [x] 2.3 平台 plan 更新 service/route/schema 加 `allowedChannelTypes`（Zod 驗證值為合法 channelType）
- [x] 2.4 前端方案頁加渠道類型多選（LINE/WEBCHAT/FB/THREADS...），空=不限制
- [x] 2.5 驗證：只允許 LINE 的方案建 FB → 403；建 LINE → 允許；既有 FB 渠道仍運作；空白名單不擋

## 3. 階段 D — 功能清單動態化（可擴展性地基，建議先做）

- [x] 3.1 `@open333crm/core` 的 `FEATURES` 定義加 `desc?` 欄位（把前端 FEATURE_DESC 的說明移進 core，單一資料源）
- [x] 3.2 新增 `GET /api/v1/platform/registry`：吐 `{ features:[{slug,label,desc,perms:[{code,label}]}], channelTypes:[...] }`，由 core FEATURES + permissions registry + channelType 動態組出（platform superuser 保護）
- [x] 3.3 前端方案頁改為載入此端點取代寫死的 `ALL_FEATURES`/`FEATURE_LABELS`/`FEATURE_DESC`
- [x] 3.4 驗證：於 core 加一個測試 feature/權限點 → 方案頁自動出現、可勾選（不改前端）；確認 channelTypes 也動態

## 4. 階段 A — 功能點層級細分（最複雜，最後做）

- [x] 3.1 `Plan` schema 加 `permissionOverrides Json @default("{}")`（形狀 `{ deny: string[] }`）；migration
- [x] 3.2 `permission.service` 的 `getEffectiveTenantPermissions` 天花板計算：`permsForFeatures(features)` 後減去 `permissionOverrides.deny`（deny 高階不連坐低階）
- [x] 3.3 改 `permissionOverrides` 時失效該方案快取（納入 `invalidatePlanPermissions` 路徑）
- [x] 3.4 平台 plan 更新 service/route/schema 加 `permissionOverrides`（Zod 驗證 deny 值為合法權限碼）
- [x] 3.5 前端方案頁：每個勾選的 feature 下可展開列出其權限點，逐點可 deny（取消勾＝deny）；未展開/未 deny＝該 feature 全展開
- [x] 3.6 驗證：deny marketing.broadcast → 該方案租戶群發被擋、行銷其他仍可用；deny analytics.export → 能看不能匯出；無 override → 天花板不變

## 5. 共同驗證

- [x] 4.1 typecheck（api + web）EXIT 0
- [x] 4.2 端到端：三塊各自的擋/放行情境（見各階段驗證）
- [x] 4.3 回歸：既有方案（無 override / 空白名單 / 無 maxChannels）行為完全不變——挑一個既有租戶確認權限天花板、建渠道不受新機制影響
- [x] 4.4 快取一致性：改方案設定後即時生效（權限天花板 / 渠道限制）
- [x] 4.5 更新 CHANGELOG.md（Added：方案細粒度分級——功能點 deny、渠道數量、渠道 provider 白名單）
