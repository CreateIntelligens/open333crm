## ADDED Requirements

### Requirement: 群發只能使用能主動推送的渠道

群發（含附券廣播與券詳情的批次發券）的渠道 SHALL 是能主動推送訊息的渠道（LINE、Facebook、Instagram）。建立或送出渠道為網站聊天室的群發時，系統 SHALL 回 400、code `CHANNEL_PUSH_NOT_SUPPORTED` 與中文原因，不建立、不送出也不排入發送。已存在的這類群發被排程或背景工作執行時，系統 SHALL 標為失敗並寫入原因，不呼叫渠道、不發券。群發頁的渠道選單 SHALL 只列能主動推送的渠道。

#### Scenario: 建立網站聊天室的群發

- **WHEN** 管理者以網站聊天室渠道建立群發
- **THEN** 系統回 400，code 為 `CHANNEL_PUSH_NOT_SUPPORTED`，不建立廣播

#### Scenario: 送出網站聊天室的舊草稿

- **GIVEN** 修正前建立、渠道為網站聊天室的群發草稿
- **WHEN** 管理者按下送出
- **THEN** 系統回 400，code 為 `CHANNEL_PUSH_NOT_SUPPORTED`，廣播標為失敗並寫入原因，沒有呼叫渠道送出

#### Scenario: 送出網站聊天室的附券廣播

- **GIVEN** 修正前建立、渠道為網站聊天室的附券廣播草稿
- **WHEN** 管理者按下送出
- **THEN** 系統回 400，code 為 `CHANNEL_PUSH_NOT_SUPPORTED`，廣播沒有排入發送

#### Scenario: 排程到期的網站聊天室附券廣播

- **GIVEN** 修正前排定、渠道為網站聊天室的附券廣播
- **WHEN** 排程或背景工作執行這則廣播
- **THEN** 廣播標為失敗，failureCode 為 `CHANNEL_PUSH_NOT_SUPPORTED` 並寫入原因，沒有發出任何券也沒有呼叫渠道

#### Scenario: LINE 群發不受影響

- **WHEN** 管理者以 LINE 渠道建立並送出群發
- **THEN** 群發照常建立並送出

#### Scenario: 群發頁的渠道選單

- **GIVEN** 租戶有啟用中的 LINE 與網站聊天室渠道
- **WHEN** 管理者開啟建立群發的渠道選單
- **THEN** 選單只有 LINE 渠道
