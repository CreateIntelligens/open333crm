# open333CRM — Lite CRM & Automation Platform

> 版本：v0.2.0-beta    更新：2026-03-25

## 什麼是 open333CRM？

open333CRM 是一套為**中小型企業**設計的 **Lite CRM + 事件驅動自動化平台**，
以取代舊有高耦合、單渠道的 LINE OA 後台方案。

核心設計原則：
- 🔌 **事件驅動中樞** — 以 Automation Engine 為核心，所有模組透過事件互動。
- 🤖 **AI Copilot 輔助** — AI 提供回覆建議與生圖素材，由人工審核「採用」，明確責任歸屬。
- 🔔 **即時通知中心** — 透過小鈴鐺與 WebSocket，讓客服人員即時掌握案件指派、SLA 預警與客戶評價。
- 🌐 **多渠道統一** — LINE OA、FB Messenger、Web Chat、未來：Telegram、WhatsApp。
- 📁 **真正的 CRM** — Case 管理、聯繫人屬性、多部門權限隔離。
- 🏦 **遠端授權計費** — 由 License Server 遠端控管功能開關與 AI 點數。

## 專案進度 (Status)

- [x] **Phase 1: 基礎建設** — Monorepo, Docker, 數據庫。
- [x] **Phase 2: 事件驅動核心** — Automation Engine 與 Redis Streams 事件匯流排。
- [x] **Phase 3: AI Copilot & 計費** — AI 輔助建議、生圖與 License 點數扣除。
- [x] **Phase 4: 完整文件化** — 完成 00-23 號系統設計文件細化。
- [ ] **Phase 5: 前端實作** — 根據 UI Wireframes 進行開發。

## 文件索引 (Partial)

| 文件 | 說明 |
|------|------|
| [18_BOT_AUTOROUTER.md](./docs/18_BOT_AUTOROUTER.md) | **AI Copilot** 輔助模式與責任邊界 |
| [20_NOTIFICATION.md](./docs/20_NOTIFICATION.md) | **小鈴鐺通知中心** 事件與優先級設計 |
| [06_AUTOMATION_AND_EVENT.md](./docs/06_AUTOMATION_AND_EVENT.md) | **自動化引擎** 與事件驅動架構 |
| [14_BILLING_AND_LICENSE.md](./docs/14_BILLING_AND_LICENSE.md) | 平台授權 & Billing 控制（太上皇層）|
| [16_DB_SCHEMA.md](./docs/16_DB_SCHEMA.md) | CRM 完整資料庫 Schema（Prisma + pgvector）|
| [17_UI_WIREFRAMES.md](./docs/17_UI_WIREFRAMES.md) | 企業後台 UI ASCII Wireframe |

## 快速了解系統邊界
\`\`\`
從「LINE OA 後台工具」升級成「企業溝通中樞」，

一個企業客戶 (集團)
  ├── 共享聯繫人 (Contact)
  ├── 多個部門 (Team/TeamId)
  │     └── 獨立專屬對話 (Conversation)
  └── 多個渠道 (Line/FB/WebChat)

系統部署模式 (Lite 版)
  → 單實例單集團：一個 Docker Compose = 一個企業客戶
  → 計費管理：太上皇 License Server 遠端控管
\`\`\`

## 結構
\`\`\`
```
open333CRM/
├── apps/
│   ├── api/          ← Fastify API Gateway (與 Core Services 介接)
│   ├── web/          ← Next.js 15 管理後台
│   ├── widget/       ← 訪客端聊天視窗元件
│   └── workers/      ← 背景任務 (如媒體下載、SLA 監控、數據同步)
├── packages/
│   ├── core/         ← 核心業務服務 (Inbox, Contact, Case, Automation, EventBus)
│   ├── database/     ← Prisma Schema (含 Tenant 多租戶隔離)
│   ├── types/        ← 共享型別定義
│   ├── channel-plugins/ ← 渠道插件與各渠道專屬 Workers
│   ├── automation/   ← 基礎規則引擎工具
│   └── brain/        ← AI 知識庫 (LanceDB + Hybrid Search)
├── docs/             ← 系統架構與各模組專詳文檔 (00-23)
├── docker-compose.yml ← PostgreSQL, Redis, MinIO, Caddy
├── CHANGELOG.md      ← 詳細更動紀錄
└── turbo.json        ← Pnpm 工作區管理
```
\`\`\`
