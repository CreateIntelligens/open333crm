## Why

將 `open333CRM` 從單純的 Web 工具轉化為可程式化平台，讓開發者與高級用戶能透過 API 與 CLI 進行自動化操作、大規模資料處理以及第三方系統整合。

## What Changes

- **[NEW] apps/cli**: 基於 `oclif` 框架開發的官方 CLI 工具，提供登入、資料查詢與自動化觸發等功能。
- **[NEW] packages/api-client**: 抽取 Web 與 CLI 共用的 API 呼叫邏輯與型別定義，確保雙端資料結構一致。
- **[NEW] ApiToken Model**: 在資料庫中新增 `ApiToken` 表，支援一對多關聯 (Agent 擁有多個 Token)，具備 Scoping 與獨立撤銷能力。
- **Unified Auth Middleware**: 升級 `apps/api` 的驗證機制，支援傳統 JWT 與新一代 `333_pat_` 前綴的 Personal Access Tokens (PAT)。
- **Identity Normalization**: 無論透過 JWT 或 PAT 登入，底層皆轉換為統一的 `req.agent` 上下文，讓業務邏輯透明化。

## Capabilities

### New Capabilities
- `public-api-auth`: 實作基於 PAT 的身份驗證機制，包含 Token 生成、雜湊儲存與權限範圍 (Scopes) 檢核。
- `public-api-surface`: 定義並開放核心 CRM 物件（聯絡人、案件、對話）的公共存取介面。
- `cli-core`: 建立 CLI 基礎架構，包含憑證管理、輸出格式化 (JSON/Table) 以及指令路由系統。

### Modified Capabilities
- `rbac`: 調整現有的權限控管系統，使其能識別並處理來自 API Token 的 Scopes 限制。

## Impact

- **apps/api**: 修改 `authPlugin` 與相關路由 Middleware。
- **packages/database**: 更新 Prisma Schema 並執行 Migration。
- **apps/web**: 在設定介面新增「API Tokens」管理功能。
- **Deployment**: 新增 CLI 的建置與發佈流程。
