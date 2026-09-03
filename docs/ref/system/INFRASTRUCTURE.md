# 基礎設施與外部整合

本文件說明資料服務、外部渠道、LLM 與授權服務的接線。資料表關聯請看 [`../DATABASE-ERD.md`](../DATABASE-ERD.md)。

## PostgreSQL

PostgreSQL 16 是主資料庫。專案啟用 pgvector 與 pgcrypto，並使用 Prisma 管理 schema 與 migrations。

租戶隔離包含兩層：

1. 應用程式查詢必須在 `where` 帶入 `tenantId`。
2. PostgreSQL RLS 讀取 session 變數 `app.current_tenant`。

| 資料庫角色 | 特性 | Prisma client |
| --- | --- | --- |
| `app_tenant` | 套用 RLS | `fastify.prisma`、`request.tenantPrisma`、`withTenant` |
| `app_admin` | `BYPASSRLS` | `fastify.prismaAdmin`，僅供白名單路徑使用 |

`withTenant` 在交易中設定 `SET LOCAL`。交易內的查詢必須使用 callback 收到的 `tx`，避免查詢落到沒有 tenant session 的其他連線。

## Redis

同一個 Redis 服務承擔三種用途：

| 用途 | 生產者 | 消費者或讀取者 |
| --- | --- | --- |
| BullMQ | API | Workers |
| `socket:emit` pub/sub | Workers | API 的 Socket plugin |
| 快取 | API | API |

另有 `domain:event` 頻道供跨程序領域事件使用。Workers 將 BullMQ 與 pub/sub 分成兩條連線，避免混用不同的連線要求。

## MinIO

MinIO 提供 S3 相容物件儲存。目前存在兩套儲存抽象：

| 項目 | `packages/core/src/storage` | `apps/api/src/modules/storage` |
| --- | --- | --- |
| SDK | `minio` | S3 SDK |
| 環境變數 | `MINIO_*` | `S3_*` |
| Bucket 模型 | 呼叫時傳入 bucket | 單一 bucket，以 tenant key 分區 |
| 主要使用者 | Workers 的匯出與刪除工作 | API 的 Storage 與 LINE Imagemap |

API 使用 `media`、`templates`、`exports`、`avatars`、`imagemap` 作為物件目錄。

## LLM

API 提供 Ollama 與 Gemini provider。租戶的 Chat 與 Embedding 設定儲存在 `tenant_settings`，包含 provider、模型及 base URL。Gemini API key 使用 AES-256-GCM 加密。

`packages/brain` 另有 OpenAI 語音轉文字與摘要程式碼，但目前沒有 app 匯入 `brain`。

開發 Compose 不提供 Ollama。需要本地模型時，開發者必須另外啟動 Ollama，並將租戶設定指向可連線的主機位址。

## 渠道平台

| 渠道 | 外部網域 | API 是否註冊 |
| --- | --- | --- |
| LINE Messaging | `api.line.me`、`api-data.line.me` | 是 |
| LINE Login、LIFF | `access.line.me`、`liff.line.me` | 是 |
| Facebook | `graph.facebook.com` | 是 |
| Threads、Instagram | `graph.instagram.com` | 是 |
| WebChat | 無外部網域 | 是 |
| Telegram | `api.telegram.org` | 否 |

每個租戶各自設定渠道憑證。系統以 `CREDENTIAL_ENCRYPTION_KEY` 進行 AES-256-GCM 加密，再寫入 `channels.credentialsEncrypted`。

## Webhook 方向

- `apps/api/src/modules/webhook` 接收渠道平台送入的 Webhook。
- `apps/api/src/modules/webhook-subscriptions` 將系統事件送到客戶系統。

兩個模組的資料方向相反。

## 授權服務

設計上的授權流程使用 `LICENSE_KEY` 與 `LICENSE_FETCH_URL` 取得授權 JSON，再由 `license.guard.ts` 檢查功能與額度。實際接線仍有未完成部分，詳見[實作落差與驗證紀錄](./AUDIT.md)。

