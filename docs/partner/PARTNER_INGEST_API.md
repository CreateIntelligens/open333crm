# Partner Ingest API 串接文件

> 本文件提供合作方推送知識點到 open333CRM 知識庫的完整規格與測試範例。
>
> **版本**：v1（2026-05-13）
> **負責對接**：Daniel Yang（甲方） / Stanley（乙方 Chatbot 系統）

---

## 1. 概述

本 API 提供合作方系統將「問答型知識點」（含附件）推送到 open333CRM 知識庫（KB）。每一筆問答對應一個 `DocID`，由合作方系統管理唯一性。

### 1.1 主要動作（`cmd`）

| `cmd` | 用途 |
|---|---|
| `CREATE` | 新增一筆知識點，或復活先前已刪除的知識點 |
| `UPDATE` | 更新既有知識點的內容與附件（**整批覆蓋**） |
| `DELETE` | 移除知識點（**軟刪**，可由 CREATE 復活） |

### 1.2 設計原則

- **顯式語意**：動作由 `cmd` 明確指定，不靠 `Ver` 隱式推導
- **整批覆蓋**：UPDATE 與復活時，附件採「先刪後寫」整批替換
- **冪等（idempotent）**：DELETE 重複呼叫不會出錯，UPDATE 重複帶相同/舊版本不會倒退
- **軟刪**：DELETE 後資料仍在後台（status=ARCHIVED），不會被 AI 搜尋吐回，可救回

---

## 2. 認證

### 2.1 取得 Partner API Key

請聯繫對方系統管理員索取。Key 格式為 `pk_` 開頭的長字串，由 Daniel 透過安全管道（**不在本文件中**）傳給合作方。

### 2.2 在請求中使用

每次請求都要帶 HTTP Header：

```
Authorization: Bearer pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

若 Key 錯誤或過期，會回 `401 Unauthorized`。

---

## 3. Endpoint

```
POST  <API_BASE_URL>/api/v1/knowledge/partner-ingest
Content-Type: multipart/form-data
Authorization: Bearer pk_xxx
```

### 3.1 環境位址

| 環境 | API_BASE_URL |
|---|---|
| UAT（測試）| `https://<your-uat-host>` |
| Production | `https://<your-prod-host>` |

（實際 URL 由 Daniel 提供）

---

## 4. 欄位定義

`Content-Type: multipart/form-data`，欄位順序不拘。

### 4.1 共通欄位（所有 cmd 都會用到）

| Field | Type | 必填 | 說明 |
|---|---|---|---|
| `cmd` | string | ✅ | `CREATE` / `UPDATE` / `DELETE`（大小寫不拘） |
| `DocID` | string | ✅ | 合作方系統的文件編號，最長 64 字元；同一合作方下需唯一 |

### 4.2 CREATE / UPDATE 額外欄位

| Field | Type | 必填 | 說明 |
|---|---|---|---|
| `Ver` | int | ✅ | 文件版本，**必須嚴格遞增**；用於防止亂序重送 |
| `VerCreatTime` | string | ✅ | 版本建立時間，格式 `/Date(1775703693000)/`（毫秒） |
| `AI_Q` | string | ✅ | AI 客服問題（對客戶端的問題文字） |
| `AI_A` | string | ✅ | AI 客服回覆 |
| `Source` | string | ✅ | 文件分類來源（例：`FAQ(消費者)-常見問答`） |
| `Spec` | string (JSON) |  | 商品規格 / 活動說明的結構化資料；JSON 字串 |
| `IsAttached` | boolean | ✅ | `true` / `false`，是否含附件 |
| `Attached` | file（可多個）|  | 附件檔案，**可在同一請求重複出現**多個 |

> ⚠️ **欄位拼字相容**：歷史相容 Stanley 既有系統的拼字錯誤，後端同時接受 `Source` 與 `Soruce`，行為相同。新對接建議使用正確拼字 `Source`。

### 4.3 DELETE 欄位需求

- **僅 `cmd` 與 `DocID` 必填**，其他欄位可省略
- 若帶上 `Attached`，後端**會直接忽略**，不會浪費頻寬
- 不檢查 `Ver`（刪除動作 idempotent）

---

## 5. 動作詳解

### 5.1 CREATE — 新增知識點

#### 情境 A：全新的 DocID

```bash
curl -X POST '<API_BASE_URL>/api/v1/knowledge/partner-ingest' \
  -H 'Authorization: Bearer pk_xxx' \
  -F 'cmd=CREATE' \
  -F 'DocID=DOC-1234' \
  -F 'Ver=1' \
  -F 'VerCreatTime=/Date(1775703693000)/' \
  -F 'AI_Q=請問電鍋保固多久？' \
  -F 'AI_A=本商品保固 12 個月，自購買日起算。' \
  -F 'Source=FAQ(消費者)-常見問答' \
  -F 'Spec={"產地":"台灣","電壓":"110V","保固期":"12個月"}' \
  -F 'IsAttached=true' \
  -F 'Attached=@manual.pdf' \
  -F 'Attached=@spec-sheet.png'
```

**回應（200）**

```json
{
  "success": true,
  "data": {
    "status": "created",
    "articleId": "8f3a1b2c-...",
    "externalDocId": "DOC-1234",
    "externalVer": 1,
    "attachmentsLinked": 2
  }
}
```

#### 情境 B：DocID 已存在 PUBLISHED → 衝突

```json
{
  "success": false,
  "error": {
    "code": "DOCID_CONFLICT",
    "message": "DocID \"DOC-1234\" already exists (use cmd=UPDATE instead)"
  }
}
```
HTTP `409`。請改送 `cmd=UPDATE`。

#### 情境 C：DocID 已存在但 ARCHIVED → 復活

當合作方先前送過 `cmd=DELETE`，後續又要重新上架同 DocID 時，**送 `cmd=CREATE` + 較新的 Ver**，後端會自動復活：

```json
{
  "success": true,
  "data": {
    "status": "revived",
    "articleId": "8f3a1b2c-...",
    "externalDocId": "DOC-1234",
    "externalVer": 5,
    "attachmentsLinked": 2
  }
}
```

> 注意 `status` 是 `"revived"`，而不是 `"created"`，方便合作方系統對帳識別。

---

### 5.2 UPDATE — 更新知識點

```bash
curl -X POST '<API_BASE_URL>/api/v1/knowledge/partner-ingest' \
  -H 'Authorization: Bearer pk_xxx' \
  -F 'cmd=UPDATE' \
  -F 'DocID=DOC-1234' \
  -F 'Ver=2' \
  -F 'VerCreatTime=/Date(1775803693000)/' \
  -F 'AI_Q=請問電鍋保固多久？' \
  -F 'AI_A=本商品保固 18 個月，含全機免費到府收送。' \
  -F 'Source=FAQ(消費者)-常見問答' \
  -F 'Spec={"產地":"台灣","電壓":"110V","保固期":"18個月"}' \
  -F 'IsAttached=true' \
  -F 'Attached=@manual-v2.pdf'
```

#### ⚠️ 重要：附件「整批覆蓋」

UPDATE 時，後端會**先刪掉這個 DocID 底下舊的所有附件**，再用本次請求帶來的 `Attached` 重建。

> **如果你這次更新只想改文字、附件沒變，也必須把所有附件再次完整送上。**否則 DB 裡只會剩下你這次送的那些檔案。

#### 情境 A：版本較新 → 成功

```json
{
  "success": true,
  "data": {
    "status": "updated",
    "articleId": "8f3a1b2c-...",
    "externalDocId": "DOC-1234",
    "externalVer": 2,
    "attachmentsLinked": 1
  }
}
```

#### 情境 B：版本相同或較舊 → 略過（不報錯）

```json
{
  "success": true,
  "data": {
    "status": "skipped",
    "reason": "incoming ver 2 ≤ existing ver 2",
    "articleId": "8f3a1b2c-...",
    "externalDocId": "DOC-1234",
    "externalVer": 2,
    "attachmentsLinked": 0
  }
}
```

這是為了防止「亂序重送把新版蓋成舊版」。合作方可以據此判定為「重複送」，不必當錯誤處理。

#### 情境 C：DocID 不存在或已刪除 → 404

```json
{
  "success": false,
  "error": {
    "code": "DOCID_NOT_FOUND",
    "message": "DocID \"DOC-1234\" not found (use cmd=CREATE instead)"
  }
}
```
HTTP `404`。請改送 `cmd=CREATE`（會自動復活）。

---

### 5.3 DELETE — 移除知識點（軟刪）

```bash
curl -X POST '<API_BASE_URL>/api/v1/knowledge/partner-ingest' \
  -H 'Authorization: Bearer pk_xxx' \
  -F 'cmd=DELETE' \
  -F 'DocID=DOC-1234'
```

#### 行為

- 文件 `status` 改為 `ARCHIVED`
- 向量索引清空（不再被 AI 檢索吐回）
- **附件保留**（供未來稽核或復活使用）
- 後台仍能看到此文件，但 AI 端不會引用

#### 情境 A：成功刪除

```json
{
  "success": true,
  "data": {
    "status": "deleted",
    "articleId": "8f3a1b2c-...",
    "externalDocId": "DOC-1234",
    "externalVer": 2,
    "attachmentsLinked": 0
  }
}
```

#### 情境 B：DocID 不存在 → idempotent

```json
{
  "success": true,
  "data": {
    "status": "deleted",
    "reason": "not found (idempotent)",
    "articleId": "",
    "externalDocId": "DOC-1234",
    "externalVer": 0,
    "attachmentsLinked": 0
  }
}
```
HTTP `200`，當作已刪除，不報錯。

#### 情境 C：DocID 已被 ARCHIVED → idempotent

```json
{
  "success": true,
  "data": {
    "status": "deleted",
    "reason": "already archived (idempotent)",
    "articleId": "8f3a1b2c-...",
    "externalDocId": "DOC-1234",
    "externalVer": 2,
    "attachmentsLinked": 0
  }
}
```

---

## 6. 回應格式

### 6.1 成功回應結構

```ts
{
  success: true,
  data: {
    status: "created" | "updated" | "deleted" | "revived" | "skipped",
    reason?: string,             // 僅 skipped / deleted-idempotent 出現
    articleId: string,           // UUID；DELETE 不存在時為空字串
    externalDocId: string,       // 回顯送來的 DocID
    externalVer: number,         // 回顯送來的 Ver（或既有 Ver，視情境）
    attachmentsLinked: number    // 本次成功上傳的附件數
  }
}
```

### 6.2 失敗回應結構

```ts
{
  success: false,
  error: {
    code: string,      // 結構化錯誤碼，見下表
    message: string    // 人類可讀的錯誤訊息
  }
}
```

### 6.3 錯誤碼對照

| HTTP | code | 場景 | 處理建議 |
|---|---|---|---|
| 400 | `INVALID_CMD` | `cmd` 缺值或不是 CREATE/UPDATE/DELETE | 檢查欄位拼字 |
| 400 | `BAD_REQUEST` | `DocID` 缺值 | 補上 DocID |
| 401 | — | API Key 錯誤或過期 | 跟 Daniel 重新索取 |
| 404 | `DOCID_NOT_FOUND` | UPDATE 對不存在或已刪除的 DocID | 改送 CREATE（會自動復活） |
| 409 | `DOCID_CONFLICT` | CREATE 對已存在且未刪除的 DocID | 改送 UPDATE |
| 500 | `INGEST_FAILED` | 後端內部錯誤（DB / S3 異常） | 重試；持續失敗請通知 Daniel |

---

## 7. 完整測試腳本（Bash）

把 `<API_BASE_URL>` 跟 `<YOUR_KEY>` 替換成實際值後直接執行，可一次驗證所有情境。

```bash
#!/bin/bash
set -e

BASE_URL='<API_BASE_URL>'
TOKEN='Bearer <YOUR_KEY>'
DOC_ID="TEST-$(date +%s)"   # 用 timestamp 確保每次測試 DocID 不同
ENDPOINT="$BASE_URL/api/v1/knowledge/partner-ingest"

echo "=== 1. CREATE 新 DocID（預期 200 created） ==="
curl -sS -X POST "$ENDPOINT" \
  -H "Authorization: $TOKEN" \
  -F "cmd=CREATE" \
  -F "DocID=$DOC_ID" \
  -F "Ver=1" \
  -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=測試問題" \
  -F "AI_A=測試回答" \
  -F "Source=測試分類" \
  -F "IsAttached=false" | jq .

echo "=== 2. CREATE 同 DocID（預期 409 DOCID_CONFLICT） ==="
curl -sS -X POST "$ENDPOINT" \
  -H "Authorization: $TOKEN" \
  -F "cmd=CREATE" \
  -F "DocID=$DOC_ID" \
  -F "Ver=2" \
  -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=Q" -F "AI_A=A" -F "Source=S" -F "IsAttached=false" | jq .

echo "=== 3. UPDATE 較大 Ver（預期 200 updated） ==="
curl -sS -X POST "$ENDPOINT" \
  -H "Authorization: $TOKEN" \
  -F "cmd=UPDATE" \
  -F "DocID=$DOC_ID" \
  -F "Ver=2" \
  -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=更新後的問題" \
  -F "AI_A=更新後的回答" \
  -F "Source=測試分類" \
  -F "IsAttached=false" | jq .

echo "=== 4. UPDATE 較小 Ver（預期 200 skipped） ==="
curl -sS -X POST "$ENDPOINT" \
  -H "Authorization: $TOKEN" \
  -F "cmd=UPDATE" \
  -F "DocID=$DOC_ID" \
  -F "Ver=1" \
  -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=Q" -F "AI_A=A" -F "Source=S" -F "IsAttached=false" | jq .

echo "=== 5. UPDATE 不存在 DocID（預期 404） ==="
curl -sS -X POST "$ENDPOINT" \
  -H "Authorization: $TOKEN" \
  -F "cmd=UPDATE" \
  -F "DocID=NOT-EXIST-$(date +%s)" \
  -F "Ver=1" -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=Q" -F "AI_A=A" -F "Source=S" -F "IsAttached=false" | jq .

echo "=== 6. DELETE 既有 DocID（預期 200 deleted） ==="
curl -sS -X POST "$ENDPOINT" \
  -H "Authorization: $TOKEN" \
  -F "cmd=DELETE" \
  -F "DocID=$DOC_ID" | jq .

echo "=== 7. DELETE 再送一次（預期 200 deleted, reason=already archived） ==="
curl -sS -X POST "$ENDPOINT" \
  -H "Authorization: $TOKEN" \
  -F "cmd=DELETE" \
  -F "DocID=$DOC_ID" | jq .

echo "=== 8. CREATE 復活（預期 200 revived） ==="
curl -sS -X POST "$ENDPOINT" \
  -H "Authorization: $TOKEN" \
  -F "cmd=CREATE" \
  -F "DocID=$DOC_ID" \
  -F "Ver=3" \
  -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=復活後的問題" \
  -F "AI_A=復活後的回答" \
  -F "Source=測試分類" \
  -F "IsAttached=false" | jq .

echo "=== 9. 缺 cmd（預期 400 INVALID_CMD） ==="
curl -sS -X POST "$ENDPOINT" \
  -H "Authorization: $TOKEN" \
  -F "DocID=$DOC_ID" -F "Ver=1" -F "VerCreatTime=/Date(1)/" \
  -F "AI_Q=Q" -F "AI_A=A" -F "Source=S" -F "IsAttached=false" | jq .

echo "=== 全部測試完成 ==="
```

---

## 8. Postman Collection

可直接匯入 Postman 的 collection JSON 已附在同目錄：[`partner-ingest.postman_collection.json`](./partner-ingest.postman_collection.json)

匯入後請設定 Environment Variables：
- `baseUrl` = `<API_BASE_URL>`
- `partnerKey` = 你的 `pk_xxx`

---

## 9. FAQ

### Q1. 同一筆問答有多個附件，要壓縮嗎？
**不需要。** 在同一個 `multipart/form-data` 請求中，`Attached` 欄位可重複出現 N 次，每個對應一個檔案。後端會逐一接收並各自存成獨立附件。

### Q2. UPDATE 時附件沒變，可以只送文字嗎？
**不可以。** UPDATE 採「整批覆蓋」語意，後端會先刪掉這個 DocID 底下所有舊附件再寫新的。要保留附件就必須把所有附件再送一次。

### Q3. 我送錯 DocID 用 DELETE 刪了，能救嗎？
**可以。** DELETE 是軟刪，文件還在後台（status=ARCHIVED），附件也都保留。重新送 `cmd=CREATE` + 較新的 `Ver` 即可復活。

### Q4. 我可以用 `cmd=CREATE` 覆蓋一個還沒刪除的 DocID 嗎？
**不行，會回 409。** 想取代既有內容請用 `cmd=UPDATE`。

### Q5. `Ver` 一定要嚴格遞增嗎？
**是的。** CREATE / UPDATE / 復活都會檢查 `Ver` 必須嚴格大於後端目前儲存的版本。重送相同或更舊的版本會被 skipped。這是為了防止亂序重送把新版蓋成舊版。

### Q6. 附件大小有限制嗎？
單檔不超過 30 MB（後端 Fastify bodyLimit），單次請求所有附件總和也建議不超過此值。超過建議拆 DocID。

### Q7. 我每次推都要重新登入嗎？
不用。Partner API Key 是長效的，**沒有過期時間**，除非 Daniel 主動 revoke。請妥善保管，建議放環境變數而非 commit 進 git。

### Q8. 後端會回 webhook 通知我嗎？
目前不會。本 API 是同步式：請求送出後直接回應結果，請依 HTTP status code 與 `data.status` 對帳。

### Q9. 同時送多個 request 會有 race condition 嗎？
單一 DocID 的請求建議**序列化送**（同 DocID 的下一個請求等前一個回應後再發）。不同 DocID 之間平行送沒問題。

---

## 10. 變更歷史

| 日期 | 版本 | 變更 |
|---|---|---|
| 2026-05-13 | v1 | 初版：cmd=CREATE/UPDATE/DELETE 規格、軟刪、復活、idempotent |

---

## 11. 聯絡

- **規格疑問 / Key 索取**：Daniel Yang
- **後端錯誤回報**：請附上 request 內容（curl 指令）、回應 JSON、發生時間
- **建議改進**：歡迎在 GitHub Issue 提出
