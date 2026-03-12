# open333CRM — Lite CRM 架構設計文件

> 版本：v0.1-draft　　更新：2026-03-11

## 什麼是 open333CRM？

open333CRM 是一套為**中小型企業**設計的 **Lite CRM + 多渠道訊息管理平台**，
以取代舊有高耦合、單渠道的 LINE OA 後台方案。

核心設計原則：
- 🔌 **Plugin 優先** — 渠道、AI 功能、行銷模組皆以插件概念載入
- 🌐 **多渠道統一** — LINE OA、FB Messenger、Web Chat、未來 WhatsApp
- 📁 **真正的 CRM** — Case 開/處理/關閉、聯繫人管理、事件升級
- 🤖 **LLM 輔助** — KM 知識庫 + LLM 建議回覆，非硬核 chatbot
- 🧩 **前後分離** — REST + WebSocket API，前端框架自由選擇

## 文件索引

| 文件 | 說明 |
|------|------|
| [00_WHY_AND_VISION.md](./docs/00_WHY_AND_VISION.md) | 為什麼重建？舊系統痛點分析 + 新系統願景 |
| [01_DOMAIN_MODEL.md](./docs/01_DOMAIN_MODEL.md) | 核心領域模型 — 聯繫人、渠道、Case、事件 |
| [02_SYSTEM_ARCHITECTURE.md](./docs/02_SYSTEM_ARCHITECTURE.md) | 系統架構總覽 — 分層設計、模組邊界 |
| [03_CHANNEL_PLUGIN.md](./docs/03_CHANNEL_PLUGIN.md) | 多渠道插件系統設計 |
| [04_CASE_MANAGEMENT.md](./docs/04_CASE_MANAGEMENT.md) | Case 管理流程 — 開案/指派/升級/關閉 |
| [05_CONTACT_AND_TAG.md](./docs/05_CONTACT_AND_TAG.md) | 聯繫人統一身份 + 標籤系統 |
| [06_AUTOMATION_AND_EVENT.md](./docs/06_AUTOMATION_AND_EVENT.md) | 事件驅動自動化 — 觸發器、動作、流程 |
| [07_LLM_AND_KM.md](./docs/07_LLM_AND_KM.md) | LLM 輔助回覆 + 知識庫 KM 設計 |
| [08_MARKETING.md](./docs/08_MARKETING.md) | 行銷模組 — 廣播、受眾、模板 |
| [09_API_DESIGN.md](./docs/09_API_DESIGN.md) | 對外 REST API / WebSocket 規範 |
| [10_TECH_STACK.md](./docs/10_TECH_STACK.md) | 技術選型與部署架構 |
| [11_ROADMAP.md](./docs/11_ROADMAP.md) | 開發里程碑與 MVP 範圍 |
| [12_TEMPLATE_AND_STORAGE.md](./docs/12_TEMPLATE_AND_STORAGE.md) | Flex 模板庫 + 統一儲存層（S3/MinIO/GCS）|
| [13_CHANNEL_BINDING.md](./docs/13_CHANNEL_BINDING.md) | 企業自助綁定社交渠道（LINE / FB / WebChat）|
| [14_BILLING_AND_LICENSE.md](./docs/14_BILLING_AND_LICENSE.md) | 平台授權 & Billing 控制（太上皇層，Tenant 看不到）|
| [15_LICENSE_SERVER.md](./docs/15_LICENSE_SERVER.md) | License Server 自建設計（DB Schema / BD Portal / 扣點安全）|
| [16_DB_SCHEMA.md](./docs/16_DB_SCHEMA.md) | CRM 完整資料庫 Schema（Prisma + pgvector，所有 Model）|
| [17_UI_WIREFRAMES.md](./docs/17_UI_WIREFRAMES.md) | 企業後台 UI 畫面設計（ASCII Wireframe，8 大頁面）|
| [18_BOT_AUTOROUTER.md](./docs/18_BOT_AUTOROUTER.md) | Bot 模式 + 人工接管邏輯（關鍵字/LLM/辦公時間）|
| [19_CSAT_FLOW.md](./docs/19_CSAT_FLOW.md) | CSAT 滿意度調查完整流程（Flex 設計 + 低分挽救）|
| [20_NOTIFICATION.md](./docs/20_NOTIFICATION.md) | 通知系統（Web Push / In-App / Email + 靜音設定）|
| [21_ANALYTICS_DASHBOARD.md](./docs/21_ANALYTICS_DASHBOARD.md) | 報表儀表板（Agent績效 / 渠道分析 / 行銷效果）|
| [22_FAN_PORTAL.md](./docs/22_FAN_PORTAL.md) | 粉絲會員入口（投票/表單/競猜 + LIFF 導流 + 積分系統）|
| [23_SHORT_URL_TRACKING.md](./docs/23_SHORT_URL_TRACKING.md) | 短連結追蹤（LIFF 身份識別 + 自動貼標 + 行為分析）|

## 快速了解系統邊界
```
從「LINE OA 後台工具」升級成「企業溝通中樞」，

一個企業客戶 (Tenant)
  ├── 多個 LINE OA Channel
  ├── 多個 FB Page
  ├── 多個 Web Chat Widget
  └── 未來：WhatsApp Business Account

系統部署模式（Lite 版）
  → 單租戶：一個客戶 = 一套服務
  → 未來可升級為多租戶 SaaS

---
最有價值的幾個整合情境（家電業為例）:
電商（Shopline/91APP）→ 新訂單 → 自動貼標 + 7天後寄調查
IoT 智慧家電 → 溫度異常 → 自動開 Case + 通知客戶
ERP/POS → 批量同步購買紀錄 → enriched Contact attributes + 保固廣播


情境 A：電商平台 → CRM
  Shopline 新訂單 POST → /api/v1/integrations/orders
  → 系統找到或建立 Contact
  → 自動貼標：「已購買」「冰箱系列」
  → 觸發 Automation：3天後發送安裝說明

情境 B：IoT 異常警報 → CRM
  智慧冰箱偵測溫度異常 POST → /api/v1/integrations/events
  → 自動開 Case（priority: HIGH）
  → 指派給維修部門
  → 通知客服主管

情境 C：ERP 購買資料 → CRM
  定時批量 POST 客戶購買紀錄
  → 更新 ContactAttribute（brand, model, purchaseDate）
  → 計算保固剩餘天數 → 定期廣播提醒


```
# 結構
```
open333CRM/
├── apps/
│   ├── api/          ← Fastify + Prisma + BullMQ（src/index.ts + config/env.ts）
│   ├── web/          ← Next.js Admin Console
│   ├── widget/       ← Web Chat Widget（Vite）
│   └── workers/      ← 4 個 BullMQ Worker（automation/broadcast/sla/notification）
├── packages/
│   ├── types/        ← 共用 TS 型別（UniversalMessage, Contact, License...）
│   ├── core/         ← 共用業務邏輯（待填）
│   ├── channel-plugins/ ← ChannelPlugin 介面 + Plugin Registry
│   └── ui/           ← 共用 React 元件（待填）
├── docs/             ← 21 份架構文件
├── .env.example      ← 所有環境變數範本
├── docker-compose.yml ← 完整 8 服務
├── Caddyfile         ← 反向代理路由
├── pnpm-workspace.yaml
└── turbo.json
```