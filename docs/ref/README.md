# docs/ref — 從程式碼推導的現況文件

這個目錄放**描述本 repo 現況**的參考文件。每份文件都標明資料來源，內容由原始碼與設定檔推導，不是設計稿。

設計階段的規劃文件在上一層 `docs/`（`00_` 到 `24_` 開頭的檔案）。當規劃文件與本目錄的文件衝突時，**以本目錄與原始碼為準**。

## 本 repo 的現況文件

| 文件                                                         | 內容                                                                               | 資料來源                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`SYSTEM-MINDMAP.md`](./SYSTEM-MINDMAP.md)                   | 系統由哪些元件組成、元件之間如何連接。7 個階段的心智圖，附落差清單與執行時驗證結果 | `docker-compose*.yml`、`pnpm-workspace.yaml`、各 `package.json` |
| [`DATABASE-ERD.md`](./DATABASE-ERD.md)                       | 資料表關聯與每張表儲存的資料類型                                                   | `packages/database/prisma/schema.prisma`                        |
| [`API-PLUGIN-ARCHITECTURE.md`](./API-PLUGIN-ARCHITECTURE.md) | `apps/api` 的 Fastify 外掛架構屬於哪些設計模式，以及這個寫法的取捨                 | `apps/api/src/index.ts`、`apps/api/src/plugins/*.ts`            |

## 外部系統的參考文件

[`legacy/`](./legacy/) 放的是**另一套 LINE CRM 系統**（Laravel 11 + Vue 3 + MongoDB）的文件，與本 repo 沒有共用程式碼。詳見 [`legacy/README.md`](./legacy/README.md)。

## 其他

| 文件                                 | 內容                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`rulesengine.md`](./rulesengine.md) | 一則設計建議備忘，主張自動化規則改用 `json-rules-engine`，並說明 Fact 注入的理由。這份不是現況文件，是決策討論紀錄。相關的設計文件是 `docs/automation-engine-design.md` |
