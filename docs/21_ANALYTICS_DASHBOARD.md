# 21 — 報表 & 數據儀表板設計（Analytics Dashboard）

## 目標受眾

| 角色 | 需要看什麼 |
|------|-----------|
| 客服主管（Supervisor）| 團隊每日表現、SLA 達成率、Case 積壓量、客服個人績效 |
| 企業負責人（Admin）| 整體服務品質趨勢、CSAT 趨勢、渠道訊息量 |
| 客服人員（Agent）| 自己的工作量、自己的 CSAT 分數 |

---

## 儀表板畫面（ASCII Wireframe）

### 主儀表板（Supervisor / Admin）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  📊 數據儀表板            [今天▼] [本週] [本月] [自訂範圍]   匯出 CSV        │
├────────────┬────────────┬────────────┬────────────┬──────────────────────────┤
│  今日訊息量 │  開啟案件   │  SLA 達成率 │  CSAT 分數  │                          │
│            │            │            │            │                          │
│   1,247    │    19      │   87.3%    │   4.2 / 5  │                          │
│  ▲+12%     │  🔴 2 緊急 │  ▼-3.1%   │  ▲+0.3    │                          │
│  vs 昨天   │  🟡 5 高   │  vs 上週   │  vs 上週   │                          │
├────────────┴────────────┴────────────┴────────────┤                          │
│                                                    │                          │
│  訊息量趨勢（7 天）                                 │                          │
│   300│              ╭──╮                          │                          │
│   200│         ╭────╯  ╰──╮                       │                          │
│   100│    ╭────╯           ╰────╮                 │                          │
│     0└────┴────────────────────┴──               │                          │
│        Mo  Tu  We  Th  Fr  Sa  Su                 │                          │
│        —— LINE  …… FB  ─ ─ WebChat                │                          │
│                                                    │                          │
└────────────────────────────────────────────────────┘

┌──────────────────────────────┬───────────────────────────────────────────────┤
│  案件分類分布（本月）         │  客服個人績效（本月）                          │
│                               │                                               │
│  維修申請  ████████  47%      │  姓名    處理案件  平均回應  CSAT  SLA達成     │
│  保固查詢  █████     31%      │  王客服    43      8分鐘     4.5   91%        │
│  購買諮詢  ███       14%      │  李助理    38      12分鐘    4.1   87%        │
│  投訴      ██         8%      │  陳小芳    29      6分鐘     4.7   95%        │
│                               │  💡 陳小芳 本月表現最佳                      │
└──────────────────────────────┴───────────────────────────────────────────────┘
```

### Agent 個人工作台（Inbox 右上角或獨立頁）

```
┌──────────────────────────────────────────────────────┐
│  我的本月績效                                          │
│  ─────────────────────────────────────────────────── │
│  處理案件：43 個     解決率：95%                       │
│  平均首次回應：8 分鐘    目標：< 10 分鐘  ✅           │
│  CSAT 評分：4.5 / 5      本組最高 🏆                  │
│  SLA 達成：91%            目標：> 90%  ✅              │
│                                                        │
│  待處理案件：7 個（今天）                              │
│  🔴 1 個 SLA 剩 < 30 分鐘  → [立即處理]              │
└──────────────────────────────────────────────────────┘
```

---

## 報表模組清單

### 1. 概覽儀表板（Overview Dashboard）

| 指標 | 說明 | 時間維度 |
|------|------|---------|
| 總訊息量 | 所有渠道收發訊息數 | 日/週/月 |
| 開啟案件數 | 目前狀態為 open/in_progress 的 Case | 即時 |
| SLA 達成率 | (按時解決 / 所有已解決) × 100 | 日/週/月 |
| 平均首次回應時間 | 案件建立 → 第一次 Agent 回覆的中位數時間 | 日/週/月 |
| 平均解決時間 | 開案 → 關閉的中位數時間 | 日/週/月 |
| CSAT 分數 | 4~5 分比例（非平均分）| 日/週/月 |

### 2. 案件報表（Case Report）

| 指標 | 說明 |
|------|------|
| 案件量趨勢 | 每日開案/關案折線圖 |
| 案件分類分布 | 維修/查詢/投訴 的 Pie Chart |
| 案件平均週期 | 各分類的平均開到關時間 |
| SLA 違規案件清單 | 超時案件 + 負責人 |
| 升級案件率 | Escalated / Total |

### 3. 客服績效報表（Agent Performance）

| 指標 | 說明 |
|------|------|
| 處理案件數 | 各 Agent 本月負責的案件數 |
| 平均首次回應 | 各 Agent 的平均回應速度 |
| CSAT 分數 | 各 Agent 收到的 CSAT 平均分 |
| SLA 達成率 | 各 Agent 的 SLA 達成率 |
| 線上時間 | 各 Agent 的在線時長（需前端心跳追蹤）|

### 4. 渠道分析（Channel Analytics）

| 指標 | 說明 |
|------|------|
| 各渠道訊息量 | LINE / FB / WebChat 比較 |
| 各渠道首次回應時間 | 哪個渠道客服反應最快 |
| 用戶追蹤/取消追蹤趨勢 | LINE OA 成長曲線 |
| Bot vs 人工分流比 | Bot 自己處理的比例 |

### 5. 聯繫人分析（Contact Analytics）

| 指標 | 說明 |
|------|------|
| 新增聯繫人數（月） | 成長趨勢 |
| 聯繫人來源分布 | 哪個渠道帶來多少聯繫人 |
| 活躍聯繫人 | 近 30 天有互動的聯繫人數 |
| 標籤分布 | 各標籤的聯繫人數 |

### 6. AI 輔助績效報表 (AI Copilot Analytics)

| 指標 | 說明 |
|------|------|
| AI 採用率 (Adoption Rate) | (被採用的建議數 / 總建議數) × 100% |
| 客服修正率 (Correction Rate) | 客服採用建議後，修改文字的比例 |
| 最有價值文章 (Top KM Articles) | 哪些 KM 文章生成的建議最常被採用 |

---

## 資料計算策略

### 即時指標（Real-time）
直接查 PostgreSQL，加上適當 Index：
- 開啟案件數、未讀訊息數、今日新訊息

### 週期匯總指標（Pre-aggregated）
每天凌晨定時 Job 跑統計，結果存入 `daily_stats` Table：

```prisma
model DailyStat {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId        String   @db.Uuid
  date            DateTime @db.Date
  statType        String   // 'overview' | 'channel' | 'agent' | 'case'
  dimensionId     String?  // agentId or channelId（當 statType 是 agent/channel 時）
  data            Json     // 當日各指標的 JSON
  createdAt       DateTime @default(now())

  @@unique([tenantId, date, statType, dimensionId])
  @@map("daily_stats")
}
```

優點：報表查詢秒出，不重壓 DB；可保留歷史數據長期趨勢。

---

## 報表 API

```
GET /api/v1/analytics/overview
  ?from=2026-03-01&to=2026-03-11

GET /api/v1/analytics/cases
  ?from=&to=&groupBy=day|week|month&category=

GET /api/v1/analytics/agents
  ?from=&to=&agentId=   # 不帶 agentId 則回傳全團隊

GET /api/v1/analytics/channels
  ?from=&to=&channelId=

GET /api/v1/analytics/contacts
  ?from=&to=

GET /api/v1/analytics/marketing
  ?from=&to=&campaignId=

GET /api/v1/analytics/my              # 我自己的績效（Agent 用）

POST /api/v1/analytics/export         # 匯出 CSV
  Body: { reportType, from, to, filters }
```

---

## 前端圖表技術

使用 **Recharts**（React 生態，輕量）：
- `LineChart` — 訊息量趨勢、CSAT 趨勢
- `BarChart` — 客服績效比較
- `PieChart` / `DonutChart` — 案件分類分布、渠道分布
- `RadialBarChart` — SLA 達成率圓環
- 顏色系統統一使用設計系統 Token
