# open333CRM — Lite CRM 架構

> 版本：v0.1.0-alpha    更新：2026-03-18    下一版計畫：[v0.2.0 multi-channel-billing](./openspec/changes/multi-channel-billing/proposal.md)

## 什麼是 open333CRM？

open333CRM 是一套為**中小型企業**設計的 **Lite CRM + 多渠道訊息管理平台**，
以取代舊有高耦合、單渠道的 LINE OA 後台方案。

核心設計原則：
- 🔌 **Plugin 優先** — 渠道、AI 功能、行銷模組皆以插件概念載入
- 🌐 **多渠道統一** — LINE OA、FB Messenger、Web Chat、未來：Telegram、Threads、WhatsApp
- 📁 **真正的 CRM** — Case 開/處理/關閉、聯繫人管理、事件升級
- 🤖 **LLM 輔助** — KM 知識庫 + LLM 建議回覆，非硬核 chatbot
- 🧩 **集團共享模式 (B-1)** — 全集團聯絡人共享，跨部門對話與案件隔離
- 🚦 **Channel 多部門授權** — 一個渠道可授權多個部門共用，各有獨立 Credit 額度
- 🏦 **單租戶託管** — 每個客戶獨立實例，由太上皇 License Server 遠端計費控管

## 專案進度 (Status)

- [x] **Phase 1: 基礎建設** — Monorepo, Docker, 數據庫簡化實作完成
- [x] **Phase 2: 太上皇計費系統** — License 控制與點數機制框架完成
- [ ] **Phase 3: 多渠道擴充 (v0.2.0)** — Telegram/Threads Plugin + Channel-Team 授權 + 計費機制 _(OpenSpec 進行中)_
- [x] **Phase 3.1: LINE OA Plugin (v0.3.0)** — 完整 LinePlugin 實作：5 種發送策略、Rich Menu、Narrowcast Audience、Insight Sync、LIFF、Account Link ✅
- [x] **Phase 4: Case & Conversation 管理** — 核心 InboxService, CaseService 與 SLA 監控框架完成 (v0.4.0) ✅
- [x] **Phase 5: AI 與自動化** — KM 與 Rule Engine 核心整合完成，支持事件驅動 (v0.4.0) ✅

## 文件索引 (Partial)

| 文件 | 說明 |
|------|------|
| [📋 PROJECT_PLAN.md](./docs/PROJECT_PLAN.md) | **專案規劃：里程碑 / 工時預估** |
| [03_CHANNEL_PLUGIN.md](./docs/03_CHANNEL_PLUGIN.md) | 多渠道 Plugin 架構、Extension 介面定義 |
| [03_CHANNEL_PLUGINS/LINE_OA.md](./docs/03_CHANNEL_PLUGINS/LINE_OA.md) | **LINE OA 官方 API 完整參考（16 章節）** |
| [09_API_DESIGN.md](./docs/09_API_DESIGN.md) | 對外 REST API 規格、頻道授權、錯誤碼 |
| [14_BILLING_AND_LICENSE.md](./docs/14_BILLING_AND_LICENSE.md) | 平台授權 & Billing 控制（太上皇層）|
| [16_DB_SCHEMA.md](./docs/16_DB_SCHEMA.md) | CRM 完整資料庫 Schema（Prisma + pgvector）|
| [📦 line-oa-channel-plugin OpenSpec](./openspec/changes/line-oa-channel-plugin/proposal.md) | **v0.3.0：LINE OA Plugin 完整實作規格** |
| [📦 multi-channel-billing OpenSpec](./openspec/changes/multi-channel-billing/proposal.md) | **v0.2.0 計畫：Telegram/Threads + 多部門授權 + 計費** |

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
