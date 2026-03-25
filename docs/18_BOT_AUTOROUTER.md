# 18 — Bot 模式 + 人工接管邏輯（Auto-Router）

## 設計目標

客戶傳訊息進來，系統要決定：
- **誰來接？** Bot 自動回 or 人工客服接手
- **什麼時候切換？** Bot 答不了 → 升人工；人工處理完 → 可還給 Bot
- **怎麼判斷？** 關鍵字 / LLM 信心值 / 時段 / 客服在線狀態

---

## Conversation 路由狀態機：Copilot 優先 (修正版)

```ascii
[ 訊息進來 ]
     │
     ▼
┌──────────────────┐
│ Auto-Router 判斷 │
└────────┬─────────┘
         │
         ├─ (1) 非辦公時間？ ───────▶ [自動] 發送離線訊息
         │
         ├─ (2) 命中精確關鍵字？ ───▶ [自動] FAQ 固定回覆
         │
         └─ (3) 其他所有情況 ─────▶ [輔助] 觸發 AI Copilot
                                         │
                                         ▼
                                     [客服 Inbox 面板顯示建議]
```

**核心原則**：辦公時間內，Bot 永遠不主動回覆，只提供「建議」給人工客服。

---

## Bot 回覆的兩種模式 (修正版)

### 模式 A：自動回覆 (Auto-Reply) — **低風險場景**
- **時機**: 服務時間外、命中精確關鍵字（如 "地址", "營業時間"）。
- **目的**: 提供基本資訊、安撫客戶。

### 模式 B：建議回覆 (AI Copilot) — **辦公時間常態**
- **時機**: 所有需要理解語意的複雜對話。
- **流程**:
    1. LLM+KM 生成 1-3 個建議回覆。
    2. 顯示在客服前端面板。
    3. 客服點擊「採用 (Adopt)」，可選擇編輯後發送。
- **責任**: 由**人工客服**承擔最終發送內容的責任。

---

## 人工介入 (Handoff) 邏輯
在 Copilot 模式下，「升人工」轉變為「請求人類關注」。

### 自動觸發條件
- **AI 建議品質差**: 客服連續 3 次點擊「刷新建議」。
- **客戶明確要求**: 輸入「真人」、「客服」等關鍵字。
- **SLA 預警**: 對話超過 10 分鐘未被指派。
- **觸發後動作**: 發送「小鈴鐺」通知給 Supervisor 或指定群組。

### 手動觸發
- 客戶點擊 Bot 提供的「聯繫真人客服」按鈕。
- 客服在後台手動將對話指派給自己或他人。

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
