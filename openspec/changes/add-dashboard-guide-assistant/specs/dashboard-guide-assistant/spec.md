## ADDED Requirements

### Requirement: 助理依本租戶的知識庫回答

`POST /api/v1/ai/guide-assistant/ask` SHALL 接收 `message`（1 到 1000 字）、`history`（最多 6 則，每則 `role` 是 `user` 或 `assistant`，`content` 最多 2000 字）與 `currentPath`（選填）。系統 SHALL 以 `searchArticlesByTextFlow()` 檢索本租戶的已發布文章，取相似度最高的 3 篇。系統 SHALL 把這 3 篇文章的內容交給 LLM。回應 SHALL 是 `{ answer, guide, sources }`。`sources` 的每一項是 `{ id, title }`。

沒有檢索到文章時，系統 MUST NOT 呼叫 LLM。這時 `answer` 是固定的「知識庫裡找不到這個問題的說明。」，`guide` 是 `null`，`sources` 是空陣列。

#### Scenario: 以知識庫回答
- **WHEN** 有 `assistant.use` 的員工送出「怎麼設定關鍵字自動回覆」，知識庫有相關的已發布文章
- **THEN** 回應的 `answer` 是 LLM 的答案，`sources` 列出檢索到的文章

#### Scenario: 只檢索本租戶的文章
- **WHEN** 另一個租戶有一篇與問題相同的文章，本租戶沒有
- **THEN** 系統不呼叫 LLM，`answer` 是固定的「知識庫裡找不到這個問題的說明。」，`sources` 是空陣列

#### Scenario: 問題是空字串
- **WHEN** 員工送出 `message` 是空字串
- **THEN** 回應是 400，系統不呼叫 LLM

### Requirement: 助理需要 assistant.use 權限

路由 SHALL 以 `requirePermission('assistant.use')` 保護。`assistant.use` 的 feature 是 `knowledge`。`admin`、`supervisor`、`agent` 三個系統角色預設都有 `assistant.use`。

#### Scenario: 沒有 assistant.use
- **WHEN** 員工的角色沒有 `assistant.use`，員工送出問題
- **THEN** 回應是 403，`error.details.requiredPermission` 是 `assistant.use`

### Requirement: 導覽只從操作者有權限的導覽中選

系統 SHALL 先以操作者的有效權限過濾導覽目錄：只保留 `requiredPermission` 在有效權限內的導覽。系統 SHALL 只把過濾後的導覽 `id` 與 `title` 交給 LLM，並要求 LLM 回傳 JSON `{ "answer": string, "guideId": string | null }`。

系統 SHALL 在回應前檢查 `guideId`：

- `guideId` 在過濾後的導覽中：`guide` 是該導覽的完整定義。
- `guideId` 是 `null`，或不在過濾後的導覽中：`guide` 是 `null`。
- LLM 的回覆不是這個格式的 JSON：`answer` 是 LLM 的整段回覆，`guide` 是 `null`。

#### Scenario: 有權限時回傳導覽
- **WHEN** 有 `automation.manage` 的員工問關鍵字自動回覆，LLM 回傳 `guideId: "keyword-reply.create"`
- **THEN** 回應的 `guide.id` 是 `keyword-reply.create`，`guide.route` 是 `/dashboard/line/keyword-replies`

#### Scenario: 沒有權限時不回傳導覽
- **WHEN** 沒有 `automation.manage` 的員工問關鍵字自動回覆
- **THEN** 系統交給 LLM 的導覽清單沒有 `keyword-reply.create`
- **AND** LLM 仍回傳 `guideId: "keyword-reply.create"` 時，回應的 `guide` 是 `null`

#### Scenario: LLM 回傳不存在的導覽
- **WHEN** LLM 回傳 `guideId: "no-such-guide"`
- **THEN** 回應的 `guide` 是 `null`，`answer` 是 LLM 回傳的 `answer`

#### Scenario: LLM 的回覆不是 JSON
- **WHEN** LLM 回覆一段純文字
- **THEN** 回應的 `answer` 是這段純文字，`guide` 是 `null`

### Requirement: 助理的 AI 用量與月額度

系統 SHALL 以 `generateReply()` 呼叫 LLM，`meta.feature` 是 `guide-assistant`。月額度已滿時，系統 MUST NOT 呼叫 LLM，回應是 403 `PLAN_LIMIT_EXCEEDED`。

#### Scenario: 記錄助理的用量
- **WHEN** 員工送出問題，LLM 呼叫成功
- **THEN** 本租戶新增一筆 `AiUsage`，`feature` 是 `guide-assistant`

#### Scenario: 月額度已滿
- **WHEN** 本租戶使用平台金鑰，這個月的用量已達上限，員工送出問題
- **THEN** 回應是 403，`error.code` 是 `PLAN_LIMIT_EXCEEDED`，系統不呼叫 LLM

### Requirement: 導覽目錄的安全規則

導覽目錄的每條導覽 SHALL 有 `id`、`title`、`route`、`requiredPermission` 與至少一個步驟。每個步驟有 `target`、`action` 與 `note`。`action` 只能是 `click` 或 `highlight`。

- 最後一個步驟的 `action` MUST 是 `highlight`。
- `click` 步驟的 `target` MUST 以 `.open` 結尾。只有打開對話框、打開新頁或切換分頁的元素可以使用以 `.open` 結尾的 `data-guide` 值。儲存、送出與刪除的元素 MUST NOT 使用以 `.open` 結尾的值。
- `route` MUST 以 `/dashboard/` 開頭。
- `requiredPermission` MUST 是權限註冊表裡的權限碼。

#### Scenario: 最後一步是標示
- **WHEN** 單元測試讀取導覽目錄
- **THEN** 每條導覽的最後一個步驟的 `action` 是 `highlight`

#### Scenario: 點開的目標以 .open 結尾
- **WHEN** 單元測試讀取導覽目錄
- **THEN** 每個 `click` 步驟的 `target` 以 `.open` 結尾

#### Scenario: 權限碼存在於註冊表
- **WHEN** 單元測試讀取導覽目錄
- **THEN** 每條導覽的 `requiredPermission` 都在 `PERMISSIONS` 裡

### Requirement: 員工按下「帶我去」後才執行導覽

面板 SHALL 在回應的 `guide` 不是 `null` 時，在答案下方顯示「帶我去」按鈕。`guide` 是 `null` 時，面板 MUST NOT 顯示這個按鈕。員工按下按鈕前，前端 MUST NOT 切換頁面或點擊任何元素。

員工按下按鈕後，前端 SHALL 依序執行：

1. 目前的路徑不是導覽的 `route` 時，切換到 `route`。
2. 對每個步驟，等待 `[data-guide="<target>"]` 出現，最多 5 秒。
3. `click` 步驟：點擊該元素。
4. `highlight` 步驟：把該元素捲到畫面內，對它呼叫 `focus()`，並以聚光框標示它，旁邊顯示步驟的 `note`。

5 秒內找不到元素時，前端 SHALL 停止這次導覽，並在面板顯示「找不到這個欄位，請依上面的步驟操作。」。

#### Scenario: 回應有導覽時顯示帶我去
- **WHEN** 面板收到 `guide` 不是 `null` 的回應
- **THEN** 答案下方有「帶我去」按鈕，頁面沒有切換

#### Scenario: 回應沒有導覽時不顯示帶我去
- **WHEN** 面板收到 `guide` 是 `null` 的回應
- **THEN** 答案下方沒有「帶我去」按鈕

#### Scenario: 先切換頁面
- **WHEN** 員工在 `/dashboard/inbox` 按下 `keyword-reply.create` 的「帶我去」
- **THEN** 前端切換到 `/dashboard/line/keyword-replies`

#### Scenario: 點開入口並標示欄位
- **WHEN** 導覽的步驟是先 `click` `keyword-reply.open`，再 `highlight` `keyword-reply.keyword`
- **THEN** 前端點擊 `keyword-reply.open` 的元素，等待 `keyword-reply.keyword` 的元素出現，再標示它並讓它取得焦點

#### Scenario: 找不到欄位
- **WHEN** 某個步驟的元素 5 秒內沒有出現
- **THEN** 前端停止導覽，面板顯示「找不到這個欄位，請依上面的步驟操作。」

### Requirement: 沒有 assistant.use 時不顯示助理

後台 SHALL 只在員工的有效權限有 `assistant.use` 時顯示右下角的助理按鈕。

#### Scenario: 沒有權限的員工
- **WHEN** 員工的有效權限沒有 `assistant.use`
- **THEN** 後台沒有助理按鈕
