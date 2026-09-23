# Partner Ingest — curl 範例

合作方推送知識文件到 Open333 CRM 的 curl 範例集合。

> 規格定義請見 [partner-ingest.openapi.yaml](./partner-ingest.openapi.yaml)
> 完整文件請見 [partner-ingest-api.md](./partner-ingest-api.md)

---

## 共通變數

把以下兩個變數替換成你的值：

```bash
# Open333 管理員提供的 API Key（pk_ 開頭，64 個 hex 字元）
API_KEY="pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Endpoint Base URL
BASE_URL="https://uat.open333crm.create360.ai/api/v1"
```

---

## 1. 純文字（無附件）

最簡單情境，例如客服 FAQ。

```bash
curl -X POST "$BASE_URL/knowledge/partner-ingest" \
  -H "Authorization: Bearer $API_KEY" \
  -F "DocID=1234" \
  -F "Ver=1" \
  -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=如何申請退貨？" \
  -F "AI_A=請至會員中心 > 訂單查詢 > 點擊申請退貨..." \
  -F "Source=FAQ(消費者)-常見問答" \
  -F "IsAttached=false"
```

預期回應：

```json
{
  "success": true,
  "data": {
    "status": "created",
    "articleId": "uuid",
    "externalDocId": "1234",
    "externalVer": 1,
    "attachmentsLinked": 0
  }
}
```

---

## 2. 商品資料 + 規格 + 1 張圖

```bash
curl -X POST "$BASE_URL/knowledge/partner-ingest" \
  -H "Authorization: Bearer $API_KEY" \
  -F "DocID=1243" \
  -F "Ver=1" \
  -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=Open333 智慧電鍋" \
  -F "AI_A=採用不鏽鋼外殼，10 人份，700W..." \
  -F "Source=商品資料庫-電鍋" \
  -F 'Spec={"產地":"台灣","消耗功率":"700","售價":"3290"}' \
  -F "IsAttached=true" \
  -F "Attached=@product-photo.png"
```

> `@product-photo.png` 是本機檔案路徑，請改成實際路徑或把檔案放在執行 curl 的同目錄。

---

## 3. 多張附件（同 key 重複）

`Attached` 欄位可重複多次，每次代表一個附件。

```bash
curl -X POST "$BASE_URL/knowledge/partner-ingest" \
  -H "Authorization: Bearer $API_KEY" \
  -F "DocID=2001" \
  -F "Ver=1" \
  -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=循環扇使用說明" \
  -F "AI_A=14 吋循環扇，700W..." \
  -F "Source=商品資料庫-電風扇" \
  -F 'Spec={"風扇尺寸":"14吋","消耗功率":"700"}' \
  -F "IsAttached=true" \
  -F "Attached=@user-manual.pdf" \
  -F "Attached=@product-front.jpg" \
  -F "Attached=@product-back.jpg"
```

回應的 `attachmentsLinked` 會是 3。

---

## 4. 同一筆資料推第二次（更新版本）

Upsert 行為：

```bash
# 第一次：status=created
curl -X POST "$BASE_URL/knowledge/partner-ingest" \
  -H "Authorization: Bearer $API_KEY" \
  -F "DocID=1243" -F "Ver=1" -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=電鍋" -F "AI_A=v1 內容" -F "Source=商品資料庫-電鍋" \
  -F "IsAttached=false"
# → { "status": "created", "externalVer": 1, ... }

# 第二次同 Ver：status=skipped（idempotent，不會覆寫）
curl -X POST "$BASE_URL/knowledge/partner-ingest" \
  -H "Authorization: Bearer $API_KEY" \
  -F "DocID=1243" -F "Ver=1" -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=不會被寫入" -F "AI_A=不會被寫入" -F "Source=商品資料庫-電鍋" \
  -F "IsAttached=false"
# → { "status": "skipped", "reason": "incoming ver 1 ≤ existing ver 1", ... }

# 第三次更高 Ver：status=updated（覆寫所有欄位、刪舊附件、寫新附件、重算向量）
curl -X POST "$BASE_URL/knowledge/partner-ingest" \
  -H "Authorization: Bearer $API_KEY" \
  -F "DocID=1243" -F "Ver=2" -F "VerCreatTime=/Date(1775789999000)/" \
  -F "AI_Q=電鍋升級版" -F "AI_A=v2 內容" -F "Source=商品資料庫-電鍋" \
  -F "IsAttached=false"
# → { "status": "updated", "externalVer": 2, ... }
```

---

## 5. 行銷活動

`Spec` 用來放活動時間、條件等結構化欄位。

```bash
curl -X POST "$BASE_URL/knowledge/partner-ingest" \
  -H "Authorization: Bearer $API_KEY" \
  -F "DocID=13532" \
  -F "Ver=1" \
  -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=2026 新春購物節" \
  -F "AI_A=活動期間全館商品 9 折，會員額外 5% 回饋..." \
  -F "Source=marketing" \
  -F 'Spec={"活動開始時間":"2026-1-1","活動結束時間":"2026-1-31"}' \
  -F "IsAttached=false"
```

---

## 錯誤回應參考

### 401 — API key 無效 / 過期 / 被撤銷

```bash
curl -X POST "$BASE_URL/knowledge/partner-ingest" \
  -H "Authorization: Bearer pk_invalid_key_xxxx" \
  -F "DocID=test" -F "Ver=1" -F "VerCreatTime=/Date(0)/" \
  -F "AI_Q=test" -F "AI_A=test" -F "Source=test" -F "IsAttached=false"
```

回應：

```json
{
  "success": false,
  "error": { "code": "UNAUTHORIZED", "message": "Invalid API key" }
}
```

### 400 — 缺必填欄位

```bash
# 沒帶 DocID
curl -X POST "$BASE_URL/knowledge/partner-ingest" \
  -H "Authorization: Bearer $API_KEY" \
  -F "Ver=1" -F "AI_Q=foo"
```

回應：

```json
{
  "success": false,
  "error": { "code": "BAD_REQUEST", "message": "DocID is required" }
}
```

### 413 — 附件過大

整個 request body 上限 30MB，單檔 `Attached` 上限 25MB。超過會回 413。

---

## Tips

- **環境變數**：把 `API_KEY` 寫進 `.env` 或 shell profile，避免每次 paste 完整 key
- **HTTP debug**：加 `-v` 看完整 request/response header
- **儲存 response**：加 `-o response.json` 寫到檔案，方便比對
- **JSON 美化**：管道接 `| python3 -m json.tool` 或 `| jq`

範例：

```bash
curl -v -X POST "$BASE_URL/knowledge/partner-ingest" \
  -H "Authorization: Bearer $API_KEY" \
  -F "DocID=1234" -F "Ver=1" -F "VerCreatTime=/Date(0)/" \
  -F "AI_Q=test" -F "AI_A=test" -F "Source=test" -F "IsAttached=false" \
  | jq .
```

---

## Windows PowerShell 寫法

PowerShell 不支援 `\` 換行；改成單行或用反引號 `` ` ``：

```powershell
$apiKey = "pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
curl.exe -X POST "https://uat.open333crm.create360.ai/api/v1/knowledge/partner-ingest" `
  -H "Authorization: Bearer $apiKey" `
  -F "DocID=1234" `
  -F "Ver=1" `
  -F "VerCreatTime=/Date(1775703693000)/" `
  -F "AI_Q=如何申請退貨？" `
  -F "AI_A=請至會員中心..." `
  -F "Source=FAQ(消費者)-常見問答" `
  -F "IsAttached=false"
```

> 注意 PowerShell 用 `curl.exe` 而非 `curl`（後者是 `Invoke-WebRequest` 的別名，語法不同）。

---

## 問題回報

打不通 / 不確定回應時，請提供以下資訊聯絡管理員：

1. 完整 curl 命令（**不要包含真實 API key**）
2. Response body 與 status code
3. timestamp（精確到分鐘）
4. 你推的 DocID 與 Ver

聯絡：[Daniel](mailto:dy052340@gmail.com)
