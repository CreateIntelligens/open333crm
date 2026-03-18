# open333CRM — Lite CRM 架構

> 版本：v0.1.0-alpha　　更新：2026-03-18

## 什麼是 open333CRM？

open333CRM 是一套為**中小型企業**設計的 **Lite CRM + 多渠道訊息管理平台**，
以取代舊有高耦合、單渠道的 LINE OA 後台方案。

核心設計原則：
- 🔌 **Plugin 優先** — 渠道、AI 功能、行銷模組皆以插件概念載入
- 🌐 **多渠道統一** — LINE OA、FB Messenger、Web Chat、未來 WhatsApp
- 📁 **真正的 CRM** — Case 開/處理/關閉、聯繫人管理、事件升級
- 🤖 **LLM 輔助** — KM 知識庫 + LLM 建議回覆，非硬核 chatbot
- 🧩 **集團共享模式 (B-1)** — 全集團聯絡人共享，跨部門對話與案件隔離
- 🏗️ **單租戶託管** — 每個客戶獨立實例，由太上皇系統遠端計費控管

## 專案進度 (Status)

- [x] **Phase 1: 基礎建設** — Monorepo, Docker, 數據庫簡化實作完成
- [x] **Phase 2: 太上皇計費系統** — License 控制與點數機制框架完成
- [ ] **Phase 3: 多渠道核心** — Line/FB Webhook 接收與發送邏輯
- [ ] **Phase 4: Case & Conversation 管理** — 收件匣 UI 與工作流
- [ ] **Phase 5: AI 與自動化** — KM 與 Rule Engine 整合

## 文件索引 (Partial)

| 文件 | 說明 |
|------|------|
| [📋 PROJECT_PLAN.md](./docs/PROJECT_PLAN.md) | **專案規劃：里程碑 / 工時預估** |
| [14_BILLING_AND_LICENSE.md](./docs/14_BILLING_AND_LICENSE.md) | 平台授權 & Billing 控制（太上皇層）|
| [16_DB_SCHEMA.md](./docs/16_DB_SCHEMA.md) | CRM 完整資料庫 Schema（Prisma + pgvector）|

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
open333CRM/
├── apps/
│   ├── api/          ← Fastify (License Guard + Plugin Registry)
│   └── web/          ← Next.js 15 Admin Console
├── packages/
│   ├── database/     ← Prisma Schema + Generated Client
│   └── automation/   ← json-rules-engine core
├── docs/             ← 架構與設計文件
├── docker-compose.yml ← PostgreSQL, Redis, MinIO, Caddy
├── CHANGELOG.md      ← 詳細更動紀錄
└── turbo.json        ← Pnpm 工作區管理
\`\`\`
