## Context

目前 `open333CRM` 的 API 僅支援瀏覽器環境的 JWT 驗證，缺乏讓用戶進行外部整合的手段。為了解決此問題，我們需要設計一套統一的驗證閘道，並提供官方 CLI 工具。

## Goals / Non-Goals

**Goals:**
- 建立基於 PAT (Personal Access Tokens) 的身分驗證機制。
- 實現 Web 與 CLI 共用的 API 存取層 (`packages/api-client`)。
- 提供基於 `oclif` 的 `apps/cli` 應用程式。
- 確保所有 `/api/v1/*` 路由皆能識別兩類憑證並統一身分上下文。

**Non-Goals:**
- 本階段不實作 OAuth2 三方授權流 (僅支援 PAT)。
- 不包含速率限制 (Rate Limiting) 的實作（留待後續優化）。

## Decisions

### 1. 統一驗證閘道 (Unified Auth Gateway)
**方案**：升級 Fastify `authPlugin`，在同一 Middleware 中處理 JWT 與 PAT。
**理由**：避免維護兩套相似的路由 (`/api/v1` vs `/api/v1/public`)，確保功能對等。
**流程圖**：
```ascii
                      [ HTTP Request ]
                             │
            ┌────────────────┴────────────────┐
            │ Check "Authorization" Header    │
            └────────────────┬────────────────┘
                             │
              Is it "Bearer 333_pat_..." ?
               /                    \
            [YES]                  [NO]
              │                      │
      ┌───────▼───────┐      ┌───────▼───────┐
      │  PAT Strategy │      │  JWT Strategy │
      │(DB Lookup)    │      │(JWT Verify)   │
      └───────┬───────┘      └───────┬───────┘
              │                      │
              └──────────┬───────────┘
                         ▼
          ┌──────────────────────────────┐
          │    Identity Normalization    │
          │  (req.agent = Normalized)    │
          └──────────────┬───────────────┘
                         │
          ┌──────────────▼───────────────┐
          │   Domain Logic (Services)    │
          └──────────────────────────────┘
```

### 2. Token 儲存與驗證
**方案**：`333_pat_` 前綴 + SHA-256 雜湊儲存。
**理由**：
- 前綴字方便 Secret Scanning 與 User 辨識。
- 雜湊儲存確保資料庫洩漏時 Token 不會被直接利用。
- 僅在生成時顯示一次明文。

### 3. CLI 工具開發 (oclif)
**方案**：於 `apps/cli` 建立專案。
**想像中的操作流 (Imagined Flow)**：
```bash
# 1. 登入 (設定 PAT)
$ 333 auth login --token 333_pat_abc123
# 2. 查詢目前身分
$ 333 whoami
# 3. 獲取聯繫人清單 (支援 JSON 輸出)
$ 333 contacts:list --status active --json
# 4. 建立案件
$ 333 cases:create --title "客戶問題" --contact-id "UID"
```

## Risks / Trade-offs

- **[Risk] Token 洩漏** → **[Mitigation]** 使用雜湊儲存，並在 UI 提供隨時撤銷 (Revoke) 功能。
- **[Risk] 功能落差** → **[Mitigation]** 強制使用 `packages/api-client` 作為唯一連線層，確保 Web/CLI 邏輯一致。
- **[Trade-off] 單一 API 版本** → 所有的更改都會同時影響網頁與外部工具，需要更嚴格的 API 相容性管理。
