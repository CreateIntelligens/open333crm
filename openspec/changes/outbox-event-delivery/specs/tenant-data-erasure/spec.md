# Spec Delta

## ADDED Requirements

### Requirement: worker 只處理 pending 的刪除請求

worker 開始處理刪除工作時，MUST 以條件更新把請求從 `pending` 改成 `processing`。請求不是 `pending` 時，worker MUST 直接結束，MUST NOT 刪除資料、改變請求狀態、寫稽核或通知。

#### Scenario: 已完成的請求再執行一次

- **WHEN** 硬刪除請求已經是 `completed`，同一個刪除工作再執行一次
- **THEN** 請求 MUST 仍是 `completed`，`error` MUST 是空值，系統 MUST NOT 寫新的稽核或通知

#### Scenario: 處理中的請求再執行一次

- **WHEN** 請求是 `processing`，同一個刪除工作同時又開始執行
- **THEN** 後開始的執行 MUST 直接結束，MUST NOT 刪除資料
