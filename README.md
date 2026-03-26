# open333CRM - 全通路客戶關係管理系統

> 企業級 Omnichannel CRM 系統，整合 LINE、Facebook Messenger、WebChat 多渠道客服，提供智能自動化、數據分析、行銷活動與粉絲互動功能。

## 🌟 核心功能

### 📱 多渠道整合
- **LINE Official Account** - LINE 官方帳號整合
- **Facebook Messenger** - Facebook 粉絲專頁訊息
- **WebChat** - 網站即時客服小工具
- 統一收件箱管理所有渠道對話

### 🤖 智能自動化
- **規則引擎** - 基於事件觸發的自動化流程（12種動作類型）
- **LLM 整合** - 情緒分析、問題分類、智能回覆
- **知識庫** - 自動回答常見問題
- **Bot 路由** - 可配置的 Bot/人工交接策略

### 📊 數據分析
- **儀表板** - 即時業務數據總覽
- **績效追蹤** - 客服人員、渠道、案件統計
- **趨勢分析** - 訊息量、案件量時間序列圖表
- **CSV 匯出** - 支援報表下載

### 📢 行銷系統
- **客群分眾** - 基於標籤、渠道、時間的動態分群
- **活動管理** - 行銷活動追蹤與 ROI 分析
- **訊息廣播** - 排程發送、個人化變數替換
- **模板系統** - 12+ 系統模板，支援多種訊息類型

### ⭐ 客戶體驗
- **CSAT 調查** - 自動發送滿意度調查（1-5分）
- **SLA 監控** - 首次回應、解決時間追蹤
- **辦公時間** - 可配置營業時間與自動回覆
- **案件管理** - 完整的 Ticket 生命週期管理

### 🎮 粉絲互動
- **粉絲活動** - 投票、表單、抽獎活動
- **積分系統** - 粉絲積分累積與追蹤
- **短連結** - URL 縮短、QR Code、點擊追蹤

### 🔐 權限管理
- **多租戶架構** - 支援多組織隔離
- **角色權限** - ADMIN / SUPERVISOR / AGENT 三級權限
- **團隊管理** - 客服團隊分組與工作分派

## 🏗️ 技術架構

### 前端
- **Next.js 14** - React App Router
- **shadcn/ui** - 現代化 UI 組件庫
- **Tailwind CSS** - 實用優先的 CSS 框架
- **Recharts** - 數據視覺化圖表
- **Socket.io Client** - 即時訊息推送

### 後端
- **Fastify** - 高效能 Node.js Web 框架
- **TypeScript** - 型別安全
- **Prisma ORM** - 現代化資料庫工具
- **Socket.io** - WebSocket 即時通訊
- **json-rules-engine** - 規則引擎核心

### 資料庫與儲存
- **PostgreSQL** - 主要資料庫（port 5433）
- **Redis** - 快取與 Session（port 6380）
- **MinIO** - S3 相容物件儲存（port 9000）

### AI & 整合
- **Ollama** - 本地 LLM 推論引擎（port 11434）
- **qwen2.5:7b** - 中文語言模型
- **LINE Messaging API** - LINE Bot 整合
- **Facebook Graph API** - Messenger 整合

### 開發工具
- **pnpm** - 高效能套件管理器
- **Turborepo** - Monorepo 構建系統
- **Docker Compose** - 容器化開發環境

## 📦 專案結構

```
.
├── apps/
│   ├── api/                 # Fastify 後端 API (port 3001)
│   │   ├── src/
│   │   │   ├── channels/    # 渠道整合（LINE, FB, WebChat）
│   │   │   ├── modules/     # 業務模組
│   │   │   │   ├── ai/      # LLM、情緒分析、分類
│   │   │   │   ├── analytics/   # 數據分析
│   │   │   │   ├── automation/  # 自動化引擎
│   │   │   │   ├── case/        # 案件管理
│   │   │   │   ├── contact/     # 聯絡人
│   │   │   │   ├── conversation/# 對話管理
│   │   │   │   ├── csat/        # 滿意度調查
│   │   │   │   ├── marketing/   # 行銷系統
│   │   │   │   ├── portal/      # 粉絲活動
│   │   │   │   ├── shortlink/   # 短連結
│   │   │   │   ├── sla/         # SLA 監控
│   │   │   │   └── storage/     # 檔案儲存
│   │   │   └── events/      # 事件總線
│   └── web/                 # Next.js 前端 (port 3000)
│       ├── src/
│       │   ├── app/         # App Router 頁面
│       │   ├── components/  # React 組件
│       │   └── hooks/       # 自定義 Hooks
├── packages/
│   ├── db/                  # Prisma 資料庫層
│   │   ├── prisma/
│   │   │   ├── schema.prisma    # 資料庫 Schema
│   │   │   ├── migrations/      # 遷移檔案
│   │   │   └── seed.ts          # 種子資料
│   │   └── demo-data.sql        # 示範資料 SQL
│   └── shared/              # 共用型別與工具
├── docker-compose.yml       # Docker 服務定義
└── turbo.json              # Turborepo 設定
```

## 🚀 快速開始

### 前置需求

- **Node.js** >= 18.0.0
- **pnpm** >= 8.0.0
- **Docker** & **Docker Compose**
- **Git**

### 1. Clone 專案

```bash
git clone git@github.com:CreateIntelligens/open333crm.git
cd open333crm
```

### 2. 安裝依賴

```bash
pnpm install
```

### 3. 啟動 Docker 服務

```bash
# macOS 用戶需確保 Docker 在 PATH 中
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

# 啟動所有服務（PostgreSQL, Redis, MinIO, Ollama）
docker compose up -d

# 檢查服務狀態
docker compose ps
```

### 4. 設定環境變數

```bash
# API 環境變數
cp apps/api/.env.example apps/api/.env

# Web 環境變數
cp apps/web/.env.example apps/web/.env
```

**API 主要環境變數** (`apps/api/.env`):
```env
# 資料庫（注意：port 5433）
DATABASE_URL=postgresql://crm:crmpassword@localhost:5433/open333crm

# Redis（注意：port 6380）
REDIS_URL=redis://localhost:6380

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# S3 儲存 (MinIO)
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=open333crm
S3_REGION=us-east-1
S3_PUBLIC_URL=http://localhost:9000

# LLM
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b

# LINE
LINE_CHANNEL_SECRET=your-line-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=your-line-access-token

# Facebook
FB_APP_SECRET=your-fb-app-secret
```

**Web 環境變數** (`apps/web/.env`):
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 5. 初始化資料庫

```bash
# 生成 Prisma Client
pnpm --filter @open333crm/db exec prisma generate

# 執行 Migrations
pnpm --filter @open333crm/db exec prisma migrate deploy

# 載入種子資料（包含 demo 帳號）
pnpm --filter @open333crm/db exec prisma db seed

# 載入示範資料（可選）
docker exec -i open333crm-postgres psql -U crm open333crm < packages/db/demo-data.sql
```

### 6. 啟動開發伺服器

```bash
# 同時啟動 API 和 Web
pnpm dev

# 或分別啟動
pnpm --filter @open333crm/api dev     # API: http://localhost:3001
pnpm --filter @open333crm/web dev     # Web: http://localhost:3000
```

### 7. 登入系統

訪問 http://localhost:3000，使用以下帳號登入：

| 角色 | Email | 密碼 |
|------|-------|------|
| 管理員 | admin@demo.com | admin123 |
| 主管 | supervisor@demo.com | admin123 |
| 客服 | agent1@demo.com | admin123 |

## 🔧 開發指南

### Prisma 資料庫操作

```bash
# 生成 Prisma Client
pnpm --filter @open333crm/db exec prisma generate

# 創建新 Migration
pnpm --filter @open333crm/db exec prisma migrate dev --name your_migration_name

# 重置資料庫（危險！會清空所有資料）
pnpm --filter @open333crm/db exec prisma migrate reset

# 打開 Prisma Studio（資料庫 GUI）
pnpm --filter @open333crm/db exec prisma studio
```

### Docker 常用指令

```bash
# 查看所有容器
docker compose ps

# 查看日誌
docker compose logs -f postgres
docker compose logs -f redis

# 重啟服務
docker compose restart postgres

# 停止所有服務
docker compose down

# 完全清理（包含 volumes，會刪除資料！）
docker compose down -v
```

### 資料庫備份與還原

```bash
# 備份完整資料庫
docker exec open333crm-postgres pg_dump -U crm open333crm > backup.sql

# 只備份資料（不含結構）
docker exec open333crm-postgres pg_dump -U crm --data-only --inserts open333crm > data.sql

# 還原資料庫
docker exec -i open333crm-postgres psql -U crm open333crm < backup.sql
```

## 📡 API 文件

### 基礎資訊

- **Base URL**: `http://localhost:3001/api/v1`
- **認證方式**: JWT Bearer Token
- **Content-Type**: `application/json`

### 主要端點

#### 認證
- `POST /auth/login` - 登入
- `POST /auth/register` - 註冊
- `GET /auth/me` - 取得當前用戶資訊

#### 對話管理
- `GET /conversations` - 取得對話列表
- `GET /conversations/:id` - 取得對話詳情
- `POST /conversations/:id/messages` - 發送訊息
- `PATCH /conversations/:id/assign` - 分配對話

#### 案件管理
- `GET /cases` - 取得案件列表
- `POST /cases` - 建立案件
- `PATCH /cases/:id` - 更新案件
- `POST /cases/:id/csat` - 記錄 CSAT 評分

#### 聯絡人
- `GET /contacts` - 取得聯絡人列表
- `POST /contacts` - 建立聯絡人
- `PATCH /contacts/:id` - 更新聯絡人
- `POST /contacts/:id/tags` - 新增標籤

#### 自動化
- `GET /automation/rules` - 取得規則列表
- `POST /automation/rules` - 建立規則
- `PATCH /automation/rules/:id` - 更新規則

#### 分析
- `GET /analytics/overview` - 總覽數據
- `GET /analytics/message-trend` - 訊息趨勢
- `GET /analytics/cases` - 案件統計
- `POST /analytics/export` - 匯出報表

#### 行銷
- `GET /marketing/campaigns` - 活動列表
- `POST /marketing/broadcasts` - 建立廣播
- `GET /marketing/segments` - 分群列表
- `GET /marketing/templates` - 模板列表

#### 粉絲活動
- `GET /portal/activities` - 活動列表
- `POST /portal/activities` - 建立活動
- `GET /portal/submissions` - 提交記錄

#### 短連結
- `GET /shortlinks` - 短連結列表
- `POST /shortlinks` - 建立短連結
- `GET /shortlinks/:id/stats` - 點擊統計

完整 API 文件請參考：[API 端點列表](docs/api-endpoints.md)（109+ 端點）

## 🔌 WebSocket 事件

客戶端連線至 `ws://localhost:3001`，需提供 JWT token 認證。

### 伺服器推送事件

```typescript
// 新訊息
socket.on('message:new', (data: { conversationId, message }) => {})

// 對話更新
socket.on('conversation:updated', (data: { conversation }) => {})

// 案件更新
socket.on('case:updated', (data: { case }) => {})

// 通知
socket.on('notification', (data: { type, title, message }) => {})

// 用戶狀態變更
socket.on('user:status', (data: { userId, status }) => {})
```

### 客戶端發送事件

```typescript
// 加入對話房間
socket.emit('conversation:join', { conversationId })

// 離開對話房間
socket.emit('conversation:leave', { conversationId })

// 正在輸入
socket.emit('typing:start', { conversationId })
socket.emit('typing:stop', { conversationId })
```

## 🎯 部署指南

### 環境需求

- **Node.js** >= 18.0.0
- **PostgreSQL** >= 14
- **Redis** >= 6
- **Nginx** (反向代理)
- **SSL 憑證** (生產環境必須)

### Docker 生產部署

```bash
# 1. 構建生產映像
docker compose -f docker-compose.prod.yml build

# 2. 啟動服務
docker compose -f docker-compose.prod.yml up -d

# 3. 執行 Migrations
docker compose -f docker-compose.prod.yml exec api pnpm prisma migrate deploy

# 4. 檢查服務
docker compose -f docker-compose.prod.yml ps
```

### 環境變數檢查清單

生產環境必須修改的環境變數：

- [ ] `JWT_SECRET` - 使用強隨機字串
- [ ] `DATABASE_URL` - 生產資料庫連線
- [ ] `REDIS_URL` - 生產 Redis 連線
- [ ] `S3_*` - 正式 S3 或 MinIO 配置
- [ ] `LINE_*` - 正式 LINE 憑證
- [ ] `FB_APP_SECRET` - 正式 Facebook 憑證
- [ ] `NEXT_PUBLIC_API_URL` - 正式 API 網址

### Nginx 配置範例

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 前端
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket
    location /socket.io {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 🧪 測試

```bash
# 執行所有測試
pnpm test

# 執行特定套件測試
pnpm --filter @open333crm/api test
pnpm --filter @open333crm/web test

# 執行 E2E 測試
pnpm test:e2e

# 測試覆蓋率
pnpm test:coverage
```

## 📊 資料庫 Schema

主要資料表：

- **agents** - 客服人員
- **contacts** - 聯絡人
- **conversations** - 對話
- **messages** - 訊息
- **cases** - 案件
- **channels** - 渠道配置
- **automation_rules** - 自動化規則
- **templates** - 訊息模板
- **daily_stats** - 每日統計
- **campaigns** - 行銷活動
- **broadcasts** - 廣播記錄
- **portal_activities** - 粉絲活動
- **short_links** - 短連結

完整 Schema 請參考 [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma)

## 🐛 故障排除

### 常見問題

#### Q: PostgreSQL 連線失敗（port 5432）
A: 本專案使用 **port 5433**（避免與本機 PostgreSQL 衝突），請確認 `DATABASE_URL` 設定正確。

#### Q: Redis 連線失敗（port 6379）
A: 本專案使用 **port 6380**，請確認 `REDIS_URL` 設定正確。

#### Q: Docker 指令找不到
A: macOS 用戶請確保 Docker 在 PATH 中：
```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

#### Q: Prisma Client 找不到
A: 執行以下指令重新生成：
```bash
pnpm --filter @open333crm/db exec prisma generate
```

#### Q: ESM import 錯誤
A: 確保 workspace packages 的 `package.json` 中有 `"type": "module"` 和正確的 `"exports"` 設定。

#### Q: LINE/Facebook Webhook 無法接收訊息
A: 確保：
1. 使用公開 URL（可用 ngrok）
2. Webhook URL 格式正確：`https://your-domain.com/api/v1/channels/line/webhook`
3. Channel 已正確設定並啟用

## 📚 進階主題

### 自定義自動化規則

```typescript
// 範例：自動標記 VIP 客戶
{
  name: "標記高價值客戶",
  trigger: {
    type: "case.created"
  },
  conditions: {
    all: [
      {
        fact: "case",
        path: "$.priority",
        operator: "equal",
        value: "HIGH"
      }
    ]
  },
  actions: [
    {
      type: "add_tag",
      params: {
        tagName: "VIP"
      }
    },
    {
      type: "notify_supervisor",
      params: {
        message: "發現高優先級案件"
      }
    }
  ]
}
```

### 自定義 LLM 提示詞

編輯 `apps/api/src/modules/ai/llm.service.ts` 調整系統提示詞：

```typescript
const systemPrompt = `你是一個專業的客服助理...`;
```

### 擴展新渠道

1. 在 `apps/api/src/channels/` 新增渠道資料夾
2. 實作 `ChannelPlugin` 介面
3. 註冊到 `main.ts`

## 🤝 貢獻指南

歡迎提交 Issue 和 Pull Request！

### 開發流程

1. Fork 本專案
2. 創建功能分支 (`git checkout -b feat/amazing-feature`)
3. 提交變更 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feat/amazing-feature`)
5. 開啟 Pull Request

### Commit 規範

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

- `feat:` 新功能
- `fix:` 錯誤修復
- `docs:` 文件更新
- `style:` 程式碼格式（不影響功能）
- `refactor:` 重構
- `perf:` 效能優化
- `test:` 測試
- `chore:` 建置流程或輔助工具

## 📄 授權

本專案採用 GNU General Public License v3.0 授權條款 - 詳見 [LICENSE](LICENSE) 檔案

## 🙏 致謝

本專案使用以下優秀的開源專案：

- [Next.js](https://nextjs.org/) - React 框架
- [Fastify](https://www.fastify.io/) - Web 框架
- [Prisma](https://www.prisma.io/) - ORM
- [shadcn/ui](https://ui.shadcn.com/) - UI 組件
- [Socket.io](https://socket.io/) - WebSocket
- [Ollama](https://ollama.ai/) - LLM 推論引擎

## 📞 聯絡方式

- **專案維護者**: CreateIntelligens
- **GitHub**: https://github.com/CreateIntelligens/open333crm
- **Issue Tracker**: https://github.com/CreateIntelligens/open333crm/issues

---

**Built with ❤️ by CreateIntelligens Team**

*最後更新：2026-03-25*
