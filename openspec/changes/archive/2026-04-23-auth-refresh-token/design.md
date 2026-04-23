## Context

目前 auth 架構：
- Access Token 存於 `localStorage`（XSS 風險）
- 7 天到期，到期後強制登出，無靜默續期
- `/auth/refresh` 存在但需要有效 Bearer token（無法在 token 過期後使用）
- 前端 `api.ts` 的 401 interceptor 直接清除 token 並跳轉 /login

## Goals / Non-Goals

**Goals:**
- Access Token 改存於 React state（記憶體），XSS 無法讀取
- Refresh Token 以 HttpOnly + SameSite=Strict Cookie 傳輸
- 支援「記住我」：記住我 → Cookie Max-Age 30 天；不記住 → Session Cookie（關閉瀏覽器即失效）
- 401 後靜默呼叫 `/auth/refresh` 換新 Access Token，成功後自動重試原請求
- Refresh 失敗才導向 /login

**Non-Goals:**
- Refresh Token rotation（每次 refresh 發新 refresh token）— 複雜度高，留待後續
- Refresh Token 黑名單（DB 儲存）— 目前用 stateless JWT；logout 只清 Cookie
- Multi-tab 同步（各 tab 各自持有 in-memory access token）

## Decisions

### 1. Refresh Token 用 JWT，不另存 DB
**決定**：Refresh Token 仍是 JWT（`@fastify/jwt` 簽發），不在 DB 建 refresh_tokens 表。  
**理由**：保持 stateless，部署複雜度低。代價是 logout 後 refresh token 仍技術上有效直到過期，但因為 Cookie 被清除，正常客戶端無法使用。  
**替代**：DB 黑名單 → 每次 refresh 需 DB 查詢，過度工程。

### 2. Access Token 存 React state，不用 Context ref
**決定**：`AuthProvider` 維護 `accessToken` state，搭配一個 module-level ref 讓 `api.ts` interceptor 能讀取（避免閉包過時問題）。  
**理由**：純 Context 無法在 axios interceptor 中直接讀取（不在 React 樹內）。Module ref pattern 是標準解法。

```
┌─────────────────────────────────────────────────────────┐
│                   Token 流程                             │
└─────────────────────────────────────────────────────────┘

  Login
    │
    ▼
  POST /auth/login { email, password, rememberMe }
    │
    ├─▶ Response body: { accessToken, agent }
    │     → AuthProvider.setAccessToken(token)
    │     → module ref: tokenRef.current = token
    │
    └─▶ Set-Cookie: refreshToken=...; HttpOnly; SameSite=Strict
          rememberMe=true  → Max-Age=2592000 (30天)
          rememberMe=false → Session Cookie (無 Max-Age)

  API Request
    │
    ▼
  request interceptor: Authorization: Bearer tokenRef.current

  API returns 401
    │
    ▼
  POST /auth/refresh  (Cookie 自動帶上)
    ├─▶ 成功: 新 accessToken → tokenRef.current = newToken
    │         重試原請求
    └─▶ 失敗: redirect /login
```

### 3. `/auth/refresh` 移除 `authenticate` preHandler
**決定**：refresh endpoint 改從 Cookie 讀取 refresh token，自行驗證，不依賴 Bearer token。  
**理由**：原本的 preHandler 要求有效 Bearer token，使 refresh 完全無意義（token 還有效幹嘛 refresh）。

### 4. Queue 機制防止並發 refresh
**決定**：`api.ts` 加入 `isRefreshing` flag 和 pending queue，多個並發 401 只觸發一次 refresh，完成後一次性重試所有排隊的請求。  
**理由**：頁面初始化常有多個並發 API call，若全部各自 refresh 會造成 race condition。

### 5. CORS credentials
**決定**：`cors.plugin.ts` 已設 `credentials: true`，Cookie 可正常跨 origin 傳送。無需額外設定。  
**注意**：前端 axios 需加 `withCredentials: true`。

## Risks / Trade-offs

- **頁面重整後 Access Token 遺失** → 前端 mount 時自動呼叫 `/auth/refresh` 取得新 Access Token（利用還存在的 Cookie）。若 Cookie 也過期才導向登入。
- **`@fastify/cookie` 需新增依賴** → pnpm add，低風險。
- **XSS 可偷 access token（in-memory）** → 攻擊窗口僅限 token 存活期（15分鐘）。相比 localStorage 7天大幅縮小。
- **CSRF 風險（Cookie）** → SameSite=Strict 防護，refresh endpoint 只接 POST。

## Migration Plan

1. API：安裝 `@fastify/cookie`，註冊 cookie plugin
2. API：修改 `login` 設定 Cookie，修改 `refresh` 從 Cookie 讀 token，新增 `logout` 清 Cookie
3. API：新增 `REFRESH_TOKEN_EXPIRES_IN` env（預設 `30d`），`ACCESS_TOKEN_EXPIRES_IN`（預設 `15m`）
4. 前端：`AuthProvider` 改用 in-memory token + module ref
5. 前端：`api.ts` 加入 refresh + retry 邏輯
6. 前端：登入頁加入 rememberMe checkbox

**Rollback**：若有問題，`auth.routes.ts` 可快速回退至原本 login 行為；localStorage 策略可在 `AuthProvider` 回退。

## Open Questions

- Access Token 過期時間設多短？建議 `15m`，可透過 env 調整。
- 是否需要 logout 端點讓後端也做 token invalidation？目前只清 Cookie，stateless。
