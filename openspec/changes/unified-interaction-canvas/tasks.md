## 1. 資料庫與資料模型設計

- [ ] 1.1 新增 `InteractionFlow` 與 `InteractionNode` 資料表，用於儲存畫布結構。
- [ ] 1.2 新增 `FlowExecution` 與 `FlowLog` 資料表，記錄用戶在流程中的進度。
- [ ] 1.3 擴充 `Template` 資料表，支援 `TemplateView` 多通路版本。
- [ ] 1.4 新增 `IdentityMap` 資料表，儲存 LINE UID 與 FB PSID 到聯繫人的關聯。

## 2. 模板系統擴充 (Advanced Template Library)

- [ ] 2.1 實作 Block-based JSON 到 MJML 的渲染器。
- [ ] 2.2 實作 MJML 到 HTML 的編譯邏輯。
- [ ] 2.3 在 LINE/FB 插件中實作按鈕動作的解析邏輯（打標籤、觸發動作）。
- [ ] 2.4 整合 Meta Graph API，實作 WhatsApp HSM 模板提交與狀態追蹤功能。

## 3. 畫布執行引擎 (Flow Engine)

- [ ] 3.1 實作核心 `FlowRunner`，解析節點並執行同步動作。
- [ ] 3.2 整合 BullMQ 或資料庫延遲機制，實作「時間節點」。
- [ ] 3.3 實作「智慧窗口」檢查工具，根據時間區間推遲任務執行。
- [ ] 3.4 實作 API Fetch 節點，支援動態資料映射。
- [ ] 3.5 實作 AI Generation 節點，串接 `brain` 模組即時生成文案。

## 4. 身分串接引擎 (Identity Stitching)

- [ ] 4.1 在 Web 入口與 LIFF 實作 Cookie 追蹤與 UID 碰撞邏輯。
- [ ] 4.2 實作身分自動合併機制（手機號碼匹配）。
- [ ] 4.3 實作 AI 身分合併建議演算法，並在後台呈現建議清單。

## 5. API 整合與測試

- [ ] 5.1 實作 `/api/v1/canvas` 管理端點（Create, Update, List）。
- [ ] 5.2 實作 Webhook 進入點與畫布啟動邏輯（FB/LINE Webhook 轉發）。
- [ ] 5.3 編寫跨通路流程的整合測試（FB 進入 -> 延遲 -> Email 發送）。
- [ ] 5.4 實作畫布數據分析 API，計算各節點流失率。
