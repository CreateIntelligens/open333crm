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

## 快速了解系統邊界

```
一個企業客戶 (Tenant)
  ├── 多個 LINE OA Channel
  ├── 多個 FB Page
  ├── 多個 Web Chat Widget
  └── 未來：WhatsApp Business Account

系統部署模式（Lite 版）
  → 單租戶：一個客戶 = 一套服務
  → 未來可升級為多租戶 SaaS
```
