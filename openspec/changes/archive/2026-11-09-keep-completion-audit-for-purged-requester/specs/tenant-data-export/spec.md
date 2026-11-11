## MODIFIED Requirements

### Requirement: 產生匯出檔

workers 處理匯出工作時 SHALL 讀取該租戶的聯絡人（含渠道身分、屬性、標籤）、對話（含標籤）、訊息與工單（含備註、事件、標籤），打包成 zip：`manifest.json` 記錄各類的筆數，`json/` 存完整資料，`csv/` 存四個主表的扁平欄位。worker SHALL 只讀取該租戶的資料。

zip 上傳物件儲存後，請求 SHALL 改為 `completed`，記錄 `fileKey`、`fileSizeBytes`，`expiresAt` 是 7 天後。處理失敗時，請求 SHALL 改為 `failed` 並記錄 `error`。成功與失敗都 SHALL 通知發起的成員。worker 送通知前 SHALL 以請求的 `tenantId` 查發起的成員；查不到（已被永久刪除）時 SHALL NOT 送通知，SHALL 寫一行 log，請求的狀態不受影響。

#### Scenario: 匯出只含本租戶的資料
- **WHEN** worker 處理租戶 A 的匯出工作，租戶 B 也有聯絡人
- **THEN** 請求改為 `completed`，zip 裡的聯絡人只有租戶 A 的聯絡人，`manifest.json` 的筆數與 zip 內容相符，發起的成員收到完成通知
- **AND** JSON 裡的聯絡人含渠道身分、屬性與標籤，對話含標籤，工單含備註、事件與標籤

#### Scenario: 上傳失敗時記錄原因
- **WHEN** worker 上傳 zip 時物件儲存回傳錯誤
- **THEN** 請求改為 `failed`，`error` 記錄錯誤訊息，發起的成員收到失敗通知

#### Scenario: 發起的成員已被永久刪除時完成匯出、不送通知
- **WHEN** 成員 X 發起匯出，請求還是 `pending` 時 X 被永久刪除，之後 worker 處理這個請求
- **THEN** 請求是 `completed` 並有 `fileKey`，系統沒有送出通知

#### Scenario: 發起的成員已被永久刪除時匯出失敗、不送通知
- **WHEN** 成員 X 發起匯出後被永久刪除，worker 上傳 zip 時物件儲存回傳錯誤
- **THEN** 請求是 `failed`，`error` 記錄錯誤訊息，系統沒有送出通知
