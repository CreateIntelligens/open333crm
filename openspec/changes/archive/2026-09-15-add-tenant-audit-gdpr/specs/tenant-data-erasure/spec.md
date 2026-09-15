## ADDED Requirements

### Requirement: 租戶可對聯絡人發起資料刪除
系統 SHALL 提供 API 讓具 `data.erase` 權限的成員針對指定聯絡人發起資料刪除，`mode` 為 `anonymize`（預設）或 `hard_delete`。發起後系統 MUST 建立一筆 `DataErasureRequest`（狀態 `pending`、綁定 `tenantId`、`contactId`、`requestedBy`），並以非同步 worker 處理。目標聯絡人 MUST 屬於當前租戶。發起與完成皆 MUST 寫入 `TenantAuditLog`（`data.erasure.request` / `data.erasure.complete`）。

#### Scenario: 發起匿名化
- **WHEN** 具 `data.erase` 權限的成員以 `anonymize` 模式對本租戶聯絡人發起刪除
- **THEN** 系統建立 `DataErasureRequest(mode=anonymize, status=pending)`、入列 job、寫稽核，並回傳請求 id

#### Scenario: 跨租戶目標被拒
- **WHEN** 成員嘗試對不屬於自己租戶的聯絡人發起刪除
- **THEN** 系統回傳 403/404 且不建立任何請求

#### Scenario: 無權限被拒
- **WHEN** 不具 `data.erase` 權限的成員發起刪除
- **THEN** 系統回傳 403

### Requirement: 匿名化抹除個資並保留營運統計
`anonymize` 模式 SHALL 抹除聯絡人的可識別個資（顯示名稱置換、電話/信箱/頭像清空）、刪除其聯絡人屬性與渠道身分綁定、清除其長期記憶，並抹除其 inbound 訊息內容，同時保留對話與案件的統計骨架（狀態、時間、CSAT 分數）。匿名化後該聯絡人 MUST 不再可被識別。

#### Scenario: 匿名化後不可識別
- **WHEN** worker 完成 `anonymize`
- **THEN** 聯絡人的姓名/電話/信箱/頭像已抹除、渠道身分綁定已移除、長期記憶已清除，但其歷史案件的統計數據仍存在

#### Scenario: 匿名化寫入影響量
- **WHEN** worker 完成 `anonymize`
- **THEN** `DataErasureRequest.status=completed` 且 `affected` 記錄受影響的對話/案件/訊息數，並寫入 `data.erasure.complete` 稽核

### Requirement: 硬刪連鎖移除且不可復原
`hard_delete` 模式 SHALL 永久刪除該聯絡人及其連鎖資料（渠道身分、屬性、關聯、對話與訊息、案件、長期記憶、身分映射、活動報名、點數紀錄）。硬刪 MUST 不可復原，且 MUST 僅沿該聯絡人的關聯鏈刪除，不得刪除其他聯絡人的資料。相關媒體附件 SHALL 一併從物件儲存移除。

#### Scenario: 硬刪連鎖生效
- **WHEN** worker 完成 `hard_delete`
- **THEN** 該聯絡人及其對話、訊息、案件、屬性、渠道身分等連鎖資料均已從資料庫移除

#### Scenario: 硬刪不波及他人
- **WHEN** 被硬刪的聯絡人與其他聯絡人存在關聯（ContactRelation）
- **THEN** 僅移除關聯紀錄本身，對方聯絡人資料保持完整

### Requirement: 刪除稽核不重新產生個資
記錄刪除動作的 `TenantAuditLog` MUST NOT 包含被刪除的個資本身，`payload` 僅存目標聯絡人 id、模式與影響量統計。

#### Scenario: 稽核不含 PII
- **WHEN** 系統為刪除動作寫入稽核
- **THEN** 稽核 `payload` 只含 `contactId`、`mode` 與計數，不含姓名/電話/信箱等被刪的個資
