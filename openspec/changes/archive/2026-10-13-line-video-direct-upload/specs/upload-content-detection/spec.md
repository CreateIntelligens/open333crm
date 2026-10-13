## MODIFIED Requirements

### Requirement: Presigned upload quarantine lifecycle

presigned upload MUST 先寫入 tenant-scoped quarantine object。上傳網址 MUST 以對外的 storage 網址（`S3_PUBLIC_URL`）簽名，讓瀏覽器可以直接上傳。系統 MUST 提供完成/掃描操作，在通過內容偵測與入口允許清單後，才 promote 成正式檔案並回傳可供業務使用的 key/URL；未完成、失敗或過期的 quarantine object MUST 不可被正式檔案 API 當作已驗證檔案使用。完成/掃描 MUST 只讀取偵測所需的檔案開頭與結尾，並以 storage 端複製 promote，不得把整個檔案讀進 API 記憶體。

#### Scenario: Presigned upload is promoted after scan

- **WHEN** client PUT 檔案至 quarantine presigned URL，接著呼叫 complete/scan 且內容通過偵測
- **THEN** 系統建立正式 tenant-scoped object、刪除或封存 quarantine object，並回傳驗證後的 key/URL

#### Scenario: Presigned upload fails content validation

- **WHEN** complete/scan 偵測到 bytes 與宣告 MIME/副檔名不一致或類型不在允許清單
- **THEN** 系統拒絕 promote、刪除 quarantine object 或標記為不可用，且不回傳可使用的正式 URL

#### Scenario: Upload URL is signed for the public storage host

- **WHEN** `S3_ENDPOINT` 是內部位址、`S3_PUBLIC_URL` 是對外網址時申請直傳
- **THEN** 回傳的上傳網址以 `S3_PUBLIC_URL` 的主機為開頭

#### Scenario: Large file is scanned from samples

- **WHEN** complete/scan 一個 150 MB 的 mp4
- **THEN** 系統只讀取檔案開頭與結尾的片段做偵測，以 storage 端複製建立正式 object，不讀取整個檔案

## ADDED Requirements

### Requirement: Presigned upload limits by purpose

申請直傳時 MUST 提供檔案大小與用途。每個用途 MUST 有大小上限與允許的內容類型：`generic` 25 MB、沿用一般上傳的允許清單；`line-video` 200 MB（LINE 影片訊息的上限）、只允許 `video/mp4`。系統 MUST 把檔案大小簽進上傳網址，使大小不同的上傳被 storage 拒收；complete/scan MUST 依同一用途再檢查實際大小與內容類型。

#### Scenario: Oversized presign request

- **WHEN** 以 `line-video` 申請 201 MB 的直傳，或以 `generic` 申請 26 MB 的直傳
- **THEN** 系統回 413，不簽發上傳網址

#### Scenario: Declared size is part of the signature

- **WHEN** 以 `line-video` 申請 150 MB 的直傳
- **THEN** 上傳網址的簽名包含 `content-length`，值為 150 MB

#### Scenario: Completed object exceeds the purpose limit

- **WHEN** complete/scan 以 `generic` 完成一個 30 MB 的 quarantine object
- **THEN** 系統回 413、刪除 quarantine object，不 promote

#### Scenario: LINE video purpose accepts only mp4

- **WHEN** 以 `line-video` complete/scan 一個 PNG
- **THEN** 系統拒絕 promote 並刪除 quarantine object
