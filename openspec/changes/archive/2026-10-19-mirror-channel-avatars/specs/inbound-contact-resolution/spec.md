## ADDED Requirements

### Requirement: 渠道頭像存進物件儲存

系統 SHALL 把渠道外掛 `getProfile()` 回傳的頭像下載到物件儲存的 `avatars` 目錄，並把渠道身分的 `profilePic` 改成物件儲存的網址。聯絡人的 `avatarUrl` 與該身分原本的頭像網址相同時，系統 SHALL 也改成同一個網址。下載在背景執行，SHALL NOT 延後訊息落地。系統 SHALL 只下載 https、不解析到內部網路的網址，並只接受 5 MB 以下的 JPEG、PNG、WebP 或 GIF。

#### Scenario: 新聯絡人的頭像存進物件儲存
- **WHEN** 新的 uid 第一次進站，外掛回傳一個可下載的頭像網址
- **THEN** 訊息照常落地，背景下載完成後，渠道身分的 `profilePic` 與聯絡人的 `avatarUrl` 都是物件儲存 `avatars` 目錄的網址

#### Scenario: 舊身分在下次進站時補存
- **WHEN** 已有渠道身分的 uid 進站，`profilePic` 是已失效的平台網址
- **THEN** 系統重新呼叫 `getProfile()`，下載新的頭像網址，`profilePic` 與聯絡人的 `avatarUrl` 改成物件儲存的網址

#### Scenario: 已存過的頭像不再下載
- **WHEN** 渠道身分的 `profilePic` 已經是物件儲存的網址
- **THEN** 系統不呼叫 `getProfile()`，也不下載

#### Scenario: 客服改過的聯絡人頭像不覆蓋
- **WHEN** 聯絡人的 `avatarUrl` 與渠道身分的 `profilePic` 不同，系統補存該身分的頭像
- **THEN** 只有 `profilePic` 改成物件儲存的網址，聯絡人的 `avatarUrl` 不變

#### Scenario: 不安全或不是圖片的網址不存
- **WHEN** 頭像網址或它轉址到的網址不是 https 或解析到內部網路，或回應不是 JPEG、PNG、WebP、GIF，或超過 5 MB
- **THEN** 系統不上傳檔案，`profilePic` 不變

#### Scenario: 補存失敗後一小時內不重試
- **WHEN** 同一個渠道身分補存失敗，一小時內同一位顧客再次進站
- **THEN** 系統不再呼叫 `getProfile()`，也不下載
