# Open333 CRM — Partner Ingest API

合作方（產品 / 行銷 / 客服）將知識文件推送到 Open333 CRM 知識庫的單筆推送 API。

- **Endpoint**：`POST /api/v1/knowledge/partner-ingest`
- **Base URL**：`https://uat.open333crm.create360.ai`（目前 UAT 與 production 共用此網域；正式環境拆分後另行告知）
- **Content-Type**：`multipart/form-data`
- **認證**：Partner API Key（永久有效，由 Open333 管理員提供）

> 也提供 OpenAPI 3.1 規格檔：`docs/partner-ingest.openapi.yaml`，可匯入 Postman / Bruno / Swagger Editor 直接使用。

---

## 1. 認證

每個請求 Header 帶 Partner API Key：

```
Authorization: Bearer pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- 格式：`pk_` 開頭 + 64 個 hex 字元
- 由 Open333 管理員從後台「設定 → API 金鑰」建立後**直接提供 raw key**
- 永久有效（除非過期或被撤銷）
- **只能呼叫 `/knowledge/partner-ingest`**，其他 endpoint 一律 401

如果 key 遺失或洩漏，請聯絡管理員撤銷舊 key 並重新發放。

---

## 2. 欄位規格

| Key | Type | Required | 說明 |
|---|---|---|---|
| `DocID` | text | ✅ | 唯一 ID（同 tenant 內 unique）。重複推同 DocID 會走 upsert |
| `Ver` | text (int) | ✅ | 版本號。新版（更高）會覆寫舊版；同/低版會被跳過 |
| `VerCreatTime` | text | ✅ | 版本建立時間，格式 `/Date(<unix-ms>)/`（例：`/Date(1775703693000)/`） |
| `AI_Q` | text | ✅ | 問題 / 商品名稱 / 行銷文案標題（→ `title`） |
| `AI_A` | text | ✅ | 答案 / 商品描述 / 行銷素材內文（→ `content`） |
| `Source` | text | ✅ | 來源分類（→ `category`），例如：`FAQ(消費者)-常見問答` / `商品資料庫-電鍋` / `marketing` |
| `Spec` | text (JSON) | optional | 結構化規格 JSON 字串。Parse 失敗會原始字串保留 |
| `IsAttached` | text | ✅ | `"true"` / `"false"`，標示這筆是否帶附件 |
| `Attached` | file | optional | 附件檔（圖片 / PDF）。**可重複此 key 上傳多檔**，例：兩張圖就送兩個 `Attached` 欄位 |

> **欄位拼字相容性**：若 client 把 `Source` 拼成 `Soruce`，server 端會自動接受。

---

## 3. 回應格式

### 成功回應（200）

```json
{
  "success": true,
  "data": {
    "status": "created" | "updated" | "skipped",
    "reason": "...",            // 僅 skipped 時有，例：incoming ver 1 ≤ existing ver 1
    "articleId": "uuid",
    "externalDocId": "1243",
    "externalVer": 2,
    "attachmentsLinked": 1
  }
}
```

#### `status` 三種值

| status | 條件 | 行為 |
|---|---|---|
| `created` | DocID 不存在 | 新建文章 + 寫入附件 + 背景嵌入 |
| `updated` | DocID 存在且 incoming `Ver` 大於現有 | 覆寫所有欄位 + 刪除舊附件 + 寫入新附件 + 重新嵌入 |
| `skipped` | DocID 存在且 incoming `Ver` ≤ 現有 | 不做任何事（idempotent retry-safe） |

### 失敗回應

| HTTP | 條件 |
|---|---|
| `400` | 缺 `DocID` 或欄位驗證失敗 |
| `401` | Token 無效或過期 |
| `403` | Agent 權限不足（不是 SUPERVISOR/ADMIN） |
| `413` | 整個 request body 超過 30MB（`Attached` 單檔上限 25MB） |
| `500` | Server 內部錯誤；body 含 `error.message` |

---

## 4. 範例

### 4.1 純文字（無附件）

```bash
curl -X POST https://uat.open333crm.create360.ai/api/v1/knowledge/partner-ingest \
  -H "Authorization: Bearer $TOKEN" \
  -F "DocID=1234" \
  -F "Ver=1" \
  -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=如何申請退貨？" \
  -F "AI_A=請至會員中心..." \
  -F "Source=FAQ(消費者)-常見問答" \
  -F "IsAttached=false"
```

### 4.2 商品資料 + 規格 + 1 張圖

```bash
curl -X POST https://uat.open333crm.create360.ai/api/v1/knowledge/partner-ingest \
  -H "Authorization: Bearer $TOKEN" \
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

### 4.3 多張附件（同 key 重複）

```bash
curl -X POST https://uat.open333crm.create360.ai/api/v1/knowledge/partner-ingest \
  -H "Authorization: Bearer $TOKEN" \
  -F "DocID=2001" \
  -F "Ver=1" \
  -F "VerCreatTime=/Date(1775703693000)/" \
  -F "AI_Q=循環扇使用說明" \
  -F "AI_A=..." \
  -F "Source=商品資料庫-電風扇" \
  -F 'Spec={"風扇尺寸":"14吋","消耗功率":"700"}' \
  -F "IsAttached=true" \
  -F "Attached=@user-manual.pdf" \
  -F "Attached=@product-front.jpg" \
  -F "Attached=@product-back.jpg"
```

### 4.4 同筆資料推第二次（更新版本）

```bash
# 第一次
curl ... -F "DocID=1243" -F "Ver=1" ...
# → { "status": "created", ... }

# 第二次（同 Ver）
curl ... -F "DocID=1243" -F "Ver=1" ...
# → { "status": "skipped", "reason": "incoming ver 1 ≤ existing ver 1" }

# 第三次（Ver 更高）
curl ... -F "DocID=1243" -F "Ver=2" ...
# → { "status": "updated", ... }
#    舊版附件被刪、新版附件寫入、向量重新計算
```

---

## 5. 限制與注意事項

- **單筆 request body 上限 30MB**；單檔 `Attached` 上限 25MB
- **支援格式**：圖片（PNG / JPG）、PDF；其他格式可上傳但不會被預覽 / 解析
- **附件儲存**：S3 物件儲存；URL 在 CRM 後台可直接點開
- **嵌入處理**：建立 / 更新後**非同步**跑 embedding（bge-m3，1024 維）；通常 1-3 秒內完成。API 立即回應，不等嵌入結果
- **DB 一致性**：upsert 是原子操作；附件刪除走 cascade，不會有孤兒記錄
- **重試策略**：建議 client 在 5xx 時 retry；同 `(DocID, Ver)` 重打是 idempotent skip，安全

---

## 6. 我方驗證重點

收到 Stanley 的 doc 後，我方可在 CRM 後台確認：

- 「知識庫 → 文章管理」列表會看到該筆文章
- 列表項目下方顯示 `DocID 1243 · v1 · 📎 N`
- 點開編輯框上方「合作方匯入」區塊顯示完整 DocID / Ver / Source / Spec JSON / 附件清單
- 「知識庫 → 語義搜尋」可用關鍵字命中該筆內容（embedding 已寫入 KB）

---

## 7. 待討論項目

- [ ] **欄位拼字**：截圖 client 是 `Soruce`（typo）；server 同時接受 `Source` 與 `Soruce`，但建議 client 端統一為 `Source`
- [ ] **Source 完整列表**：目前已知 4 種（FAQ / 商品資料庫-X / marketing / 客服）。若有更多請列出，方便我方建分類索引
- [ ] **Spec schema 收斂**：每個 Source 的 Spec JSON 結構是否能統一格式？方便未來做結構化檢索與顯示

---

如有問題請聯絡：[Daniel](mailto:dy052340@gmail.com)
