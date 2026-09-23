# 實作落差複查紀錄

本文件按日期記錄[實作落差與驗證紀錄](./AUDIT.md)的複查結果。`AUDIT.md` 只描述各項目的現況；每次複查的範圍、方法與結果記錄在本文件。

新的複查紀錄加在最上方。

## 2026-09-23：所有分支的靜態複查，加上本機執行時重現

複查範圍是所有本地與遠端分支的最新 commit。做法分兩層：先用 `git grep` 比對每個項目的程式碼與設定，比對規則同樣先在盤點時的 commit `c6c4eff` 上驗證；再把 `docker-compose.dev.yml` 的開發環境啟動，實際重現其中十項。

靜態比對的結果：

- LLM-03：commit `ee251c8` 讓 `OLLAMA_BASE_URL` 對 Chat 生成路徑生效。`AUDIT.md` 已把這個項目改寫成部分修正，並列出仍然不讀環境變數的路徑。
- 其他 19 項：每個分支上都仍判定為存在。

執行時重現的結果：

| 項目 | 做法 | 結果 |
| --- | --- | --- |
| APP-01 | 掃 Redis 的 `bull:*` 鍵 | `sla` 與 `sla-monitoring` 同時存在 |
| APP-02 | 在 api 容器匯入 `@open333crm/channel-plugins` | 只匯出 `linePlugin`、`fbPlugin`、`webchatPlugin`、`threadsPlugin` 四個實例 |
| APP-03 | 比對啟動 log 與 `apps/api/src/index.ts` | log 寫 `LINE, FB, WEBCHAT`，程式註冊四個外掛 |
| PKG-02 | 在 api 容器 `import('@open333crm/channel-plugins/fb')` | `ERR_MODULE_NOT_FOUND` |
| PKG-03、PKG-04 | 看 `packages` 容器建置的目錄 | `brain` 與 `ui` 都在建置並啟動 watch |
| STO-01 | 在 workers 容器呼叫 `MinioStorageProvider` | `ECONNREFUSED 127.0.0.1:9000`。容器內只有 `S3_*`，沒有 `MINIO_*` |
| LLM-01、LLM-02 | 查 `tenant_settings` 的欄位預設值 | `chatBaseUrl` 與 `embeddingBaseUrl` 是 `http://localhost:11434`；`chatModel` 是 `qwen2.5:3b`，Compose 下載 `qwen2.5:0.5b` |
| DB-01 | 查 `information_schema` | 兩個 `embedding` 欄位都是 `vector(1536)` |
| DEP-01 | `docker volume ls` | `nm_videoworker` volume 存在，`apps/video-worker` 只有 `node_modules` |
| SEC-01 | 看 workers 容器的環境變數 | 本機有設定金鑰，因此本機不會走到備援字串。`credentials.ts` 的備援字串仍在 |

APP-01 另有一項旁證：在 api 容器單獨匯入 `@open333crm/channel-plugins` 之後，Node 程序不會自己結束，必須強制結束。匯入會連帶建立 Redis consumer。

本次另外發現兩件事，不屬於 `AUDIT.md` 的 20 個項目：

- `scripts/check-workspace-esm.mjs` 是 2026-09-15 新增的第三支嚴格檢查腳本，來自 CM-175 的 ESM interop 問題。三支腳本都沒有 CI 執行。`DELIVERY.md` 已補上這一支。
- 三支腳本在 `main` 上以 `--strict` 執行都通過。

## 2026-09-11：所有分支的靜態複查

複查範圍是所有本地與遠端分支的最新 commit。複查方式是用 `git grep` 比對每個項目的程式碼與設定，不啟動容器。比對規則先在盤點時的 commit `c6c4eff` 上執行，確認所有項目都判定為存在。

結果：

- SEC-01：包含 commit `f507fe1` 的分支已修正 API 端。Workers 端在每個分支上都仍存在。
- CI-01、CI-02：包含 commit `4b384b7` 的分支已沒有 `ci.yml`。`AUDIT.md` 已依這個現況改寫兩個項目的描述。
- 其他項目：每個分支上都仍判定為存在。
- LIC-01 補充：未合併的分支 `feat/add-license-billing-strategy` 把 API 的 `LicenseService` 改成可切換的 provider，不再寫死授權資料。該分支仍不連線到授權伺服器，也沒有改動 Core 的 `LicenseService`。
