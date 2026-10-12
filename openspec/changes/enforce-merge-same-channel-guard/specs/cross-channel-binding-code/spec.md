## ADDED Requirements

### Requirement: 確認時合併被拒絕須回覆顧客
兌換方回覆「確認綁定」、合併前檢查通過，但合併時合併引擎以 `SAME_CHANNEL_CONFLICT` 拒絕時（另一個合併同時併入發碼方），系統 SHALL 回覆同一渠道只能綁定一個帳號，SHALL 把代碼放回剩餘效期，SHALL NOT 恢復待確認狀態。

#### Scenario: 確認時另一個綁定剛完成
- **WHEN** 同一個 LINE 官方帳號的兩位使用者都兌換了發碼方的代碼，其中一位確認並完成合併後，另一位的確認在合併時被引擎拒絕
- **THEN** 後確認的一方 SHALL 收到同一渠道只能綁定一個帳號的說明，SHALL NOT 被合併，回覆「確認綁定」時 SHALL 收到沒有待確認的綁定
