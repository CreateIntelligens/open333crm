## MODIFIED Requirements

### Requirement: 發布時活動必須有可作答的內容

發布活動時，投票與競猜沒有任何選項、表單沒有任何欄位，或競猜沒有任何選項標為正確答案，系統 MUST 回 400，錯誤訊息 MUST 說明缺少的內容，活動 MUST 維持草稿。建立草稿與編輯草稿時 MUST 允許沒有選項、欄位或正確答案。投票不要求正確答案。

#### Scenario: 建立沒有選項或欄位的草稿仍然允許

- **WHEN** 成員送出不含 `options` 與 `fields` 的 `POST /portal/activities`，類型為投票、競猜或表單
- **THEN** 回 200，活動狀態為 `DRAFT`

#### Scenario: 發布沒有選項的投票或競猜回 400，活動仍是草稿

- **WHEN** 成員對沒有選項的投票或競猜草稿送出 `POST /portal/activities/:id/publish`
- **THEN** 回 400，`error.message` 為「投票與競猜活動至少要有一個選項」，`GET /portal/activities/:id` 的狀態仍是 `DRAFT`

#### Scenario: 發布沒有欄位的表單回 400，活動仍是草稿

- **WHEN** 成員對沒有欄位的表單草稿送出 `POST /portal/activities/:id/publish`
- **THEN** 回 400，`error.message` 為「表單活動至少要有一個欄位」，`GET /portal/activities/:id` 的狀態仍是 `DRAFT`

#### Scenario: 草稿補上選項或欄位後可以發布

- **WHEN** 成員對空的投票、競猜草稿以 `PATCH` 補上選項（競猜至少一個標為正確答案），或對空的表單草稿補上欄位，再送出 `POST /portal/activities/:id/publish`
- **THEN** 回 200，活動狀態為 `PUBLISHED`

#### Scenario: 發布沒有正確答案的競猜回 400，活動仍是草稿

- **WHEN** 成員對有選項、但沒有任何選項的 `isCorrect` 為 true 的競猜草稿送出 `POST /portal/activities/:id/publish`
- **THEN** 回 400，`error.message` 為「競猜活動至少要有一個正確答案」，`GET /portal/activities/:id` 的狀態仍是 `DRAFT`，`publishedAt` 為 null

#### Scenario: 有正確答案的競猜可以發布

- **WHEN** 成員對至少一個選項標為正確答案的競猜草稿送出 `POST /portal/activities/:id/publish`
- **THEN** 回 200，活動狀態為 `PUBLISHED`

#### Scenario: 投票沒有正確答案仍然可以發布

- **WHEN** 成員對有選項、但沒有任何選項標為正確答案的投票草稿送出 `POST /portal/activities/:id/publish`
- **THEN** 回 200，活動狀態為 `PUBLISHED`

#### Scenario: 沒有正確答案的競猜草稿可以建立與儲存

- **WHEN** 成員以沒有正確答案的選項送出 `POST /portal/activities` 建立競猜，或以 `PATCH /portal/activities/:id` 把競猜草稿的選項改成沒有正確答案
- **THEN** 回 200，活動狀態為 `DRAFT`

#### Scenario: 競猜的選項區提示發布前要勾正確答案

- **WHEN** 成員在建立活動對話框把類型選為競猜
- **THEN** 選項區顯示「發布前至少勾選一個正確答案」；類型為投票時不顯示
