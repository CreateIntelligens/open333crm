# 11 — 開發里程碑與 MVP 範圍 (Roadmap)

## 版本規劃總覽

```
v0.1 MVP     → 核心基礎（多渠道收件、Case、聯繫人、標籤）
v0.2         → LLM 輔助 + 知識庫
v0.3         → 自動化引擎 + 行銷廣播
v1.0 穩定版  → 完整功能 + 效能優化 + 客戶正式上線
v1.1         → 預約系統 + 活動報名 + A/B Test
v2.0         → 多租戶 SaaS
```

---

## MVP (v0.1) — 目標：6-8 週

### Phase 1（第1-2週）：基礎設施

- [ ] Monorepo 專案架構（pnpm workspace）
- [ ] PostgreSQL + Prisma Schema（核心 Table）
- [ ] Redis 設定
- [ ] JWT 認證系統
- [ ] Agent 帳號管理（CRUD + 角色權限）
- [ ] Docker Compose 開發環境

### Phase 2（第3-4週）：渠道插件 + 統一收件匣

- [ ] Channel Plugin 抽象介面
- [ ] LINE Messaging API Plugin（接收 + 發送）
- [ ] FB Messenger Plugin（接收 + 發送）
- [ ] WebChat Plugin（Socket.io 即時通訊）
- [ ] Web Chat Widget（嵌入式 JS Widget）
- [ ] 統一收件匣 API
- [ ] 聯繫人自動建立（首次互動時）
- [ ] 前端收件匣介面（含 WebSocket 即時更新）

### Phase 3（第5-6週）：Case 管理 + 聯繫人

- [ ] Case CRUD + 狀態機
- [ ] Case 指派給 Agent
- [ ] SLA 基礎計時（BullMQ 定時任務）
- [ ] Case 事件歷程
- [ ] Contact 詳情頁（含跨渠道身份）
- [ ] 多渠道標籤系統
- [ ] Contact 時間軸

### Phase 4（第7-8週）：前端完善 + 測試

- [ ] 前端 Case 管理頁面
- [ ] 前端 Contact 管理頁面
- [ ] Agent 工作台（收件匣 + Case + LLM 建議）
- [ ] 系統設定頁（Channel 設定、Agent 管理）
- [ ] 整合測試
- [ ] 第一個客戶（家電業者）試用部署

---

## v0.2 — AI 副駕駛 (Copilot) 與素材助手 (4週)

- [ ] AI 建議回覆面板（Copilot：建議 -> 編輯 -> 採用）
- [ ] 聯繫人對話歷史摘要（點擊後自動生成）
- [ ] AI 自動分類問題 (意圖識別)
- [ ] AI 生成行銷素材 (生圖：Banner / LINE Rich Menu)
- [ ] KM 語義搜尋 (LanceDB 整合)
- [ ] License Server 點數與授權對接

---

## v0.3 — 自動化中樞 + 行銷廣播（4週）

- [ ] Automation Rule Engine (事件驅動：Redis Streams)
- [ ] Integration Gateway (外部事件與 CRM 自動化對齊)
- [ ] 廣播系統（LINE / FB / 素材 AI 輔助）
- [ ] Segment 受眾分群（動態屬性匹配）
- [ ] 行銷模板管理 (含 Flex Message 動態變數)
- [ ] 餘額不足的自動降級與前端即時通知

---

## v1.0 — 穩定版（4週）

- [ ] SLA 完整（升級通知、Dashboard）
- [ ] Case 合併 / 關聯
- [ ] 聯繫人合併（多渠道身份整合）
- [ ] 關係鏈功能
- [ ] Dashboard 數據報表
- [ ] Email 通知（SMTP）
- [ ] 效能優化（查詢、快取）
- [ ] 安全性審查
- [ ] 文件撰寫（用戶手冊）
- [ ] 正式上線

---

## v1.1 — 垂直功能擴充（後續）

- [ ] 預約系統（維修時段選擇）
- [ ] 活動報名（報到 QR Code）
- [ ] 廣播 A/B Test
- [ ] Agent 技能指派
- [ ] CSAT 滿意度調查
- [ ] 外部 Webhook 訂閱（第三方整合）
- [ ] WhatsApp Business Cloud API Plugin

---

## v2.0 — SaaS 多租戶（遠期）

- [ ] Tenant 管理後台
- [ ] 計費與訂閱系統
- [ ] 資源隔離（資料庫 Schema 隔離 or Row-Level Security）
- [ ] 白標（White-label）支援

---

## 第一個客戶（家電業者）交付範圍

按照 v0.1 + v0.2（部分）規劃，預計 **10 週**交付：

| 功能 | 版本 | 週次 |
|------|------|------|
| LINE OA 接入 | MVP | W1-4 |
| FB Messenger 接入 | MVP | W1-4 |
| 網站 Web Chat 接入 | MVP | W1-4 |
| 統一收件匣 | MVP | W3-4 |
| 聯繫人管理 | MVP | W5-6 |
| 標籤系統 | MVP | W5-6 |
| Case 開案/指派/關閉 | MVP | W5-8 |
| LLM 建議回覆（基礎）| v0.2 | W7-10 |
| 知識庫 KM | v0.2 | W7-10 |
| 廣播（基礎）| v0.3 | 視需求 |

---

## 技術負債管理原則

每個 Sprint 保留 **20%** 時間處理技術負債：

1. 避免為趕進度跳過測試
2. 每個模組有基礎單元測試（>70% 覆蓋率）
3. API 有整合測試
4. 所有重要的自動化規則行為有 E2E 測試
5. 定期 dependency 安全更新

---

## 目錄總結

```
open333CRM/
├── README.md
├── docs/
│   ├── 00_WHY_AND_VISION.md       ← 為什麼要做？
│   ├── 01_DOMAIN_MODEL.md         ← 核心概念定義
│   ├── 02_SYSTEM_ARCHITECTURE.md  ← 系統分層架構
│   ├── 03_CHANNEL_PLUGIN.md       ← 多渠道插件設計
│   ├── 04_CASE_MANAGEMENT.md      ← Case 生命週期
│   ├── 05_CONTACT_AND_TAG.md      ← 聯繫人與標籤
│   ├── 06_AUTOMATION_AND_EVENT.md ← 自動化引擎
│   ├── 07_LLM_AND_KM.md           ← AI 輔助與知識庫
│   ├── 08_MARKETING.md            ← 行銷廣播
│   ├── 09_API_DESIGN.md           ← 對外 API 規範
│   ├── 10_TECH_STACK.md           ← 技術選型與部署
│   └── 11_ROADMAP.md              ← 這個文件
└── apps/
    ├── api/                       ← 後端（v0.1 起開發）
    ├── web/                       ← 前端 Admin Console
    └── widget/                    ← Web Chat Widget
```
