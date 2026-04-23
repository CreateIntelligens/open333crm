## ADDED Requirements

### Requirement: PAT Token Management
使用者能在 Web UI 手動生成與管理個人存取令牌 (Personal Access Tokens)。

#### Scenario: Token Generation
- **WHEN** 使用者輸入名稱「Dev Laptop」並點擊生成
- **THEN** 系統顯示一串以 `333_pat_` 開頭的明文 Token（僅顯示一次），並將其雜湊值存入 `ApiToken` 表中。

#### Scenario: Token Revocation
- **WHEN** 使用者點擊「Revoke」特定 Token
- **THEN** 該 Token 在資料庫中被標記為失效或刪除，後續使用該 Token 的請求皆回傳 401。

### Requirement: Authentication Differentiating
系統必須能自動辨識請求使用的是 JWT 還是 PAT。

#### Scenario: PAT Authentication
- **WHEN** HTTP Header 包含 `Authorization: Bearer 333_pat_...`
- **THEN** 系統查詢資料庫，驗證雜湊值，並在驗證成功後將 `req.agent` 設定為該 Token 所屬的 Agent。
