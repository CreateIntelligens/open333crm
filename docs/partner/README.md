# 合作方對接文件

放置給外部合作方（partners）使用的 API 串接文件。

## 索引

| 文件 | 對象 | 內容 |
|---|---|---|
| [`PARTNER_INGEST_API.md`](./PARTNER_INGEST_API.md) | Stanley / Chatbot 系統 | 知識點推送 API 完整規格、curl 範例、FAQ |
| [`partner-ingest.postman_collection.json`](./partner-ingest.postman_collection.json) | Stanley | Postman v2.1 collection，9 個測試情境 |

## 給 Stanley 的快速指引

1. 讀 [`PARTNER_INGEST_API.md`](./PARTNER_INGEST_API.md) 第 1~6 章了解規格
2. **環境**：`https://uat.open333crm.create360.ai`（POC 階段唯一環境）
3. **API Key**：由 Daniel 透過 LINE 私訊提供，**不要寫進 git / email / 公開頻道**
4. 匯入 Postman collection，環境變數已預設好 `baseUrl`，只需填 `partnerKey`
5. 跑 collection 內 1~9 號 request，對照預期結果
6. 整合到自己系統後，建議先連續跑兩三天觀察錯誤率再大量推

## 給內部維護者

- 改 API 行為時，**先改 `openspec/specs/km-ingestion/spec.md`**（規格），再改 code，再回頭更新本文件
- 變更歷史記在 [`PARTNER_INGEST_API.md`](./PARTNER_INGEST_API.md) §10
- 給合作方的 API Key 是 partner 級別，建議：
  - 每個合作方各自一把
  - 不要寫進 git（即使是 example 也別寫真 key）
  - 定期 rotate（每 6~12 個月）
