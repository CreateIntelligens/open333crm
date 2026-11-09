## ADDED Requirements

### Requirement: 刪除期間並行寫入的訊息也被處理

兩種模式 SHALL 在讀取訊息之前，依序以 `FOR UPDATE` 鎖住被刪除的聯絡人與他的對話。刪除開始時還沒 commit 的進站訊息 SHALL 在 commit 之後被刪除讀到：`anonymize` 改寫它的內容並刪除它的媒體檔，`hard_delete` 刪除它的媒體檔。刪除開始之後才開始的寫入 SHALL 等刪除的交易結束。

#### Scenario: 刪除期間並行寫入的進站訊息也會被處理
- **WHEN** worker 開始刪除時，另一個交易正在這位聯絡人的對話插入一則帶媒體檔、還沒 commit 的進站訊息，之後才 commit
- **THEN** `anonymize` 時這則訊息的內容是 `{ redacted: true }`，媒體檔已刪除；`hard_delete` 時這則訊息已刪除，媒體檔也已刪除
