# Proposal

## Why

客服文字與文件擷取結果可能包含個人資料，目前會直接進入 AI 的上下文。提供預設關閉、平台管理員可逐租戶強制啟用的去識別化功能，讓平台能控制送往模型的文字內容。

## What Changes

- 增加逐租戶 AI 去識別化政策，預設關閉，平台後台可強制開啟或關閉並記錄操作。
- 啟用時，Chat、Agent 各輪上下文及 Embedding 的文字先經 2md 完整遮罩；服務失敗時停止該次模型呼叫。
- 平台租戶詳細頁增加狀態與開關，說明原文先交由 2md 處理、租戶端無法覆寫，以及原始客服紀錄的保存範圍。
- 僅使用遮罩後的文字，丟棄服務回傳的原文 mapping；不提供還原功能。

## Capabilities

### New Capabilities

- `ai-input-deidentification`: 平台強制的逐租戶 AI 文字去識別化政策、處理邊界與管理操作。

### Modified Capabilities

無。

## Impact

- API：新增 `/api/v1/platform/tenants/:id/ai-privacy` GET/PATCH。
- 平台政策使用既有 `PlatformSetting` 儲存，不增加資料表或 migration。
- 接入 `llm.service.ts`、`agent.service.ts` 與 `embedding.service.ts`；沿用呼叫端注入的 Prisma executor。
- 外部依賴為 `https://2md.aiurl.tw/api/deid`；此服務會收到待處理原文。OCR/文件轉換仍負責文字擷取，本功能保護後續模型輸入，圖片像素與既存資料不在此次重寫範圍。
- 停用時維持既有 AI 行為；啟用可能改變實體名稱、地址或數字的可用程度及向量檢索結果。
