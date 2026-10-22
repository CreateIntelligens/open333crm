# Spec Delta

## ADDED Requirements

### Requirement: worker 不重新處理已結束的匯出請求

worker 開始處理匯出工作時，MUST 以條件更新把請求從 `pending` 或 `processing` 改成 `processing`。請求是 `completed`、`failed` 或 `expired` 時，worker MUST 直接結束，MUST NOT 產生或上傳匯出檔、改變請求狀態或通知。請求是 `processing` 時，代表上一次執行中途結束，worker MUST 重新處理。把請求改成 `completed` 時 MUST 以 `processing` 為條件，條件不成立時 MUST NOT 通知。

#### Scenario: 已完成的請求再執行一次

- **WHEN** 匯出請求已經是 `completed`，同一個匯出工作再執行一次
- **THEN** 請求的 `fileKey` 與 `expiresAt` MUST 不變，發起的成員 MUST NOT 收到第二則完成通知

#### Scenario: 上一次執行中途結束

- **WHEN** 匯出請求是 `processing`，`fileKey` 是空值，同一個匯出工作再執行一次
- **THEN** 請求 MUST 是 `completed` 並有 `fileKey`，發起的成員 MUST 收到一則完成通知

#### Scenario: 兩次同時執行

- **WHEN** 同一個匯出工作同時執行兩次
- **THEN** 請求 MUST 是 `completed`，發起的成員 MUST 只收到一則完成通知
