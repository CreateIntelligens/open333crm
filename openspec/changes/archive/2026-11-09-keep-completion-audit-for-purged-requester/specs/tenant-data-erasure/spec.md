## MODIFIED Requirements

### Requirement: 刪除完成時記錄結果

刪除成功後，系統 SHALL 在刪除的同一個交易把請求改為 `completed`、`affected` 記錄各類資料的筆數，並寫一筆 `data.erasure.complete` 稽核。稽核寫不進去時，刪除 SHALL rollback，請求改為 `failed`。發起的成員還在時，稽核的 `actorId` 是他，交易 commit 之後系統 SHALL 通知他。稽核的 `payload` SHALL 只有 `contactId`、`mode` 與 `affected`，SHALL NOT 包含被刪除的個人資料。

處理失敗時，請求 SHALL 改為 `failed` 並記錄 `error`。

#### Scenario: 完成稽核不含個人資料
- **WHEN** worker 完成一位聯絡人的刪除
- **THEN** 請求是 `completed`，稽核的 `payload` 只有 `contactId`、`mode` 與 `affected`，不含聯絡人的名稱、電話與 email

#### Scenario: 發起的成員還在時記下他並通知他
- **WHEN** worker 完成刪除，發起的成員還在
- **THEN** `data.erasure.complete` 稽核的 `actorId` 是發起的成員，`actorName` 與 `actorEmail` 是空值，發起的成員收到一則 `data_erasure_done` 通知

#### Scenario: 聯絡人已不存在時記錄失敗
- **WHEN** worker 開始處理時，請求指定的聯絡人已經不存在
- **THEN** 請求改為 `failed`，`error` 記錄原因

## ADDED Requirements

### Requirement: 發起的成員已被永久刪除時的完成稽核

刪除請求排隊中，發起的成員被永久刪除時，worker SHALL 照常完成刪除。worker SHALL 在寫完成稽核的同一個交易，以請求的 `tenantId` 查發起的成員。查不到時，`data.erasure.complete` 稽核的 `actorId` SHALL 是空值，`actorName`、`actorEmail` SHALL 是請求的 `requestedByName`、`requestedByEmail`。系統 SHALL NOT 送完成通知，SHALL 寫一行 log 說明略過。

#### Scenario: 發起的成員已被永久刪除時，完成稽核記下快照、不送通知
- **WHEN** 成員 X 發起刪除，請求還是 `pending` 時 X 被永久刪除，之後 worker 處理這個請求
- **THEN** 請求是 `completed`，有一筆 `data.erasure.complete` 稽核，`actorId` 是空值，`actorName` 與 `actorEmail` 是 X 的名稱與 email，系統沒有送出通知
