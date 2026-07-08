# Changelog

All notable changes to **open333CRM** will be documented in this file.

## [v0.3.0] - 2026-07-08

### Added

- **短連結追蹤設定** — 後台設定頁新增「追蹤設定」分頁，支援租戶層級設定 GA4 Measurement ID 與 Meta Pixel ID。設定後短連結 redirect 微頁面自動注入對應追蹤腳本，BOT 爬蟲不注入。

### Changed

- **LINE/FB 素材分流** — 素材建立改為先選渠道再選內容類型，LINE 與 FB 各自獨立的 contentType。
- **自動化規則事件感知** — 條件與動作選項會依選定事件動態過濾，切換事件時自動移除不相容選項。
- **人員管理完善** — 支援 Admin/Supervisor 新增人員、角色變更、密碼重置、停用帳號。
- **Figma 設計系統對齊** — Dashboard、Inbox、案件建立等元件視覺收尾，新增 E2E Playwright 測試（13 spec）。

### Fixed

- **案件刪除與 SLA 政策選擇** — 案件列表新增 row-level 刪除，SLA policy dropdown 改為 controlled state。
- **IME 安全的 Enter 處理** — 中文/日文輸入法組字時按 Enter 不會誤送訊息。
- **Inbox 即時更新** — 改用 SWR + 分頁載入，handoff/status/assignment 變更即時反映。
- **通知去重** — BullMQ worker 不再重複發送通知。
- **Caddy WebSocket** — 補齊 `/socket.io/*` 路由，修復 Socket.IO 連線逾時。

## [v0.2.0] - 2026-03-25

### Added

- **AI Copilot** — AI 從全自動回覆改為「副駕駛」模式，提供建議由人工採用。支援 AI 生成行銷素材。
- **通知小鈴鐺** — 即時通知中心，WebSocket 推送案件指派、SLA 預警、CSAT 差評等事件。
- **點數耗盡自動化** — AI 點數不足時自動禁用 AI 功能並顯示警告。
- **團隊渠道授權** — 渠道綁定新增「部門授權」步驟，實現資料權限隔離。
- **AI 採用率分析** — 新增 AI 採用率與客服修正率報表。

### Changed

- **Bot 路由邏輯** — 辦公時間內 AI 從「自動回覆」改為「僅建議」。
- **DB Schema** — 新增 Notification 模型、AI 建議生命週期欄位。

## [v0.1.0] - 2026-03-18

### Added

- **Monorepo 架構** — pnpm workspaces + Turborepo，TypeScript 全端。
- **多渠道整合** — LINE / Facebook Messenger / WebChat 統一收件箱。
- **案件管理** — 完整 Ticket 生命週期， BullMQ SLA 監控。
- **自動化引擎** — json-rules-engine 規則引擎，支援 12 種動作類型。
- **知識庫** — LanceDB + BM25 混合搜尋，語意 + 關鍵字雙檢索。
- **長期記憶** — 聯絡人等級的對話摘要與相似度觸發檢索。
- **行銷系統** — 活動管理、廣播排程、模板變數替換。
- **Docker 基礎設施** — PostgreSQL + Redis + MinIO + Ollama + Caddy。
