# Design Spec: CRM 授權、綁定與里程碑 (11-15) 深度整合

**日期**: 2026-03-25
**主題**: 細化 Roadmap, Template, Channel Binding, Billing 與 License Server 的自動化對接
**目標**: 確保系統具備商業營運能力（計費/授權），同時維持「自動化為中樞」的技術架構。

---

## 1. 核心邏輯：方案 B (Credit Depletion Automation)

當 License 點數不足時，系統不應僅是報錯，而應透過 **Automation Engine** 發出事件，觸發「降級流程」與「即時通知」。

### 1.1 餘額不足通知鏈 (ASCII)
```ascii
[ AI Action 執行 ] ──▶ [ License Guard: 餘額不足 ]
                               │
                               ▼
                    發出事件: license.credits.depleted
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
    [ Action: internal.ui_push ]      [ Action: case.transfer_human ]
    (客服 Inbox 顯示紅色警告)            (自動將對話轉派給人工客服)
```

---

## 2. 模組細化設計

### 2.1 11 — 開發里程碑 (Roadmap)
**調整點**: 提前建立「事件驅動」骨幹。

- **v0.1 (MVP)**: 
    - 建立 **Redis Streams** 事件匯流排。
    - 實作 **Integration Gateway** (外部事件接收)。
    - 基礎 **Automation Engine** (Keyword/Follow 觸發)。
- **v0.2 (Commercialization)**:
    - 實作 **License Server** 整合。
    - 加入 **Credit Guard** 與餘額不足事件處理。

### 2.2 12 — 模板與儲存 (Template & Storage)
**整合點**: 變數動態化與儲存安全性。

- **Template Variable**: 支援 `{{contact.attr.xxx}}` 直接映射到資料庫 `contact_attributes`。
- **Storage Strategy**: 所有 LINE/FB 媒體文件強制走 `publicUrl`，且儲存層具備自動下載 Webhook 媒體的功能，防止連結過期。

### 2.3 13 — 渠道綁定 (Channel Binding)
**整合點**: 多部門 (Team) 授權與安全校驗。

- **Team Whitelist**: 綁定渠道時，管理員必須勾選「授權存取部門」。
- **Webhook Verify**: 系統自動生成強強度 `verifyToken`，並在綁定成功後鎖定。

### 2.4 14 & 15 — 授權與計費 (Billing & License Server)
**整合點**: 「太上皇」控制層與即時扣點。

- **License JSON**: 加入 `automation.maxRules` 與 `marketing.maxBroadcasts` 限制欄位。
- **Real-time Deduction**: AI 動作執行完畢後，Worker 立即回報用量至 License Server。
- **UI Feedback**: 當發生 `credits.depleted` 事件時，透過 WebSocket 推送 `internal.push_ui_notification` 到客服前端。

---

## 3. 實作任務 (Implementation Tasks)

1. [ ] 更新 `docs/11_ROADMAP.md`: 調整 v0.1-v0.2 的自動化優先順序。
2. [ ] 更新 `docs/12_TEMPLATE_AND_STORAGE.md`: 加入變數映射與儲存過期處理。
3. [ ] 更新 `docs/13_CHANNEL_BINDING.md`: 補充 Team Access 流程與安全機制。
4. [ ] 更新 `docs/14_BILLING_AND_LICENSE.md`: 定義 `license.credits.depleted` 事件通知鏈。
5. [ ] 更新 `docs/15_LICENSE_SERVER.md`: 細化扣點 API 與餘額不足的回報邏輯。
