# open333CRM

全通路客戶關係管理系統，整合 LINE、Facebook Messenger、WebChat 多渠道客服，提供智能自動化、數據分析、行銷活動與粉絲互動功能。

## 核心功能

- **多渠道整合** — LINE OA、Facebook Messenger、Instagram (DM/Threads)、WebChat 統一收件箱
- **智能自動化** — 規則引擎（12 種動作類型）、LLM 情緒分析/分類/智能回覆、知識庫
- **數據分析** — 即時儀表板、績效追蹤、趨勢圖表、CSV 匯出
- **行銷系統** — 客群分眾、活動管理、廣播排程、模板變數替換、LINE Flex 素材匯入與編輯
- **案件管理** — Ticket 生命週期、SLA 監控、CSAT 調查
- **下游 Webhook** — CRM 接收的 Webhook 可即時轉發至自訂第三方系統
- **短連結** — URL 縮短、QR Code、點擊追蹤、GA4/Meta Pixel 追蹤注入
- **權限管理** — 多租戶架構、ADMIN / SUPERVISOR / AGENT 三級 RBAC

## 技術架構

| 層級        | 技術                                             |
| ----------- | ------------------------------------------------ |
| 前端        | Next.js 15 + React 19 + Tailwind CSS + shadcn/ui |
| 後端        | Fastify 5 + TypeScript (ESM)                     |
| 資料庫      | PostgreSQL 16 + Prisma 6                         |
| 快取 / 佇列 | Redis + BullMQ                                   |
| 即時通訊    | Socket.IO (on Fastify)                           |
| AI          | Ollama (qwen2.5 / bge-m3)                        |
| 儲存        | MinIO (S3 相容)                                  |
| 建構        | pnpm workspaces + Turborepo                      |
| 容器        | Docker Compose                                   |

## 專案結構

```
apps/
  api/        # Fastify 後端 (port 3001)
  web/        # Next.js 前端 (port 3000)
  workers/    # BullMQ 消費者（獨立程序）
  cli/        # oclif CLI (npm: open333)
  widget/     # 嵌入式 WebChat widget
packages/
  database/   # Prisma schema、migrations、seed
  shared/     # 共用型別與工具
  core/       # 共用工具函式
  types/      # TypeScript 型別定義
  ui/         # React UI 元件 (shadcn/ui)
  automation/ # 自動化引擎 (json-rules-engine)
  brain/      # AI/LLM 整合 (Ollama)
  channel-plugins/ # LINE、Facebook、WebChat 插件
  kb-ingest/  # 知識庫擷取管線
```

## CLI 工具 (`open333`)

安裝：`npm install -g @open333crm/cli` 或專案內 `pnpm --filter @open333crm/cli dev -- <command>`

```bash
open333 login --host https://api.example.com --email me@company.com --profile prod
open333 status --json
open333 stats --from 2026-07-01 --to 2026-07-08 --json
open333 apis --json
```

完整 CLI 文件與擴充指南：[docs/cli/SKILL.md](docs/cli/SKILL.md)

- 現有指令：`login`、`status`、`stats`、`apis`
- 快速參考卡：[docs/cli/references/quick-ref.md](docs/cli/references/quick-ref.md)
- 能力缺口分析（20+ 系統功能待 CLI 包覆）：[docs/cli/references/capability-gap.md](docs/cli/references/capability-gap.md)
- 新指令 Scaffold：`tsx docs/cli/scripts/scaffold-command.ts <name> <desc>`

## LLM / CLI 連線

讓 LLM（Claude、ChatGPT 等）或 `open333` CLI 直接操作本系統。

### 產生 Token

1. 登入後台 → **設定** → **CLI 連線**
2. 點「產生 Token」，填名稱（例：`Claude Code`）、選過期時間
3. 複製完整 token（只會顯示一次）

### 給 LLM 使用

將 token 貼給 LLM，並附上以下資訊：

```
API Base URL: https://uat.open333crm.create360.ai
Bearer Token: <token>

在 Headers 中加上：
Authorization: Bearer <token>
```

或參考 Skill 文件：`https://uat.open333crm.create360.ai/skill.md`

### 給 CLI 使用

```bash
open333 login --host https://uat.open333crm.create360.ai
# 貼上 token
open333 status --json
open333 stats --from 2026-07-01 --json
open333 apis --json
```

### 管理 Token

- 在 **設定** → **CLI 連線** 列出所有 token，可查看最後使用時間
- 不需要的 token 可直接撤銷，使用該 token 的 LLM/CLI 會立即失效

## Passkey / WebAuthn 登入

Passkey 提供 Agent 使用 Touch ID、Face ID、Windows Hello、裝置 PIN 或安全金鑰登入。密碼登入仍保留作為復原方式。

### 啟用設定

API 使用專案根目錄的 `.env`。正式環境必須使用 HTTPS，且 `WEBAUTHN_RP_ID` 不可包含 protocol、port 或 path：

```env
WEBAUTHN_RP_ID=crm.example.com
WEBAUTHN_RP_NAME=open333CRM
WEBAUTHN_ORIGIN=https://crm.example.com
WEBAUTHN_CHALLENGE_TTL_SECONDS=120
```

本機測試可使用：

```env
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_NAME=open333CRM
WEBAUTHN_ORIGIN=http://localhost:3000
```

Redis 需支援 `GETDEL`；專案 Docker Compose 使用 Redis 7。

### 綁定與管理位置

登入後台後，進入：

**設定 → Passkey 登入 → 綁定 Passkey**

Agent 可在此綁定多個裝置；綁定前會輸入裝置名稱（例如 `MacBook Touch ID` 或 `iPhone`），清單會顯示名稱、裝置類型與備份狀態，也可重新命名或撤銷既有 Passkey。登入頁的「使用 Passkey 登入」會使用已綁定的 credential；Passkey 流程要求 User Verification，並使用獨立的 rate limit 與一次性 challenge 防護。

### Passkey API

所有端點都在 `/api/v1/auth` 底下：

| 方法 | 端點 | 用途 |
| ---- | ---- | ---- |
| `POST` | `/passkeys/register/options` | 已登入 Agent 取得註冊選項 |
| `POST` | `/passkeys/register/verify` | 驗證並儲存 Passkey public key |
| `POST` | `/passkeys/authentication/options` | 取得登入 challenge |
| `POST` | `/passkeys/authentication/verify` | 驗證 Passkey 並核發現有 JWT Session |
| `GET` | `/passkeys` | 列出目前 Agent 的 Passkey |
| `PATCH` | `/passkeys/:id` | 重新命名 Passkey |
| `DELETE` | `/passkeys/:id` | 撤銷 Passkey（soft revoke） |

## 快速開始

### 前置需求

- Node.js >= 18、pnpm >= 8、Docker & Docker Compose

### 啟動

```bash
git clone git@github.com:CreateIntelligens/open333crm.git
cd open333crm
pnpm install
docker compose up -d
```

### 環境變數

```bash
cp .env.example .env              # 根目錄（API 讀這個）
cp apps/web/.env.example apps/web/.env
```

主要變數：

```env
DATABASE_URL=postgresql://crm:crmpassword@localhost:5432/open333crm
REDIS_URL=redis://localhost:6380
JWT_SECRET=your-jwt-secret
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=open333crm
```

> API 從**專案根目錄**的 `.env` 讀取，不是 `apps/api/.env`。

### 初始化資料庫

```bash
pnpm db:generate
pnpm --filter @open333crm/database exec prisma migrate deploy
pnpm db:seed
```

### 啟動開發伺服器

```bash
pnpm dev                              # 同時啟動 API + Web
pnpm --filter @open333crm/api dev     # 僅 API
pnpm --filter @open333crm/web dev     # 僅 Web
```

### 登入

seed 後可使用預設帳號登入。密碼請查看 `packages/database/prisma/seed.ts`。

## 常用指令

```bash
pnpm db:generate                      # 重新生成 Prisma Client
pnpm db:migrate -- --name <name>      # 建立新 migration
pnpm build                            # 全部 build
pnpm lint                             # 全部 lint
```

## Docker 環境

```bash
docker compose ps                     # 查看狀態
docker compose logs -f api            # 看 API log
docker compose restart api            # 重啟 API
docker compose down                   # 停止
docker compose down -v                # 停止並刪除 volumes（危險）
```

> macOS：`export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`

## API

Base URL: `http://localhost:3001/api/v1`，JWT Bearer Token 認證。

主要端點：

| 模組     | 端點                                                     |
| -------- | -------------------------------------------------------- |
| 認證     | `POST /auth/login`、`GET /auth/me`                       |
| 對話     | `GET /conversations`、`POST /conversations/:id/messages` |
| 案件     | `GET /cases`、`POST /cases`                              |
| 聯絡人   | `GET /contacts`、`POST /contacts`                        |
| 自動化   | `GET /automation/rules`、`POST /automation/rules`        |
| 分析     | `GET /analytics/overview`、`POST /analytics/export`      |
| 行銷     | `GET /marketing/campaigns`、`POST /marketing/broadcasts` |
| 短連結   | `GET /shortlinks`、`POST /shortlinks`                    |
| 追蹤設定 | `GET /settings/tracking`、`PUT /settings/tracking`       |
| 渠道管理 | `GET /channels`、`POST /channels`、`PUT /channels/:id`    |
| Webhook  | `GET /webhooks`、`POST /webhooks`、`DELETE /webhooks/:id` |

完整 API 文件：[docs/api-endpoints.md](docs/api-endpoints.md)（109+ 端點）

## WebSocket 事件

連線 `ws://localhost:3001`，需 JWT token。

```typescript
socket.on("message:new", (data) => {}); // 新訊息
socket.on("conversation:updated", (data) => {}); // 對話更新
socket.on("case:updated", (data) => {}); // 案件更新
socket.on("notification", (data) => {}); // 通知
```

## 部署

### 本地開發

```bash
docker compose up -d
# http://localhost（Caddy 反向代理 port 80）
```

### 線上部署

```bash
cp .env.prod.example .env.prod      # 填入 DOMAIN、CERTBOT_EMAIL
docker compose -f docker-compose.prod.yml up -d
```

SSL 由 certbot 自動續約，無需手動操作。

### 環境變數檔案

| 檔案            | 用途                              |
| --------------- | --------------------------------- |
| `.env`          | API（DB、Redis、JWT 等）          |
| `.env.workers`  | Workers                           |
| `apps/web/.env` | Web 前端                          |
| `.env.prod`     | 線上部署（DOMAIN、CERTBOT_EMAIL） |

### 生產環境必須修改

- [ ] `JWT_SECRET` — 強隨機字串
- [ ] `DATABASE_URL` — 生產資料庫
- [ ] `REDIS_URL` — 生產 Redis
- [ ] `S3_*` — 正式 S3 或 MinIO
- [ ] `LINE_*`、`FB_APP_SECRET` — 正式渠道憑證
- [ ] `NEXT_PUBLIC_API_URL` — 正式 API 網址

## 故障排除

| 問題                   | 解決                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| PostgreSQL 連線失敗    | Docker port 是 **5433**（非 5432），確認 `DATABASE_URL`                      |
| Redis 連線失敗         | Docker port 是 **6380**（非 6379），確認 `REDIS_URL`                         |
| Docker 指令找不到      | macOS: `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"` |
| Prisma Client 找不到   | `pnpm db:generate`                                                           |
| LINE/FB Webhook 收不到 | 確認使用公開 URL + 正確 webhook 格式                                         |

## 貢獻

1. Fork → `git checkout -b feat/xxx` → `git commit -m 'feat: xxx'` → PR
2. Commit 遵循 [Conventional Commits](https://www.conventionalcommits.org/)

## 授權

[GNU General Public License v3.0](LICENSE)

---

**Built with ❤️ by CreateIntelligens Team**
