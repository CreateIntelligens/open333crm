# Spec Delta

## ADDED Requirements

### Requirement: worker 不重新處理已結束的刪除請求

worker 開始處理刪除工作時，MUST 以條件更新把請求從 `pending` 或 `processing` 改成 `processing`。請求是 `completed` 或 `failed` 時，worker MUST 直接結束，MUST NOT 刪除資料、改變請求狀態、寫稽核或通知。請求是 `processing` 時，代表上一次執行中途結束，worker MUST 重新處理。同一個請求的刪除 MUST 最多 commit 一次。

#### Scenario: 已完成的請求再執行一次

- **WHEN** 硬刪除請求已經是 `completed`，同一個刪除工作再執行一次
- **THEN** 請求 MUST 仍是 `completed`，`error` MUST 是空值，系統 MUST NOT 寫新的稽核或通知

#### Scenario: 上一次執行中途結束

- **WHEN** 匿名化請求是 `processing`，聯絡人的資料還沒有匿名化，同一個刪除工作再執行一次
- **THEN** 聯絡人 MUST 被匿名化，請求 MUST 是 `completed`

#### Scenario: 兩次同時執行

- **WHEN** 同一個硬刪除工作同時執行兩次
- **THEN** 請求 MUST 是 `completed`，`error` MUST 是空值，發起的成員 MUST 只收到一則完成通知
