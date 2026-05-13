# 合作方對接文件

放置給外部合作方（partners）使用的 API 串接文件。

## 索引

| 文件 | 對象 | 內容 |
|---|---|---|
| [`PARTNER_INGEST_API.md`](./PARTNER_INGEST_API.md) | Stanley / Chatbot 系統 | 知識點推送 API 完整規格、curl 範例、FAQ |
| [`partner-ingest.postman_collection.json`](./partner-ingest.postman_collection.json) | Stanley | Postman v2.1 collection，9 個測試情境 |

## 給 Stanley 的快速指引

1. 讀 [`PARTNER_INGEST_API.md`](./PARTNER_INGEST_API.md) 第 1~6 章了解規格
2. 匯入 Postman collection，設定 environment：
   - `baseUrl` = API 位址（向 Daniel 索取）
   - `partnerKey` = 你的 `pk_xxx`（向 Daniel 索取，不要寫進 git）
   - `docId` = 測試用 DocID（建議用 `TEST-` 開頭避免污染正式資料）
3. 跑 collection 內 1~9 號 request，對照預期結果
4. 整合到自己系統後，建議先在 UAT 環境跑兩三天觀察錯誤率，再切 production

## 給內部維護者

- 改 API 行為時，**先改 `openspec/specs/km-ingestion/spec.md`**（規格），再改 code，再回頭更新本文件
- 變更歷史記在 [`PARTNER_INGEST_API.md`](./PARTNER_INGEST_API.md) §10
- 給合作方的 API Key 是 partner 級別，建議：
  - 每個合作方各自一把
  - 不要寫進 git（即使是 example 也別寫真 key）
  - 定期 rotate（每 6~12 個月）
