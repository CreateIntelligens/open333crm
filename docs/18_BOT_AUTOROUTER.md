# 18 — Bot 模式 + 人工接管邏輯（Auto-Router）

## 設計目標

客戶傳訊息進來，系統要決定：
- **誰來接？** Bot 自動回 or 人工客服接手
- **什麼時候切換？** Bot 答不了 → 升人工；人工處理完 → 可還給 Bot
- **怎麼判斷？** 關鍵字 / LLM 信心值 / 時段 / 客服在線狀態

---

## Conversation 路由狀態機

```
新訊息進來
     │
     ▼
┌────────────────────────────────────────────────┐
│  Auto-Router 判斷                               │
│                                                 │
│  1. 客服在線 + 無 Bot 設定？ ─────────────────→  直接 AGENT_HANDLED
│  2. 有 Bot 設定 + 非辦公時間？ ───────────────→  BOT_HANDLED（離線Bot）
│  3. 有 Bot 設定 + 辦公時間？ ──────────────────→  BOT_HANDLED（嘗試自動回）
│  4. 無任何設定？ ──────────────────────────────→  ACTIVE（等待客服）
└────────────────────────────────────────────────┘

ConversationStatus 流轉：

ACTIVE ──────────────── 客服主動接手 ──────────→ AGENT_HANDLED
  │                                                 │
  │ Bot 設定啟動                                    │ 客服標記「還給 Bot」
  ▼                                                 │
BOT_HANDLED ← ──────────────────────────────────── ┘
  │
  ├─ Bot 有把握回答 ────────────────────────→ 繼續 BOT_HANDLED，回覆
  │   (LLM confidence > 閾值 or 關鍵字命中)
  │
  └─ Bot 無把握 / 觸發升人工條件 ─────────→ AGENT_HANDLED（通知客服）

任何狀態 ─── 對話結束 ──────────────────────────→ CLOSED
```

---

## Bot 回覆的兩種模式

### 模式 A：關鍵字 + 固定回覆（簡單、可預測）

```typescript
interface KeywordReplyRule {
  keywords: string[];        // 觸發詞（含正規表達式）
  matchMode: 'any' | 'all';
  replyType: 'text' | 'template';
  replyContent: string | { templateId: string; variables?: Record<string, string> };
  priority: number;          // 多條規則衝突時，優先序高的優先
}
```

範例（家電業者）：
```
關鍵字: ["保固", "保固期", "幾年保固"]
回覆: "您好！XX家電標準保固為1年，可加購3年延伸保固。
      請問您的產品型號是？我幫您查詢確切保固狀況。"

關鍵字: ["預約", "維修預約", "上門"]
回覆: [Flex模板：維修預約卡（含選擇時段按鈕）]
```

### 模式 B：LLM + KM 語義回覆（智慧、成本高）

```
Bot 收到訊息
  │
  ▼
1. 搜尋 KM 知識庫（語義搜尋，Top-3）
  │
  ├─ 有匹配（similarity > 0.75）
  │   └─ LLM 組裝回答 + 信心值評估
  │       ├─ confidence > 0.8 → Bot 直接回覆
  │       └─ confidence 0.5~0.8 → Bot 回覆 + 附「需要更多協助？[聯繫客服]」
  │
  └─ 無匹配（或 similarity < 0.5）
      └─ 升人工（觸發 handoff）
```

### 實際上的組合策略（建議）

```
優先順序：
1. 關鍵字規則（最快，免費）
2. LLM 語義回覆（較慢，消耗 Token）
3. 升人工兜底

每個渠道可個別設定：botMode = 'keyword' | 'llm' | 'keyword_then_llm' | 'off'
```

---

## 升人工（Handoff）觸發條件

### 自動升人工
| 條件 | 說明 |
|------|------|
| Bot 連續 2 次回覆後，客戶再問 | 視為 Bot 答不了 |
| LLM confidence < 0.5 | 系統知道自己不確定 |
| 客戶輸入特定關鍵字 | "真人", "客服", "人工", "不想跟機器人講" |
| 客戶傳送圖片/檔案 | Bot 通常無法處理，直接升人工 |
| 情緒分析偵測到負面情緒 | 需要 LLM sentimentAnalysis 功能 |
| Automation Rule 設定的條件 | 如：VIP 客戶永遠直接人工 |

### 手動升人工
- 客戶點「聯繫客服」快速回覆按鈕（Postback）
- Bot 主動提示：「需要真人協助嗎？」→ 客戶確認

---

## Handoff 流程詳細

```
升人工觸發
  │
  ▼
1. 系統發送「銜接訊息」給客戶
   → "稍等，正在為您轉接客服人員，平均等待時間約 3 分鐘"

2. 對話狀態切換：BOT_HANDLED → ACTIVE（或直接 AGENT_HANDLED）

3. 通知可用客服人員（依 Assign 策略）
   ├─ Round Robin：輪流
   ├─ 最少負荷：目前 Case 數最少的 Agent
   └─ 技能匹配：維修問題 → 有「技術支援」技能的 Agent

4. Agent 收到通知，接受對話
   → 對話狀態 → AGENT_HANDLED
   → Bot 停止自動回覆

5. Agent 介面顯示：
   - Bot 對話摘要（LLM 自動生成）
   - 本次對話 Bot 嘗試回覆的內容（透明）
```

---

## 辦公時間設定

```typescript
interface OfficeHours {
  timezone: string;           // 'Asia/Taipei'
  weekdays: number[];         // [1,2,3,4,5] = 週一到週五
  startTime: string;          // '09:00'
  endTime: string;            // '18:00'
  holidays: string[];         // ['2025-01-01', '2025-02-28'] 國定假日
}
```

**非辦公時間 Bot 行為：**
```
客戶傳訊息（非辦公時間）
  → Bot 自動回：
    "您好！目前是非服務時間（服務時間：週一至週五 09:00–18:00）
     您的訊息已記錄，我們將於下一個工作日優先回覆您。
     如有緊急維修需求，請撥打服務專線：0800-XXX-XXX"
  → 建立 Case（status: PENDING）
  → 下個工作日開始時通知 Supervisor 有待處理案件
```

---

## 各渠道 Bot 能力差異

| 功能 | LINE | FB | WebChat |
|------|------|----|---------|
| 文字回覆 | ✅ | ✅ | ✅ |
| Flex/模板 | ✅ | ✅(有限) | ✅(自製) |
| 快速回覆按鈕 | ✅ | ✅ | ✅ |
| 圖片發送 | ✅ | ✅ | ✅ |
| 接收圖片後升人工 | ✅ | ✅ | ✅ |
| 語音訊息 | 接收但升人工 | 接收但升人工 | ❌ |

---

## DB 相關欄位

`Channel.settings` JSONB 中擴充：
```json
{
  "botEnabled": true,
  "botMode": "keyword_then_llm",
  "handoffKeywords": ["客服", "真人", "人工"],
  "maxBotRepliesBeforeHandoff": 2,
  "officeHours": {
    "timezone": "Asia/Taipei",
    "weekdays": [1,2,3,4,5],
    "startTime": "09:00",
    "endTime": "18:00"
  },
  "offlineMessage": "目前是非服務時間...",
  "handoffMessage": "正在為您轉接客服..."
}
```

`Conversation` 新增欄位（補到 DB Schema）：
```prisma
botRepliesCount   Int      @default(0)   // Bot 已回覆次數
handoffReason     String?               // 升人工原因記錄
```
