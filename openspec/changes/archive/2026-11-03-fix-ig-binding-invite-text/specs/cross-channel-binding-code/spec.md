## MODIFIED Requirements

### Requirement: 顧客可在對話中取得綁定代碼
租戶啟用後，顧客在任一渠道對話中傳送綁定關鍵字（預設「綁定帳號」），系統 SHALL 產生一組綁定該顧客目前渠道身分的一次性代碼，並回覆列出其他可綁定渠道的導流連結。LINE 連結的預填文字 SHALL 是「綁定 {代碼}」這個短句，不加其他說明文字：中文在網址裡會被編碼成 `%E7%B6%81…` 的長串，預填越長，顧客看到的網址越長。

#### Scenario: 從 FB 取得 LINE 與 IG 的導流連結
- **WHEN** 租戶有啟用中的 LINE、FB、IG 渠道且皆已設定導流識別，顧客在 FB 傳送「綁定帳號」
- **THEN** 系統 SHALL 回覆含 LINE `https://line.me/R/oaMessage/{basicId}/?{預填文字}` 與 IG `https://ig.me/m/{username}?ref={代碼}` 兩個連結的訊息，且不列出 FB 本身

#### Scenario: LINE 預填文字是短句
- **WHEN** 系統為代碼 `BIND-7K2M9QH4TX` 產生 LINE 的送出代碼連結
- **THEN** 連結 `?` 之後解碼的預填文字 SHALL 等於「綁定 BIND-7K2M9QH4TX」

#### Scenario: 未設定導流識別的渠道不列出
- **WHEN** 租戶的 IG 渠道尚未設定 username
- **THEN** 回覆的連結清單 SHALL 不包含該 IG 渠道

#### Scenario: 沒有任何可綁定渠道
- **WHEN** 除了顧客所在渠道外沒有其他可綁定渠道
- **THEN** 系統 SHALL 回覆目前沒有其他可綁定的渠道，且不產生代碼

#### Scenario: IG 連結說明請顧客送出代碼
- **WHEN** 系統為代碼 `BIND-7K2M9QH4TX` 回覆含 IG 導流連結的訊息
- **THEN** IG 段落 SHALL 請顧客開啟後傳送這組代碼，並寫出代碼 `BIND-7K2M9QH4TX`，且不寫「傳送任一訊息」
