## ADDED Requirements

### Requirement: 系統事件不觸發非營業時間的自動回覆
進站事件的 `contentType` 是系統事件（`follow`、`unfollow`、`join`、`leave`、`memberJoined`、`memberLeft`、`unsend`、`videoPlayComplete`、`accountLink`、`beacon`）時，系統 SHALL NOT 送出非營業時間的自動回覆，也 SHALL NOT 寫入自動回覆訊息。判斷依外掛解析後的 `contentType`，不依渠道類型。

#### Scenario: 非營業時間有人加好友
- **WHEN** 租戶開啟營業時間且現在是非營業時間，LINE 渠道收到 `follow` 事件
- **THEN** 對話裡沒有 `metadata.source` 為 `office_hours_auto_reply` 的訊息，系統沒有送出非營業時間訊息

#### Scenario: 非營業時間有人封鎖
- **WHEN** 租戶開啟營業時間且現在是非營業時間，已存在的渠道身分送來 `unfollow` 事件
- **THEN** 對話裡沒有 `metadata.source` 為 `office_hours_auto_reply` 的訊息

#### Scenario: 非營業時間的一般訊息照舊自動回覆
- **WHEN** 租戶開啟營業時間且現在是非營業時間，LINE 渠道收到一則文字訊息
- **THEN** 對話裡有一則 `metadata.source` 為 `office_hours_auto_reply` 的訊息，系統送出非營業時間訊息
