## ADDED Requirements

### Requirement: 卡片訊息與圖文訊息的預覽文字

卡片訊息（`line_carousel`）和圖文訊息（`line_imagemap`）的編輯器 MUST 提供「預覽文字」欄位，存在 body 的 `altText`，最多 400 字。送到 LINE 的訊息 MUST 用 trim 後的 `altText`；沒填或只有空白時，卡片訊息 MUST 用「多頁訊息」，圖文訊息 MUST 用「圖文訊息」。卡片訊息切換頁面類型時 MUST 保留 `altText` 和 `endPage`。

#### Scenario: 送出卡片訊息時用填的預覽文字

- **WHEN** 卡片訊息的 body 是 `{ pageType: "product", pages: [...], altText: "  秋季新品上市  " }`
- **THEN** 送到 LINE 的 flex 訊息 `altText` 是 `"秋季新品上市"`

#### Scenario: 送出圖文訊息時用填的預覽文字

- **WHEN** 圖文訊息的 body 有 `altText: "點圖看優惠"`
- **THEN** 送到 LINE 的 imagemap 訊息 `altText` 是 `"點圖看優惠"`

#### Scenario: 沒填預覽文字時用預設文字

- **WHEN** 卡片訊息的 body 沒有 `altText`，或 `altText` 是 `"   "`
- **THEN** 送到 LINE 的 `altText` 是 `"多頁訊息"`
- **AND** 圖文訊息在同樣情況下送出 `"圖文訊息"`

#### Scenario: 在編輯器填預覽文字

- **WHEN** 使用者在卡片訊息或圖文訊息編輯器的「預覽文字」欄位輸入「秋季新品上市」
- **THEN** 編輯器回傳的 body 有 `altText: "秋季新品上市"`，其他欄位不變
- **AND** 欄位最多能輸入 400 字

#### Scenario: 切換卡片訊息的頁面類型時保留預覽文字

- **WHEN** 卡片訊息的 body 有 `altText` 和 `endPage`，使用者把頁面類型從「商品服務」切換成「地點」
- **THEN** 編輯器回傳的 body 仍有原本的 `altText` 和 `endPage`
