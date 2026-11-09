## MODIFIED Requirements

### Requirement: Automated Vectorization and Indexing

系統 SHALL 為每篇知識庫文章產生一個向量，存在文章自己的資料列，並記下產生向量所用的模型名稱。向量化的輸入是文章的標題、分類、標籤、規格、摘要、內容與附件檔名組成的文字，最多 4000 字元。租戶開啟 AI 個資遮罩時，系統 SHALL 先遮罩這段文字，再送去向量化服務。向量化服務的呼叫 MUST NOT 在資料庫交易內進行。

#### Scenario: Successful vectorization
- **WHEN** 系統向量化一篇文章，向量化服務回傳向量
- **THEN** 文章的向量是服務回傳的向量，`embeddingModel` 是租戶目前設定的模型

#### Scenario: 向量化服務失敗時不改向量
- **WHEN** 系統向量化一篇已有向量的文章，向量化服務回錯誤或逾時
- **THEN** 文章的向量與 `embeddingModel` 不變

## ADDED Requirements

### Requirement: 向量化期間文章被修改時不寫入向量

系統讀取文章開始向量化之後，如果在寫入向量之前，這篇文章被修改、封存或刪除，系統 MUST NOT 寫入這次向量化的結果，並寫一筆 log。較新的修改需要重新向量化時，由那次寫入開始新的向量化。

向量化進行中只修改分類或標籤時，這次的結果也不寫入，而只改分類或標籤不會開始新的向量化。這篇文章保留原本的向量，直到管理員重新向量化。這是已知的限制。

#### Scenario: 向量化期間文章被修改
- **WHEN** 系統開始向量化文章的第一版內容，向量化服務回傳之前，成員把內容改成第二版
- **THEN** 第一版的向量沒有寫入；第二版寫入之後開始的向量化完成時，文章的向量是第二版的向量

#### Scenario: 向量化期間文章被封存
- **WHEN** 系統開始向量化一篇文章，向量化服務回傳之前，成員封存這篇文章
- **THEN** 文章的向量仍是 NULL

#### Scenario: 向量化期間文章沒有被修改
- **WHEN** 系統開始向量化一篇文章，向量化服務回傳之前沒有人修改這篇文章
- **THEN** 文章的向量是這次的結果

### Requirement: 單篇重新向量化的回應

`POST /api/v1/knowledge/:id/embed` SHALL 等待向量化完成才回應。寫入向量之後，系統 SHALL 回 200 與 `{ "embedded": true }`。向量化期間文章被修改、封存或刪除時，系統 SHALL 回 409 `ARTICLE_CHANGED`，不寫入向量。向量化服務失敗時，系統 SHALL 回錯誤，文章的向量不變。

#### Scenario: 重新向量化成功
- **WHEN** 管理員呼叫 `POST /api/v1/knowledge/:id/embed`，向量化期間沒有人修改這篇文章
- **THEN** 回應是 200 與 `{ "embedded": true }`，文章有這次的向量

#### Scenario: 重新向量化期間文章被修改
- **WHEN** 管理員呼叫 `POST /api/v1/knowledge/:id/embed`，向量化服務回傳之前另一位成員修改了這篇文章
- **THEN** 回應是 409 `ARTICLE_CHANGED`，這次的向量沒有寫入
