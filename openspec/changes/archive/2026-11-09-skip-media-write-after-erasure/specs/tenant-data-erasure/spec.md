## ADDED Requirements

### Requirement: 刪除期間完成的進站媒體下載不寫回

進站媒體下載完成（或失敗）後，系統 SHALL 在一個交易內先以 `FOR SHARE` 鎖住訊息的對話，只在訊息內容仍等於下載前讀到的內容時寫回。條件不成立（例如已被匿名化或刪除）時，系統 SHALL NOT 寫入、SHALL NOT 推送 `message.new`，並 SHALL 刪除剛上傳的物件，最多一次，失敗寫進 log。

#### Scenario: 下載完成時訊息沒有變動
- **WHEN** 進站圖片下載完成時，訊息內容與下載前相同
- **THEN** 訊息寫入 `storageKey`、`url` 與 `mediaUrl`，物件不刪

#### Scenario: 下載期間訊息被匿名化
- **WHEN** 進站圖片下載期間，worker 把這則訊息改成 `{ redacted: true }`，之後下載完成
- **THEN** 訊息仍是 `{ redacted: true }`，剛上傳的物件已刪除

#### Scenario: 匿名化的交易進行中下載完成
- **WHEN** 匿名化的交易已鎖住對話並讀完訊息、還沒改寫時，進站圖片下載完成
- **THEN** 寫回等匿名化 commit，之後不寫入，訊息是 `{ redacted: true }`，剛上傳的物件已刪除

#### Scenario: 下載失敗時訊息已被匿名化
- **WHEN** 進站圖片下載失敗時，訊息已是 `{ redacted: true }`
- **THEN** 訊息仍是 `{ redacted: true }`，不寫入原文與 `mediaError`
