## Context

現有系統已實現基礎的多渠道插件架構（[`docs/03_CHANNEL_PLUGIN.md`](docs/03_CHANNEL_PLUGIN.md)），支援 LINE OA、Facebook Messenger、Web Chat，並已有 WhatsApp 的未來規劃。然而存在以下問題：

1. **新渠道擴充困難**：目前缺乏 Telegram、Threads 等新興渠道的支援
2. **授權機制粗粒度**：現有 License JSON（[`docs/14_BILLING_AND_LICENSE.md`](docs/14_BILLING_AND_LICENSE.md)）僅以布林值控制渠道開通，無數量限制與彈性定價
3. **多部門支持不足**：無法依 teamId 匹配不同部門的授權額度
4. **額外計費不明**：部分渠道（如 WhatsApp、Messenger）有額外訊息費用，缺乏分攤機制

## Goals / Non-Goals

**Goals:**
- 新增 Telegram、Threads 渠道插件，延續現有 Plugin 架構
- 擴展 License JSON 結構，支援渠道維度的數量限制與額外費用參數
- 實現多部門（Team）授權管理，支援 teamId 匹配與獨立額度
- 建立渠道使用量追蹤與費用分攤機制
- 提供渠道使用報表給管理員

**Non-Goals:**
- 重新設計現有的 Channel Plugin 介面（保持向後相容）
- 實現支付閘道（仍使用現有 Credits 機制）
- 支援即時訊息費用預扣（僅記錄後續結算）

## Decisions

### D1: 渠道 Plugin 向後相容

**決定**: 新渠道（Telegram、Threads）沿用現有 `ChannelPlugin` 介面，不修改核心定義。

**理由**: 現有 Plugin 架構設計良好，保持介面穩定可減少對現有程式碼的影響。新渠道只需實作 5 個必要方法。

**替代方案**: 
- 修改 Plugin 介面加入新方法 → 需更新所有現有 Plugin，風險過高
- 為新渠道建立獨立的 Plugin v2 → 增加維護成本

---

### D2: License JSON 渠道結構擴展

**決定**: 擴展 `features.channels` 結構，加入數量限制與額外費用參數：

```typescript
interface ChannelFeatures {
  line: boolean | ChannelLimit;
  fb: boolean | ChannelLimit;
  webchat: boolean | ChannelLimit;
  whatsapp: boolean | ChannelLimit;
  telegram: boolean | ChannelLimit;
  threads: boolean | ChannelLimit;
}

interface ChannelLimit {
  enabled: boolean;
  maxCount?: number;           // 最大開通數量
  perTeam?: number;           // 每團隊最大數量
  messageFee?: number;        // 額外訊息費用（每則訊息單價）
  messageFeeCurrency?: string; // 貨幣（USD/TWD）
}
```

**理由**: 
- 向後相容：現有 `true/false` 仍可使用
- 彈性定價：支援按數量收費與訊息費分攤

**替代方案**:
- 完全改用新的 channelsV2 物件 → 需大規模遷移
- 維持現狀僅用布林 → 無法解決計費問題

---

### D3: 多部門授權 - Team ID 匹配

**決定**: 在 License JSON 加入 `teams` 陣列，每個 team 有獨立的額度與渠道配置：

```typescript
interface TeamLicense {
  teamId: string;
  teamName: string;
  channels: ChannelFeatures;
  credits: TeamCredits;
  expiresAt: string;
}

interface LicenseJSON {
  // ... existing fields
  teams?: TeamLicense[];
  defaultTeam?: {
    channels: ChannelFeatures;
    credits: Credits;
  };
}
```

**理由**:
- 支援大型企業的多部門需求
- 各 team 可獨立設定渠道與額度
- 訊息路由時依 teamId 匹配正確的授權

**替代方案**:
- 在 DB 層管理 team 授權 → 需修改權限架構
- 只用一個 license 控制所有 team → 無法滿足多部門需求

---

### D4: 訊息費用分攤機制

**決定**: 
- 渠道發送訊息時，檢查該渠道是否有 `messageFee` 設定
- 若有，記錄 `ChannelUsage` 記錄（channelId, teamId, messageCount, fee）
- 定期產生費用報表，提供給管理員檢視
- 費用從該 team 的 credits 中扣除，或列入帳單結算

**理由**:
- 符合「乙方（平台方）支付費用」的場景：甲方（客戶）使用需額外付費的渠道時，系統記錄費用供結算
- 符合「甲方自己管理」的場景：甲方可在後台設定每個渠道的訊息預算

**替代方案**:
- 即時扣除 → 增加 API 延遲，複雜度提升
- 完全不記錄 → 無法滿足計費需求

---

### D5: Specs 目錄結構

**決定**: 每個 Capability 建立獨立的 spec 目錄：

```
openspec/changes/multi-channel-billing/specs/
├── telegram-channel/
│   └── spec.md
├── threads-channel/
│   └── spec.md
├── channel-billing/
│   └── spec.md
├── team-license/
│   └── spec.md
└── channel-usage-report/
    └── spec.md
```

**理由**: 每個 spec 獨立可維護，團隊可並行開發不同 Capability。

---

### D6: Channel 多部門共用授權 — ChannelTeamAccess 多對多

**決定**: Channel 與 Team 之間採用多對多關係（`ChannelTeamAccess` 中間表），而非在 `Channel` 表直接新增單一 `teamId`。

**說明**：常見企業場景是一個 LINE OA / WhatsApp 帳號由多個部門（客服、業務、售後）共用，但各部門有各自的 Agent 分配、Case 分類與報表。若僅在 Channel 加一個 `teamId`，等同強制 1:1 綁定，無法滿足此需求。

```typescript
// 新增：ChannelTeamAccess 中間表
interface ChannelTeamAccess {
  channelId: string;          // FK → Channel.id
  teamId: string;             // FK → Team.id
  accessLevel: 'full' | 'read_only';  // 控制該部門對此 Channel 的操作權限
  grantedAt: string;          // ISO 8601
  grantedBy: string;          // agentId（Admin）
}
```

**路由邏輯**：新訊息進入時，依 Conversation.teamId（若已存在對話）或 AutomationRule/輪派規則決定歸屬哪個 Team，而非强制 Channel → Team 1:1。

**Channel 建立**：建立 Channel 時，可選填「預設歸屬 Team」，用於沒有對話歷史時的初始路由，但此後可由 Automation 動態調整。

**理由**:
- 符合實際企業多部門共用渠道的需求
- Conversation 層已有 `teamId`，路由控制在對話層而非渠道層更合理
- `ChannelTeamAccess` 提供清晰的授權審計軌跡

**替代方案**:
- Channel 加單一 `teamId` → 限制 1:1，無法共用
- 完全不綁定，靠 Automation 分流 → 缺乏明確授權邊界，管理困難

---

### D7: DB Schema 完整設計

**決定**: 本次 change 需在 `schema.prisma` 新增以下三個模型，並修改現有模型：

#### 新增：`ChannelTeamAccess`（Channel 多部門授權）

```prisma
model ChannelTeamAccess {
  channelId   String      @db.Uuid
  teamId      String      @db.Uuid
  accessLevel String      @default("full")  // full | read_only
  grantedAt   DateTime    @default(now())
  grantedById String?     @db.Uuid          // Agent.id

  channel     Channel     @relation(fields: [channelId], references: [id], onDelete: Cascade)
  team        Team        @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@id([channelId, teamId])
  @@index([teamId])
  @@map("channel_team_accesses")
}
```

#### 新增：`ChannelUsage`（訊息計費記錄）

```prisma
model ChannelUsage {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  channelId    String    @db.Uuid
  teamId       String?   @db.Uuid
  direction    Direction                   // INBOUND | OUTBOUND
  messageCount Int       @default(1)
  feeAmount    Float?                      // null 代表免費渠道
  feeCurrency  String?                     // USD | TWD | null
  recordedAt   DateTime  @default(now())

  channel      Channel   @relation(fields: [channelId], references: [id])
  team         Team?     @relation(fields: [teamId], references: [id])

  @@index([channelId, recordedAt])
  @@index([teamId, recordedAt])
  @@map("channel_usages")
}
```

#### 修改：`Channel`（去除單一 teamId）

```diff
 model Channel {
   // ... 原有欄位不變 ...
-  // ❌ 不在此加 teamId（改用 ChannelTeamAccess 多對多）
+  teamAccesses  ChannelTeamAccess[]
+  usages        ChannelUsage[]
 }
```

#### 修改：`Team`（加入 licenseTeamId 對齊 License JSON）

```diff
 model Team {
   id        String   @id ...
   name      String
+  licenseTeamId  String?   // 對應 License JSON teams[].teamId
   createdAt DateTime ...
 }
```

> **licenseTeamId 說明**：License JSON 中的 `teams[].teamId` 是平台方分配的字串（如 `team_sales`），與 DB UUID 為兩套 ID。`licenseTeamId` 作為對應橋接欄位，`LicenseService.getTeamLicense(teamId)` 時先查 DB `Team` 找到 `licenseTeamId` 再對應 License JSON。

**理由**:
- Schema 先行確保實作有明確依據，避免各自解讀 tasks.md
- `ChannelTeamAccess` 提供 DB 層的授權管理，不依賴 License JSON 的靜態設定
- `ChannelUsage` 結構清晰，支援按渠道、按部門、按時間段的查詢

---

## Risks / Trade-offs

- **[Risk]** 新渠道 API 變更 → **Mitigation**: Plugin 設計隔離外部依賴，API 變更時只改 Plugin
- **[Risk]** Team 額度同步不及時 → **Mitigation**: 使用 Redis 快取，背景定時同步 License
- **[Risk]** 訊息費用計算錯誤 → **Mitigation**: 建立對帳單機制，每月提供明細比對
- **[Risk]** 過多渠道導致管理複雜 → **Mitigation**: 後台提供渠道分組與標籤功能

## Migration Plan

1. **Phase 1: Plugin 擴充** (Week 1-2)
   - 新增 Telegram、Threads Plugin
   - 更新 ChannelType 枚举
   - 本地測試各渠道收發

2. **Phase 2: License 擴展** (Week 3-4)
   - 擴展 License JSON 結構
   - 更新 LicenseService 讀寫邏輯
   - 向後相容測試

3. **Phase 3: Team 授權** (Week 5-6)
   - 新增 Team 資料表
   - 實現 teamId 匹配邏輯
   - 更新訊息路由

4. **Phase 4: 計費機制** (Week 7-8)
   - 建立 ChannelUsage 記錄
   - 實現費用計算邏輯
   - 開發使用量報表

5. **Phase 5: 上線** (Week 9)
   - 逐步上線新功能
   - 監控各項指標
   - 收集客戶回饋

## Open Questions

- Q1: ~~Telegram、Threads 是否需要支援官方 API 驗證（Bot Token / OAuth）？~~
  **✅ DECIDED — 是，且支援多組帳號**：
  - Telegram 使用 **Bot Token** 驗證（每個 Bot 有獨立 Token）
  - Threads/Instagram 使用 **OAuth App Review**（需通過 Meta 審核）
  - **一個 Tenant 可建立多個相同類型的 Channel**（例如多個 LINE OA、多個 Telegram Bot），各自獨立 Bot Token / Credentials，透過 `channels.telegram.maxCount` 授權數量上限控制

- Q2: ~~訊息費用是否需要即時預扣，還是月底結算？~~
  **✅ DECIDED — 即時預扣**：
  - 發送訊息前先檢查 Tenant Credits 餘額，不足則拒絕（`402 INSUFFICIENT_CREDITS`）
  - 發送成功後立即扣除對應費用（`LicenseService.deductCredits()`）
  - 預扣制實作較簡單，避免月底結算的欠費風險

- Q3: ~~Team 數量是否需要上限？超過如何處理？~~
  **✅ DECIDED — 需設上限，Team = 部門**：
  - Q3 說明：「Team」即企業內的「部門」（如客服部、業務部、售後部），一個 Tenant 最多可建立的部門數
  - License JSON 新增 `features.inbox.maxTeams` 欄位控制上限（如 Starter=3, Professional=10, Enterprise=不限）
  - 超過上限時：API 回傳 `402 TEAM_LIMIT_EXCEEDED`，前台顯示警語「部門數量已達授權上限，請升級方案」
  - 部門數量上限由平台方（太上皇）在 License JSON 設定，Tenant 不可自行修改

- Q4: ~~現有客戶是否需要強制遷移至新的 License 結構？~~
  **✅ DECIDED — 全面改用 JSON 物件格式**：
  - 不再支援 `channels.line: true`（boolean）語法，統一改用 `{ enabled: true }` 物件
  - LicenseService 讀取時不再做 boolean fallback 相容
  - 現有客戶 License JSON 由平台方（太上皇後台）統一重新發布，遷移由平台方執行，不需 Tenant 操作

- Q5: ~~`ChannelTeamAccess.accessLevel` 是否需要更細粒度的權限（如：只能讀、可回覆、可廣播）？~~
  **✅ DECIDED — 採三層**：
  - `read_only`：僅能查看入站訊息，不可回覆、不可廣播
  - `reply_only`：可回覆單一對話，不可執行廣播（Broadcast）
  - `full`：完整操作，包含回覆與廣播

- Q6: ~~一個 Channel 若同時被多個 Team 使用，`ChannelUsage` 費用如何分攤給各部門？~~
  **✅ DECIDED — 費用全由主 Tenant 承擔**；`ChannelUsage.teamId` 僅用於報表分析（顯示各部門用量比例），不影響 Credit 計算邏輯。Credit 扣除統一從 Tenant 層級執行。

- Q7: ~~`Team.licenseTeamId` 的對應是否允許一個 License Team 對應多個 DB Team？~~
  **✅ DECIDED — License Credits 由主 Tenant 統一承擔**；Team 層級不設獨立 Credits 額度，License JSON `teams[]` 僅描述各部門可用的渠道類型與數量上限（channel features），費用報表按 teamId 分組顯示供管理員參考。

