## ADDED Requirements

### Requirement: Video Upload Limits Follow Each Channel

素材編輯器上傳影片時 MUST 套用該渠道的檔案上限：LINE 影片 200 MB，FB 影片 25 MB。LINE 影片 MUST 走直傳（`line-video` 用途），不經過 API 的 multipart 上傳，並顯示上傳進度。超過上限的檔案 MUST 在選檔當下拒絕，訊息寫出檔案大小與上限。

#### Scenario: LINE video over 25 MB

- **WHEN** 使用者在 LINE 影片編輯器選擇 150 MB 的 mp4
- **THEN** 編輯器以 `line-video` 用途申請直傳並上傳，完成後把正式網址填入影片欄位

#### Scenario: LINE video over 200 MB

- **WHEN** 使用者在 LINE 影片編輯器選擇 201 MB 的 mp4
- **THEN** 編輯器顯示超過上限 200 MB，不申請直傳

#### Scenario: FB video over 25 MB

- **WHEN** 使用者在 FB 影片編輯器選擇 30 MB 的 mp4
- **THEN** 編輯器顯示超過上限 25 MB，不上傳
