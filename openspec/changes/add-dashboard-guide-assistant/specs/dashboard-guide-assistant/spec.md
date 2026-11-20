## ADDED Requirements

### Requirement: 助理依本租戶的知識庫回答

`POST /api/v1/ai/guide-assistant/ask` SHALL 接收 `message`（1 到 1000 字）、`history`（最多 6 則，每則 `role` 是 `user` 或 `assistant`，`content` 最多 2000 字）與 `currentPath`（選填，最多 300 字，以 `/` 開頭，只能有英數字與 `-._~/%`，不能有空白或換行）。系統 SHALL 以 `searchArticlesByTextFlow()` 檢索本租戶的已發布文章，取相似度最高的 3 篇。系統 SHALL 把這 3 篇文章的內容交給 LLM。回應 SHALL 是 `{ answer, guide, sources }`。`sources` 的每一項是 `{ id, title }`。

沒有檢索到文章時，系統 MUST NOT 呼叫 LLM。這時 `answer` 是固定的「知識庫裡找不到這個問題的說明。」，`guide` 是 `null`，`sources` 是空陣列。

#### Scenario: 以知識庫回答
- **WHEN** 有 `assistant.use` 的員工送出「怎麼設定關鍵字自動回覆」，知識庫有相關的已發布文章
- **THEN** 回應的 `answer` 是 LLM 的答案，`sources` 列出檢索到的文章

#### Scenario: 只檢索本租戶的文章
- **WHEN** 另一個租戶有一篇與問題相同的文章，本租戶沒有
- **THEN** 系統不呼叫 LLM，`answer` 是固定的「知識庫裡找不到這個問題的說明。」，`sources` 是空陣列

#### Scenario: 路徑含換行時回 400
- **WHEN** 員工送出的 `currentPath` 含換行
- **THEN** 回應是 400，系統不呼叫 LLM

#### Scenario: 問題是空字串
- **WHEN** 員工送出 `message` 是空字串
- **THEN** 回應是 400，系統不呼叫 LLM

### Requirement: 助理需要 assistant.use 與 knowledge.view 權限

路由 SHALL 以 `requirePermission('assistant.use')` 與 `requirePermission('knowledge.view')` 保護。答案與來源來自知識庫文章，所以沒有 `knowledge.view` 的角色 MUST NOT 透過助理讀到文章。`assistant.use` 的 feature 是 `knowledge`，`dependsOn` 是 `knowledge.view`。`admin`、`supervisor`、`agent` 三個系統角色預設都有 `assistant.use`。

#### Scenario: 沒有 assistant.use
- **WHEN** 員工的角色沒有 `assistant.use`，員工送出問題
- **THEN** 回應是 403，`error.details.requiredPermission` 是 `assistant.use`

#### Scenario: 沒有 knowledge.view
- **WHEN** 員工的角色有 `assistant.use`、沒有 `knowledge.view`，員工送出問題
- **THEN** 回應是 403，`error.details.requiredPermission` 是 `knowledge.view`，系統不讀文章、不呼叫 LLM

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
3. 依下一個需求「導覽逐步顯示說明卡」標示每個步驟。

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

#### Scenario: 找不到欄位
- **WHEN** 某個步驟的元素 5 秒內沒有出現
- **THEN** 前端停止導覽，面板顯示「找不到這個欄位，請依上面的步驟操作。」

### Requirement: 導覽逐步顯示說明卡

前端 SHALL 對導覽的每個步驟：

1. 以聚光框標示該元素，旁邊的說明卡顯示「第 n / N 步」與步驟的 `note`。
2. `click` 步驟：前端 MUST NOT 自動點擊。員工點擊該元素，或按說明卡的「下一步」時，才進行下一步。按「下一步」時，前端代員工點擊該元素一次。
3. `highlight` 步驟：把該元素捲到畫面內，並對它呼叫 `focus()`。不是最後一步時，說明卡顯示「下一步」；最後一步顯示「完成」。員工按下後，進行下一步或結束導覽。

員工按 Esc，或點擊說明卡與被標示元素以外的地方時，前端 SHALL 結束導覽，面板不顯示訊息。

元素在原生的 modal 對話框（以 `showModal()` 打開的 `<dialog>`）裡時，聚光框與說明卡 SHALL 放在該對話框內。modal 對話框蓋在所有圖層之上，對話框外的元素也無法點擊，放在外面時員工看不到也按不到說明卡。

#### Scenario: 點擊步驟等員工操作
- **WHEN** 導覽的第 1 步是 `click` `keyword-reply.open`，共 2 步
- **THEN** 前端標示 `keyword-reply.open` 的元素，說明卡顯示「第 1 / 2 步」；員工操作之前，前端不點擊它，也不標示第 2 步

#### Scenario: 員工點擊元素後進行下一步
- **WHEN** 員工點擊被標示的 `keyword-reply.open` 元素
- **THEN** 前端等待 `keyword-reply.keyword` 的元素出現，標示它並讓它取得焦點，說明卡顯示「第 2 / 2 步」與「完成」

#### Scenario: 按下一步時代員工點擊
- **WHEN** 員工在第 1 步按說明卡的「下一步」
- **THEN** 前端點擊 `keyword-reply.open` 的元素一次，再進行第 2 步

#### Scenario: 員工中途結束導覽
- **WHEN** 員工在任一步按 Esc
- **THEN** 聚光框關閉，導覽結束，面板不顯示「找不到這個欄位」

#### Scenario: 元素在 modal 對話框裡
- **WHEN** 被標示的元素在 `<dialog>` 裡（例如匯入知識庫文章的檔案欄位）
- **THEN** 說明卡在該 `<dialog>` 裡

### Requirement: 沒有權限時不顯示助理

後台 SHALL 只在員工的有效權限同時有 `assistant.use` 與 `knowledge.view` 時顯示右下角的助理按鈕。

#### Scenario: 沒有權限的員工
- **WHEN** 員工的有效權限沒有 `assistant.use`
- **THEN** 後台沒有助理按鈕

#### Scenario: 沒有 knowledge.view 的員工
- **WHEN** 員工的有效權限有 `assistant.use`、沒有 `knowledge.view`
- **THEN** 後台沒有助理按鈕

### Requirement: 面板的對話

面板的對話只存在前端。員工關閉面板時，面板 SHALL 清空對話，並 MUST NOT 顯示關閉前送出、關閉後才回來的回覆。導覽執行期間員工關閉了面板時，導覽失敗後面板 MUST NOT 重新打開，也 MUST NOT 顯示「找不到這個欄位」。面板送出的 `history` 每則 SHALL 最多 2000 字，與 API 的上限相同：較長的答案只送前 2000 字。

#### Scenario: 關閉面板後不顯示舊請求的回覆
- **WHEN** 員工送出問題，回覆回來之前關閉面板，再打開面板
- **THEN** 面板沒有這次的問題，也沒有這次的回覆

#### Scenario: 導覽期間關閉面板後，導覽失敗不重新打開面板
- **WHEN** 員工按下「帶我去」，導覽還在等待欄位時，員工打開再關閉面板，之後導覽失敗
- **THEN** 面板維持關閉；員工再打開面板時，沒有「找不到這個欄位」的提示

#### Scenario: 歷史訊息每則最多 2000 字
- **WHEN** 上一則答案有 3000 字，員工再送出一個問題
- **THEN** 這次請求的 `history` 每則最多 2000 字，API 不回 400
