# 實作落差與驗證紀錄

本文件集中記錄系統盤點時發現的實作落差。其他系統文件只描述主要結構，不重複問題細節。

- **驗證環境**：`docker compose -f docker-compose.dev.yml`
- **執行時驗證日期**：2026-09-02
- **靜態複查日期**：2026-09-11，結果見[複查紀錄](#複查紀錄)。
- **限制**：開發環境沒有 Ollama，因此部分模型問題只能用設定與資料庫狀態驗證。

## 摘要

| ID | 範圍 | 問題 | 驗證狀態 |
| --- | --- | --- | --- |
| DEP-01 | 部署 | `video-worker` 只剩殘留 volume 設定 | 靜態確認 |
| APP-01 | Apps | `core` 載入時啟動另一套 SLA consumer | 執行時確認 |
| APP-02 | Apps | Telegram 外掛未註冊 | 執行時確認 |
| APP-03 | Apps | 啟動 log 少列 Threads | 執行時確認 |
| APP-04 | Apps | API 的 `*.worker.ts` 實際是 Queue producer | 靜態確認 |
| PKG-01 | Packages | `types` 與 `shared` 重複定義渠道型別 | 靜態確認 |
| PKG-02 | Packages | `channel-plugins/fb` 子路徑指向錯誤 | 執行時重現 |
| PKG-03 | Packages | `brain` 尚未接線，仍持續建置與監看 | 執行時確認 |
| PKG-04 | Packages | `ui` 是空殼，仍持續建置與監看 | 執行時確認 |
| STO-01 | Storage | Workers 的 MinIO 設定名稱不一致 | 執行時重現 |
| LLM-01 | LLM | Ollama base URL 預設指向容器自己 | 執行時重現 |
| LLM-02 | LLM | Compose 與資料庫的 Chat 模型預設不同 | 部分驗證 |
| LLM-03 | LLM | API 宣告的 `OLLAMA_*` 沒有影響實際設定 | 執行時確認 |
| DB-01 | Database | Prisma 與資料庫的向量維度不一致 | 執行時重現 |
| LIC-01 | License | API 使用寫死的授權資料 | 間接確認 |
| LIC-02 | License | 可連線的 Core LicenseService 沒有使用者 | 靜態確認 |
| SEC-01 | Security | Workers 的渠道加密金鑰仍有硬編碼備援值（API 已修正） | 靜態確認 |
| CI-01 | CI | 沒有 CI workflow 執行 API 測試 | 靜態確認 |
| CI-02 | CI | 沒有 CI workflow 執行 lint | 靜態確認 |
| CI-03 | Test | Vitest API 與 `tsx` 執行方式不一致 | 靜態確認 |

## 部署與應用程式

### DEP-01：殘留的 Video Worker 設定

`apps/video-worker` 沒有原始碼與 `package.json`，但開發 Compose 仍保留 `nm_videoworker` volume 與掛載點。

### APP-01：兩套 SLA 機制

`packages/core/src/cases/case-service.ts` 在模組載入時建立 `sla-monitoring` consumer。任何匯入 `@open333crm/core` 的程序都會產生副作用。`apps/workers` 另有正式的 `sla` consumer，因此 Redis 同時出現 `sla` 與 `sla-monitoring`。

執行時匯入 `@open333crm/core` 會立即建立 Redis 連線，證實模組載入具有副作用。

### APP-02：Telegram 未註冊

渠道套件只匯出 `TelegramPlugin` 類別，沒有 `telegramPlugin` 實例。API 因此無法將 Telegram 傳給 `registerChannelPlugin()`。執行時檢查顯示 LINE、Facebook、WebChat、Threads 已註冊，Telegram 未註冊。

### APP-03：啟動 log 過時

API 啟動 log 寫死為 `LINE, FB, WEBCHAT`，但實際註冊表也包含 Threads。

### APP-04：Worker 檔名與內容不符

API 的 `automation.worker.ts` 與 `notification.worker.ts` 只建立 Queue producer。真正的 consumer 位於 `apps/workers`。

## 共用套件

### PKG-01：重複的渠道型別

`packages/types` 與 `packages/shared` 都定義 `ChannelType`、`MessageContentType`。兩份定義目前相同，但沒有同步機制。

### PKG-02：錯誤的 Facebook 子路徑

`channel-plugins` 的 `./fb` export 指向 `dist/fb/index.js`，實際輸出位於 `dist/facebook/index.js`。容器內執行 `import('@open333crm/channel-plugins/fb')` 會回傳 `ERR_MODULE_NOT_FOUND`。

### PKG-03、PKG-04：未接線套件仍持續建置

`brain` 沒有 app 使用者；`ui` 只有空匯出。兩者仍由開發環境的 `packages` 服務建置並啟動 watch process。

## Storage、LLM 與資料庫

### STO-01：Workers 無法連線 MinIO

Workers 的 `MinioStorageProvider` 讀取 `MINIO_*`，但 `.env.workers` 提供 `S3_*`。`STORAGE_PROVIDER` 也沒有程式讀取。Provider 最後採用 `localhost:9000`，在 Workers 容器內會連回自己。

執行時呼叫 `listBuckets()` 已重現 `ECONNREFUSED`。

### LLM-01：Ollama 位址錯誤

`tenant_settings.chatBaseUrl` 與 `embeddingBaseUrl` 預設為 `http://localhost:11434`。在 API 容器內，這個位址指向 API 自己，不是 `ollama` 容器。執行時連線已重現 `Connection refused`。

### LLM-02：Chat 模型預設不一致

Compose 預設下載 `qwen2.5:0.5b`；資料庫欄位預設為 `qwen2.5:3b`。開發環境沒有 Ollama，因此只確認兩邊設定值不同。

### LLM-03：未生效的 API 環境變數

API 容器有 `OLLAMA_BASE_URL`，但 Chat 與 Embedding 的實際設定來自 `tenant_settings`。`apps/api/src/config/env.ts` 宣告的三個 `OLLAMA_*` 變數不影響這條執行路徑。

### DB-01：向量維度不一致

Prisma schema 與程式常數使用 1024 維。執行中的 `km_articles.embedding` 與 `long_term_memories.embedding` 欄位都是 `vector(1536)`。預設的 `bge-m3` 產生 1024 維向量，直接寫入會被資料庫拒絕。

## 授權與安全

### LIC-01、LIC-02：兩份 LicenseService

`license.guard.ts` 使用 `apps/api/src/services/license.ts`。該實作直接建立寫死的授權資料，不會連線到授權伺服器。

`packages/core/src/license/license-service.ts` 會呼叫 `LICENSE_FETCH_URL`，但沒有實際使用者。

### SEC-01：渠道加密金鑰備援值

盤點時，API 的 `channel.service.ts` 與 Workers 的 `apps/workers/src/lib/credentials.ts` 都有同一個備援字串。缺少 `CREDENTIAL_ENCRYPTION_KEY` 時，兩個檔案都改用這個公開在原始碼中的字串。

Commit `f507fe1` 修正了 API 端：

- `channel.service.ts` 在金鑰缺少或長度不足時拋出錯誤。
- API 啟動時的環境變數驗證要求這個變數，設定缺失會讓 API 啟動失敗。

Workers 端尚未修正。`credentials.ts` 仍保留備援字串，設定缺失不會讓 Workers 啟動失敗。Workers 只用這把金鑰解密，因此不會用備援值加密新資料。Workers 缺少金鑰時，這項設定錯誤要到 Workers 解密渠道憑證時才會出現。

## CI 與測試

盤點時，`.github/workflows/ci.yml` 只執行 RLS 隔離測試，lint 步驟只輸出略過訊息。之後有 commit 刪除了 `ci.yml`，刪除經過見 `AGENTS.md` 的「CI gates」一節。目前唯一的 workflow 是 `deploy.yml`，它只負責部署到 UAT，不執行測試或 lint。

### CI-01：沒有 CI 執行 API 測試

沒有任何 CI workflow 執行 API 測試。API 測試也沒有統一入口。

### CI-02：沒有 CI 執行 lint

`eslint.config.js` 與 `pnpm lint` 已存在，但沒有任何 CI workflow 執行 lint。

### CI-03：測試工具未整合

測試檔使用 Vitest API，卻由 `tsx` 個別執行。專案無法使用 Vitest 的統一執行、覆蓋率及 watch mode。

## 複查紀錄

### 2026-09-11：所有分支的靜態複查

複查範圍是所有本地與遠端分支的最新 commit。複查方式是用 `git grep` 比對每個項目的程式碼與設定，不啟動容器。比對規則先在盤點時的 commit `c6c4eff` 上執行，確認所有項目都判定為存在。

結果：

- SEC-01：包含 commit `f507fe1` 的分支已修正 API 端。Workers 端在每個分支上都仍存在。
- CI-01、CI-02：包含 commit `4b384b7` 的分支已沒有 `ci.yml`。本文件已依這個現況改寫兩個項目的描述。
- 其他項目：每個分支上都仍判定為存在。
- LIC-01 補充：未合併的分支 `feat/add-license-billing-strategy` 把 API 的 `LicenseService` 改成可切換的 provider，不再寫死授權資料。該分支仍不連線到授權伺服器，也沒有改動 Core 的 `LicenseService`。

## 已查證後排除的項目

以下項目在盤點時看起來像落差，查證後確認是刻意的設計，記錄於此避免重複回報。

### `broadcast` 佇列不是遺留物

`apps/workers/src/index.ts` 建立了一個 `broadcast` 佇列，但沒有對應的 consumer。這段程式的用途是清除 Redis 中殘留的 repeatable job：取得所有 repeatable job、逐一移除、然後關閉佇列。清理失敗時只記錄 warning，不影響啟動。原始碼的註解已說明這個意圖。

## 已核對的資料庫基線

2026-09-02 在開發環境核對以下資料：

| 項目 | 結果 |
| --- | --- |
| Prisma model | 78 |
| enum | 24 |
| migration | 45 |
| 外鍵 | 114 |
| 啟用及強制 RLS 的資料表 | 71 |
| 未啟用 RLS 的平台表 | 7 |
| `app_tenant.rolbypassrls` | `false` |
| `app_admin.rolbypassrls` | `true` |

未啟用 RLS 的平台表是 `model_pricings`、`plans`、`platform_audit_logs`、`platform_settings`、`platform_users`、`tenants`、`trial_signups`。

