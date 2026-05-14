## Context

Partner ingest 是合作方（目前是 Stanley 的 Chatbot 系統）唯一寫入 KB 的 API。從 PR #102（2026-05-06）上線後，動作行為一直是「比較 `Ver`」：

- DocID 不存在 → create
- DocID 存在且 `Ver` 較新 → update（含附件整批替換 + 重算 embedding）
- DocID 存在且 `Ver` 相同或較舊 → skip（idempotent retry 友善）

這個設計**沒有刪除路徑**。當合作方想要把一筆知識點下架，目前只能：
1. 透過 KM 後台手動 archive（合作方無權限）
2. 把 AI_A 改成空字串再推 update（hack，且 embedding 還是會跑）

Stanley 在對接時明確要求**加 `cmd` 欄位顯式指定動作**，並要求 DELETE 行為。雙方約定**硬切**（同時上線新規格，不做向後相容）。

## Goals / Non-Goals

**Goals**

- `cmd` 為必填，CREATE / UPDATE / DELETE 三個明確的動作
- DELETE 採**軟刪**——保留 KmArticle 記錄、附件、`externalDocId`、`externalVer`，只把 `status` 轉 `ARCHIVED` 並清空 `embedding`
- 復活機制：對 ARCHIVED 的 DocID 送 CREATE，視為復活（重新 PUBLISHED + 覆蓋內容）
- 錯誤回應使用 4xx + 結構化錯誤碼，方便合作方對帳
- 既有的 `Ver` 嚴格遞增保護**保留**，防止亂序重送
- 既有的附件「整批替換」語意**保留**

**Non-Goals**

- 把 partner-ingest 搬到 worker（HTTP 改非同步會破壞對方對接）
- ARCHIVED 文章的清理 worker（30 天後實體刪除）—— 留給未來
- 對 KmArticle 手動管理流程的改動

## Decisions

### 為什麼用軟刪而不是硬刪

**軟刪（採用）**：`status = ARCHIVED` + 清空 `embedding`。

- ✅ 萬一合作方誤刪可以救（後台手動恢復 status 即可）
- ✅ 附件保留供稽核
- ✅ `externalDocId` 還在，未來若要復活（CREATE）可以直接覆蓋
- ✅ RAG 檢索 (`embedding.service.ts:117`) 本來就 `WHERE status='PUBLISHED'`，ARCHIVED 自動排除，**不需改 SQL**
- ⚠️ 附件還佔 S3 空間（後續可加清理 worker）

**硬刪（拒絕）**：直接 `DELETE FROM km_articles`。

- 風險太高，誤刪無法救
- 對方若送錯 DocID 我們無從還原

**主要考量**：合作方仍在對接初期，誤操作機率高，軟刪是保險做法。

### 為什麼 ARCHIVED 也算「不存在」

對 UPDATE 而言，**ARCHIVED ≡ 不存在**：

- UPDATE 一個 ARCHIVED 的 DocID → 404 `DOCID_NOT_FOUND`
- 合作方應該改送 CREATE（會觸發復活流程）

**理由**：若允許 UPDATE 對 ARCHIVED 文章直接生效，合作方無法察覺「這筆已被刪過」。回 404 強迫對方主動選擇是要復活還是放棄。

### CREATE 對 ARCHIVED 視為「復活」

- CREATE + PUBLISHED 存在 → 409 `DOCID_CONFLICT`（不可覆蓋活的文章）
- CREATE + ARCHIVED 存在 → 200 `status="revived"`（覆蓋並還原 PUBLISHED）
- CREATE + 不存在 → 200 `status="created"`

**為什麼用 CREATE 而不是另開新 cmd（RESTORE）**：

- 對合作方系統而言，「我要重新上架這個 DocID」最自然的語意就是 CREATE
- 多加一個 cmd 會增加對方系統的分支邏輯，無實益
- 後端可以由 `existing.status === 'ARCHIVED'` 自動判斷

### Ver 嚴格遞增保護保留

即使 cmd 顯式指定，`Ver` 比較**仍然執行**：

- CREATE 對新 DocID：`Ver` 可以是任意正整數
- CREATE 復活：要求 `Ver` 嚴格大於既有（避免拿舊版資料復活）
- UPDATE：要求 `Ver` 嚴格大於既有
- 不符合 → 200 `status="skipped"`，內容不變（**不回 4xx**，因為這是合理的 retry 情境）
- DELETE：不檢查 `Ver`（刪除動作 idempotent）

### 錯誤碼設計

| HTTP | code | 場景 |
|---|---|---|
| 400 | `BAD_REQUEST` | DocID 缺值 |
| 400 | `INVALID_CMD` | cmd 缺值或非三者之一 |
| 404 | `DOCID_NOT_FOUND` | UPDATE 對不存在或 ARCHIVED DocID |
| 409 | `DOCID_CONFLICT` | CREATE 對既有 PUBLISHED DocID |
| 500 | `INGEST_FAILED` | 其他未預期錯誤 |

回應結構統一：`{ success: false, error: { code, message } }`

成功回應：`{ success: true, data: { status, articleId, externalDocId, externalVer, attachmentsLinked, reason? } }`，其中 `status` 可能值：`created` / `updated` / `revived` / `deleted` / `skipped`。

### 為什麼不搬 worker

partner-ingest 目前是 inline HTTP handler——收檔、寫 DB、上傳 S3 都同步。理論上附件大時應該搬 worker，但：

1. **API 回應形狀**：對方要靠 `status` 對帳；改非同步要回 job id + 查狀態 endpoint，破壞現有對接
2. **附件量級**：目前合作方推的多是 PDF / 圖片，單檔 < 5 MB，同步上傳可接受
3. **embedding 已經 fire-and-forget**：真正慢的步驟（vector 重算）已經不阻塞 HTTP 回應
4. **PR #115 搬 worker 的目標是定時 + 重型工作**（SLA poll、automation rule），跟「使用者觸發的 ingest」性質不同

若未來 Stanley 真的開始推大檔（>10 MB）或頻率變高，再開新 proposal 把 partner-ingest 改成「接收→入 queue→回 job id」的非同步模式。

## 行為矩陣（給合作方對照）

| cmd | DocID 狀態 | Ver 比較 | 結果 | HTTP |
|---|---|---|---|---|
| CREATE | 不存在 | — | 建立 PUBLISHED | 200 `status=created` |
| CREATE | PUBLISHED 存在 | — | 拒絕 | **409 DOCID_CONFLICT** |
| CREATE | ARCHIVED 存在 | 新 Ver 較大 | 復活並覆蓋 | 200 `status=revived` |
| CREATE | ARCHIVED 存在 | 新 Ver ≤ 既有 | 不動 | 200 `status=skipped` |
| UPDATE | 不存在 | — | 拒絕 | **404 DOCID_NOT_FOUND** |
| UPDATE | ARCHIVED 存在 | — | 拒絕（請改 CREATE） | **404 DOCID_NOT_FOUND** |
| UPDATE | PUBLISHED 存在 | 新 Ver 較大 | 覆蓋內容 + 附件 + 重算 | 200 `status=updated` |
| UPDATE | PUBLISHED 存在 | 新 Ver ≤ 既有 | 不動 | 200 `status=skipped` |
| DELETE | 不存在 | — | idempotent | 200 `status=deleted` (`reason=not found`) |
| DELETE | PUBLISHED 存在 | — | 軟刪 | 200 `status=deleted` |
| DELETE | ARCHIVED 存在 | — | idempotent | 200 `status=deleted` (`reason=already archived`) |
| 任何 | — | — | `cmd` 缺值/非法 | **400 INVALID_CMD** |

## Risks / Trade-offs

- **[Risk]** 合作方上線時序與後端不同步 → 一邊送舊格式（無 cmd）會立刻 400。**Mitigation**：規格上線前跟 Stanley 約定共同切換時間
- **[Risk]** 軟刪累積導致 S3 空間膨脹 → 附件不清理，長期會佔位。**Mitigation**：未來加 30 天清理 worker（另開 proposal）
- **[Risk]** 復活流程被誤觸 → 對方系統誤把 ARCHIVED 的 DocID 再 CREATE，會自動還原。**Mitigation**：回應裡 `status="revived"` 跟 `status="created"` 明確區分，對方系統可警示

## Migration Plan

- **無資料庫變動**
- API 規格硬切：合作方在前、後端在後上線（前端送舊格式只會 400，不會壞資料）
- Stanley 同步告知變更
