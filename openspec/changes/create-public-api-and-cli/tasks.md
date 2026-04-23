## 1. 資料庫與模型 (Database & Models)

- [ ] 1.1 在 `schema.prisma` 中新增 `ApiToken` 模型與相關關聯。
- [ ] 1.2 執行 `prisma migrate dev` 更新資料庫結構。

## 2. API 驗證核心 (API Auth Core)

- [ ] 2.1 實作 `ApiTokenService` 處理 Token 的生成、雜湊 (SHA-256) 與驗證邏輯。
- [ ] 2.2 修改 `apps/api/src/plugins/auth.plugin.ts` 支援 `333_pat_` 前綴識別。
- [ ] 2.3 實作身分正規化 (Identity Normalization)，確保 PAT 登入後能正確掛載 `req.agent`。
- [ ] 2.4 在 `rbac.guard.ts` 中加入對 `scopes` 的檢查邏輯。

## 3. Web UI - API Token 管理

- [ ] 3.1 在 Web 端 Settings 頁面新增「API Tokens」區塊。
- [ ] 3.2 實作「生成 Token」對話框，包含「僅顯示一次」的明文警告。
- [ ] 3.3 實作「撤銷 Token」功能與列表顯示。

## 4. 共享 API Client (Shared Client)

- [ ] 4.1 初始化 `packages/api-client` 套件。
- [ ] 4.2 封裝基礎的 fetch 邏輯，支援 JWT 與 PAT 標頭切換。
- [ ] 4.3 將 `apps/web` 中的 API 呼叫遷移至 `packages/api-client`。

## 5. CLI 工具開發 (CLI Development)

- [ ] 5.1 在 `apps/cli` 使用 `oclif` 初始化專案。
- [ ] 5.2 實作 `333 auth login` 指令，用於本地儲存 PAT。
- [ ] 5.3 實作 `333 whoami` 指令，驗證連線狀態。
- [ ] 5.4 實作第一個業務指令 `333 contacts:list`。
