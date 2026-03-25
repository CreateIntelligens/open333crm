# Design Spec: CRM 授權、輔助 AI 與里程碑 (11-15) 整合 v2.0

**日期**: 2026-03-25
**主題**: 細化 AI 副駕駛 (Copilot)、生圖助手與 License Server 的整合
**目標**: 定義「AI 輔助」商務邏輯，落實點數計費與餘額不足的 UI 即時通知。

---

## 1. 核心邏輯：AI 副駕駛模式 (Copilot Mode)

為了撇清責任並由人工把關，AI 功能不進行「主動發送」，僅提供「建議」與「素材」。

### 1.1 AI 建議回覆流程 (ASCII)
```ascii
[ 客服點擊: AI 建議 ] ──▶ [ License Guard: 扣點 ] ──▶ [ AI 生成 1-3 個建議 ]
                                                          │
                                                          ▼
[ 客服編輯建議內容 ] ◀── [ 客服選擇: 採用 (Adopt) ] ◀── [ 前端顯示建議面板 ]
          │
          └─▶ [ 發送訊息 ] (標記: AI 建議且人工審核)
```

### 1.2 素材生圖流程 (Image Gen)
*   **功能位置**: 行銷廣播 Banner、LINE 圖文選單 (Rich Menu) 製作介面。
*   **扣點時機**: 點擊「AI 生成素材」且 API 回傳成功圖檔時。

---

## 2. 模組細化設計 (修正版)

### 2.1 11 — 開發里程碑 (Roadmap)
- **v0.2 (AI Assistant)**: 實作「建議回覆面板」與「AI 素材庫」。
- **v0.3 (Marketing+)**: 整合 AI 生圖至廣播模板編輯器。

### 2.2 12 — 模板與儲存 (Template & Storage)
- **AI Material Folder**: 專門儲存由 AI 生成的圖片，並提供 `publicUrl` 供各渠道引用。
- **Variable Adoptions**: 記錄訊息中採用了哪些變數。

### 2.3 14 & 15 — 授權與計費 (Billing & License)
**整合點**: 「輔助模式」下的點數安全。

- **Credit Depletion Notification**: 
    - 事件: `license.credits.depleted`。
    - 動作: `internal.push_ui_notification` (彈窗提示「點數不足，AI 建議暫停」)。
    - 前端: 禁用 AI 相關按鈕，並引導至充值頁面。
- **Deduction Rule**: 
    - `llmTokens`: 每次請求「建議回覆」成功時扣除。
    - `imageGen`: 每次生成素材成功時扣除。

---

## 3. 實作任務 (Implementation Tasks)

1. [ ] 更新 `docs/11_ROADMAP.md`: 將 AI 定位修正為 Copilot 與生圖助手。
2. [ ] 更新 `docs/12_TEMPLATE_AND_STORAGE.md`: 加入 AI 生成素材儲存策略。
3. [ ] 更新 `docs/14_BILLING_AND_LICENSE.md`: 定義「採用模式」點數核算與 UI 通知。
4. [ ] 更新 `docs/15_LICENSE_SERVER.md`: 補充生圖 API 與點數回報邏輯。
