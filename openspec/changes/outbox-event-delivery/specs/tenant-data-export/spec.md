# Spec Delta

## ADDED Requirements

### Requirement: worker 只處理 pending 的匯出請求

worker 開始處理匯出工作時，MUST 以條件更新把請求從 `pending` 改成 `processing`。請求不是 `pending` 時，worker MUST 直接結束，MUST NOT 產生或上傳匯出檔、改變請求狀態或通知。

#### Scenario: 已完成的請求再執行一次

- **WHEN** 匯出請求已經是 `completed`，同一個匯出工作再執行一次
- **THEN** 請求的 `fileKey` 與 `expiresAt` MUST 不變，發起的成員 MUST NOT 收到第二則完成通知
