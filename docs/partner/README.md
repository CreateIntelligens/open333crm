# 合作方對接文件

放置給外部合作方（partners）使用的 API 串接文件。

## 文件清單

| 檔案 | 格式 | 用途 |
|---|---|---|
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.1 | **規格 single source of truth**。可匯入 Swagger UI / Postman / Insomnia / IDE 套件 |
| [`api.html`](./api.html) | Redoc 渲染靜態 HTML | 單檔離線文件。**直接 double-click 打開**就能看，不需網路與工具 |
| [`partner-ingest.postman_collection.json`](./partner-ingest.postman_collection.json) | Postman v2.1 | 9 個測試情境，匯入 Postman 後可直接 send |
| [`PARTNER_INGEST_API.md`](./PARTNER_INGEST_API.md) | Markdown | 補充說明（FAQ、整段 bash 測試腳本、給人讀） |

## 對接資訊

| 項目 | 值 |
|---|---|
| 環境 | UAT（POC 階段唯一環境） |
| Base URL | `https://uat.open333crm.create360.ai` |
| Endpoint | `POST /api/v1/knowledge/partner-ingest` |
| Content-Type | `multipart/form-data` |
| 認證 | `Authorization: Bearer pk_xxx`（私訊取得） |

## 給合作方的快速指引

**最快路徑（不需任何工具）**
1. 下載 [`api.html`](./api.html)，直接打開瀏覽器看
2. 用 [`partner-ingest.postman_collection.json`](./partner-ingest.postman_collection.json) 匯入 Postman，填上 API Key 直接打

**喜歡命令列的話**
1. 看 [`openapi.yaml`](./openapi.yaml) 規格
2. 跑 [`PARTNER_INGEST_API.md`](./PARTNER_INGEST_API.md) §7 的 bash 測試腳本（已預設 BASE_URL）

## 給內部維護者

### 修改流程
1. **先改 `openapi.yaml`**（規格 SOT）
2. 同步改 `apps/api/src/modules/knowledge/partner-ingest.service.ts` 與 routes
3. 同步改 `openspec/specs/km-ingestion/spec.md`
4. **重新產生 `api.html`**：
   ```bash
   npx @redocly/cli@latest build-docs docs/partner/openapi.yaml \
     --output docs/partner/api.html
   ```
5. **驗證 spec 合法**：
   ```bash
   npx @redocly/cli@latest lint docs/partner/openapi.yaml
   ```

### API Key 管理
- 每個合作方各自一把 `pk_xxx`
- 由 Daniel 透過 LINE 私訊提供
- **絕不寫進** git / email / Slack / GitHub PR / 對話記錄
- 建議定期 rotate（每 6~12 個月）
