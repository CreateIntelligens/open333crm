# 19 — CSAT 滿意度調查設計

## 流程總覽

```
Case Resolved（客服標記已解決）
  │
  ▼
系統等待 [可設定延遲，預設 30 分鐘]
  │
  ▼
發送 CSAT 調查訊息（依渠道格式）
  │
  ├─ 客戶回覆評分 → 記錄分數 → 可選填文字回饋 → Case 正式 CLOSED
  │
  └─ 客戶 72 小時未回覆 → Case 自動 CLOSED（不計 CSAT）
```

---

## 調查訊息設計（依渠道）

### LINE — Flex Message 星星評分卡

```json
{
  "type": "bubble",
  "body": {
    "type": "box",
    "layout": "vertical",
    "contents": [
      { "type": "text", "text": "感謝您的耐心！", "weight": "bold", "size": "lg" },
      { "type": "text", "text": "請問這次服務您是否滿意？", "wrap": true },
      {
        "type": "box",
        "layout": "horizontal",
        "contents": [
          { "type": "button", "action": { "type": "postback", "label": "⭐", "data": "csat:1:{{caseId}}" } },
          { "type": "button", "action": { "type": "postback", "label": "⭐⭐", "data": "csat:2:{{caseId}}" } },
          { "type": "button", "action": { "type": "postback", "label": "⭐⭐⭐", "data": "csat:3:{{caseId}}" } },
          { "type": "button", "action": { "type": "postback", "label": "⭐⭐⭐⭐", "data": "csat:4:{{caseId}}" } },
          { "type": "button", "action": { "type": "postback", "label": "⭐⭐⭐⭐⭐", "data": "csat:5:{{caseId}}" } }
        ]
      }
    ]
  }
}
```

### FB / WebChat — Quick Reply 按鈕

```
感謝您的耐心！這次服務您滿意嗎？

[😡 非常不滿] [😞 不滿意] [😐 普通] [🙂 滿意] [😄 非常滿意]
```

---

## 客戶回覆後的互動

### 1~2 分（不滿意）— 主動挽救
```
謝謝您的回饋 😢
很抱歉未能讓您滿意，我們非常重視您的意見。
請問方便告訴我們哪裡可以改進嗎？

[📝 留下意見]   [不用了，謝謝]
```
→ 同時通知 Supervisor：「低滿意度案件 #XXXX，請關注」

### 3 分（普通）
```
謝謝您的回饋！我們會繼續努力提升服務品質。
如有任何問題歡迎隨時聯繫我們 😊
```

### 4~5 分（滿意）
```
謝謝您的好評！😄 您的肯定是我們最大的動力！
如有需要，歡迎再次光臨 XX家電服務 🏠
```
→ 可選：觸發「好評回饋」Automation（如：送積點 / 推薦優惠）

---

## CSAT Postback 處理邏輯

```typescript
// Channel Plugin 收到 Postback
function handleCsatPostback(data: string) {
  // data 格式：'csat:{score}:{caseId}'
  const [, score, caseId] = data.split(':');
  await caseService.recordCsat(caseId, parseInt(score));
  await caseService.close(caseId, 'csat_received');
  await sendFollowUpMessage(score, caseId);
}
```

---

## DB Schema 補充

```prisma
// Case model 已有
csatScore      Int?         // 1~5，null = 未回覆
csatComment    String?      // 文字回饋
csatRespondedAt DateTime?   // 客戶回覆時間
```

---

## 設定項目（每個 Tenant 可自訂）

| 設定 | 預設值 | 說明 |
|------|--------|------|
| `csatEnabled` | true | 是否啟用 CSAT |
| `csatDelayMinutes` | 30 | Resolved 後幾分鐘發送 |
| `csatAutoCloseHours` | 72 | 無回應幾小時後自動關閉 |
| `csatLowScoreThreshold` | 2 | 幾分以下通知 Supervisor |
| `csatLowScoreNotifyAgent` | true | 是否也通知負責的 Agent |

---

## CSAT 報表指標

| 指標 | 算法 |
|------|------|
| CSAT Score | 回覆中 4~5 分的比例（不是平均分）|
| 平均評分 | 所有回覆的算術平均 |
| 回覆率 | 收到 CSAT 訊息後有回覆的比例 |
| 低分案件數 | 1~2 分案件總數（本月）|
| 低分 Agent 排行 | 哪個 Agent 的低分案件最多 |
