## ADDED Requirements

### Requirement: 編輯草稿不會清掉沒有送出或不可為空的選項與欄位

編輯草稿時，請求沒有帶 `options` 時，系統 MUST NOT 改動活動的選項（含競猜的正確答案）；沒有帶 `fields` 時，MUST NOT 改動表單欄位。投票與競猜收到空的 `options`、表單收到空的 `fields` 時，系統 MUST 回 400，MUST NOT 刪除既有的選項或欄位，也 MUST NOT 儲存同一個請求的其他欄位。後台的編輯對話框 MUST 以完整活動（含選項與欄位）帶入內容；完整活動載入完成前 MUST NOT 允許儲存，載入失敗時 MUST 顯示錯誤並 MUST NOT 允許儲存。

#### Scenario: 只改標題時，選項、正確答案與表單欄位都保留

- **WHEN** 成員對有選項（其中一個標為正確答案）與表單欄位的草稿送出只含 `title` 的 `PATCH /portal/activities/:id`
- **THEN** 回 200，`GET /portal/activities/:id` 的標題已更新，選項、正確答案與表單欄位與編輯前相同

#### Scenario: 投票或競猜的選項送空陣列時回 400

- **WHEN** 成員對投票或競猜草稿送出 `options: []`
- **THEN** 回 400，選項與標題都維持編輯前的內容

#### Scenario: 表單的欄位送空陣列時回 400

- **WHEN** 成員對表單草稿送出 `fields: []`
- **THEN** 回 400，表單欄位維持編輯前的內容

#### Scenario: 編輯對話框帶出完整活動的選項

- **WHEN** 成員在活動卡片按「編輯」，完整活動載入完成後只改標題並儲存
- **THEN** 對話框顯示原本的選項與正確答案，送出的 `options` 包含原本的選項與正確答案

#### Scenario: 完整活動載入失敗時顯示錯誤且不能儲存

- **WHEN** 成員按「編輯」，`GET /portal/activities/:id` 失敗
- **THEN** 對話框顯示錯誤訊息，「儲存」按鈕停用，不送出 `PATCH`
