# portal-activity Specification

## Purpose
粉絲活動與積分的保證：送出活動時作答、積分與事件一起成立；不允許重複參加的活動，每位粉絲只留下一筆作答；後台與粉絲端的輸入在 API 驗證；活動設定在入口驗證，不合法的舊值採用安全的預設值；積分帳本的餘額依序累計；後台只能調整本租戶聯絡人的積分；抽獎不重複抽出；活動的編輯與狀態轉換依序執行。同時操作時，這些保證也成立。

## Requirements

### Requirement: 送出活動的寫入一起成立

粉絲送出活動時，系統 MUST 在同一個交易寫入作答、活動設定的積分與 `portal.activity.submitted` 事件。其中一項寫不進去時，系統 MUST NOT 留下另外兩項，並回錯誤。事件 MUST 寫進 outbox，在交易 commit 之後才送給訂閱者，至少送出一次。事件內容 MUST 包含 `activityId`、`contactId`、`submissionId` 與 `activityType`。commit 之後送不進佇列時，系統 MUST 仍回成功，事件留在 outbox，由補送排程送出。

#### Scenario: 送出活動的事件與作答一起寫進 outbox

- **WHEN** 粉絲送出已發布的投票活動
- **THEN** outbox 有一筆 `portal.activity.submitted` 事件，內容的 `submissionId` 是這次的作答，`activityType` 是 `POLL`

#### Scenario: 事件寫不進 outbox 時，作答與積分都不留下

- **WHEN** 粉絲送出設定了 `pointsPerSubmit` 的活動，事件寫不進 outbox
- **THEN** 系統回錯誤，這位粉絲沒有作答，也沒有積分紀錄

#### Scenario: 積分寫不進去時不送出事件

- **WHEN** 粉絲送出設定了 `pointsPerSubmit` 的活動，積分寫不進去
- **THEN** 交易 rollback，事件 MUST NOT 送給訂閱者

#### Scenario: 事件在 commit 之後才送出

- **WHEN** 粉絲送出活動成功
- **THEN** 寫入的順序是作答、積分、事件，交易 commit 之後才送出事件

#### Scenario: commit 之後送不進佇列時，作答仍然成立

- **WHEN** 粉絲送出活動，交易 commit 之後事件送不進佇列
- **THEN** 系統回傳這次的作答，作答與積分不 rollback

### Requirement: 不允許重複參加的活動，每位粉絲只留下一筆作答

活動的 `settings.allowMultiple` 不是 `true` 時，同一位粉絲 MUST 只能留下一筆作答，也只拿到一次積分。同一位粉絲同時送出多次時，系統 MUST 只讓一次成功，其他回「您已參加過這個活動」。不同粉絲的送出 MUST NOT 互相等待。

#### Scenario: 第二次送出被拒絕，不再給積分

- **WHEN** 粉絲送出不允許重複參加的活動之後，再送出一次
- **THEN** 第二次回「您已參加過這個活動」，這位粉絲的積分只加一次

#### Scenario: allowMultiple 不是 true 時只能參加一次：字串 "false" 也不允許重複

- **WHEN** 活動的 `settings.allowMultiple` 是字串 `"false"`，粉絲送出之後再送出一次
- **THEN** 第二次回「您已參加過這個活動」，這位粉絲只有一筆作答

#### Scenario: 同一位粉絲同時送出兩次

- **WHEN** 粉絲的第一次送出還沒 commit，第二次送出開始
- **THEN** 第二次等第一次 commit 之後才檢查，回 `ALREADY_SUBMITTED`；這位粉絲只有一筆作答與一筆積分紀錄

#### Scenario: 同時送出時，活動 id 的大小寫不同

- **WHEN** 粉絲的第一次送出還沒 commit，第二次以大寫的活動 id 送出同一個活動
- **THEN** 第二次仍等第一次 commit 之後才檢查，回 `ALREADY_SUBMITTED`；這位粉絲只有一筆作答

### Requirement: 後台與粉絲端的輸入在 API 驗證

系統 MUST 在 API 驗證每個輸入欄位的型別與範圍，MUST NOT 依賴前端的驗證：路徑上的 id MUST 是 uuid；列表的類型與狀態 MUST 是允許的值；頁碼與每頁筆數 MUST 符合共用的分頁規則；抽獎人數 MUST 是正整數；粉絲送出的 `optionIds` MUST 是 uuid 陣列，`fields` 的值 MUST 是字串。不合法時，系統 MUST 回 400 `VALIDATION_ERROR`，MUST NOT 讀寫資料。

#### Scenario: 後台與粉絲端的輸入不合法時回 400

- **WHEN** 成員或粉絲送出不合法的輸入，例如不是 uuid 的活動 id、不在選項內的狀態、頁碼 0、字串或小數的抽獎人數、不是 uuid 的 `optionIds`、不是字串的欄位值
- **THEN** 系統回 400 `VALIDATION_ERROR`，不留下作答

### Requirement: 活動設定在入口驗證，不合法的舊值採用安全的預設值

建立或編輯活動時，`settings.pointsPerSubmit` MUST 是 0 以上、可存進 Int 欄位的整數，`settings.allowMultiple` MUST 是布林值；不合法時，系統 MUST 回 400 `VALIDATION_ERROR`，MUST NOT 儲存。`settings` 的其他欄位照舊儲存。已經存在資料庫的設定不合法時，粉絲送出 MUST 仍然成功，系統 MUST NOT 給積分，也 MUST NOT 扣積分。

#### Scenario: 活動設定不合法時，建立與編輯都回 400

- **WHEN** 成員建立或編輯活動，`pointsPerSubmit` 是 -5、字串 `"5"`、1.5 或超過 Int 上限，或 `allowMultiple` 是字串 `"false"`
- **THEN** 系統回 400 `VALIDATION_ERROR`，活動沒有建立，設定沒有改變

#### Scenario: 舊資料的積分設定不合法時，送出成功但不給積分

- **WHEN** 資料庫裡活動的 `pointsPerSubmit` 是 -5、字串 `"5"` 或 1.5，粉絲送出這個活動
- **THEN** 送出成功，作答的 `pointsEarned` 是 0，這位粉絲沒有積分紀錄

### Requirement: 積分帳本的餘額依序累計

每一筆積分紀錄的 `balance` MUST 等於同一位聯絡人前一筆紀錄的 `balance` 加上這筆的 `amount`。目前餘額是 `createdAt` 最新的一筆。同時寫入同一位聯絡人的積分時，後一筆 MUST 以前一筆 commit 之後的餘額計算。新的一筆 MUST 排在既有紀錄之後，即使寫入時間落在同一毫秒。這條規則適用於送出活動給點、後台調整、聯絡人合併與解除合併轉移積分。粉絲讀取自己的積分時，回應的餘額 MUST 與交易清單的最新一筆相同。

#### Scenario: 同時寫同一位聯絡人的積分

- **WHEN** 加 10 點還沒 commit 時，另一個交易加 3 點
- **THEN** 後一筆等前一筆 commit 之後才讀餘額；最新一筆的 `balance` 是 13，前一筆是 10

#### Scenario: 同時寫入時，聯絡人 id 的大小寫不同

- **WHEN** 加 10 點還沒 commit 時，另一個交易以大寫的聯絡人 id 加 3 點
- **THEN** 後一筆仍等前一筆 commit 之後才讀餘額，`balance` 是 13

#### Scenario: 同一毫秒內連續寫入

- **WHEN** 以同一個寫入時間，連續為同一位聯絡人加 3 次 1 點
- **THEN** 依 `createdAt` 由新到舊，`balance` 是 3、2、1，三筆的時間都不同

#### Scenario: 粉絲的積分餘額與交易清單一致

- **WHEN** 粉絲讀取自己的積分，讀取期間有另一筆積分寫入
- **THEN** 回應的餘額等於交易清單最新一筆的 `balance`

#### Scenario: 時間相同的積分紀錄，最新一筆與交易清單的排序相同

- **WHEN** 同一位聯絡人有 `createdAt` 相同的舊紀錄，系統讀取最新一筆與交易清單
- **THEN** 兩者都依 `createdAt` 由新到舊、再依 `id` 排序，選到同一筆

#### Scenario: 調整積分還沒 commit 時合併聯絡人

- **WHEN** 被合併方有 10 點，再加 5 點還沒 commit 時，開始把它併入另一位聯絡人
- **THEN** 合併等調整 commit 之後才讀餘額；被合併方的最新餘額是 0，保留方收到 15 點

#### Scenario: 扣點還沒 commit 時解除合併

- **WHEN** 合併轉入 10 點之後，保留方扣 8 點還沒 commit 時，開始解除這次合併
- **THEN** 解除合併等扣點 commit 之後才讀餘額；只轉回剩下的 2 點，保留方的餘額是 0，不是負數

### Requirement: 後台只能調整本租戶聯絡人的積分

成員在後台調整積分時，系統 MUST 先確認聯絡人屬於成員的租戶。聯絡人不存在，或屬於其他租戶時，系統 MUST 回 404 `CONTACT_NOT_FOUND`，MUST NOT 寫入積分紀錄。

#### Scenario: 調整其他租戶聯絡人的積分回 404，不寫入

- **WHEN** 成員以其他租戶的聯絡人 id 調整積分
- **THEN** 系統回 404 `CONTACT_NOT_FOUND`，那位聯絡人沒有新的積分紀錄

#### Scenario: 調整不存在的聯絡人的積分回 404

- **WHEN** 成員以不存在的聯絡人 id 調整積分
- **THEN** 系統回 404 `CONTACT_NOT_FOUND`，不回資料庫錯誤

### Requirement: 抽獎不重複抽出同一份作答

抽獎 MUST 只從還沒中獎的作答中抽出，抽出的作答標記為中獎。兩次抽獎同時進行時，後一次 MUST 等前一次 commit 之後才讀未中獎名單。

#### Scenario: 抽獎只從還沒中獎的作答抽出

- **WHEN** 活動有 3 份作答，先抽 2 份，再抽 5 份
- **THEN** 第一次抽出 2 份，第二次只抽出剩下的 1 份，與第一次不重複

#### Scenario: 同時抽獎

- **WHEN** 活動有 3 份作答，抽 2 份還沒 commit 時，另一次抽獎也抽 2 份
- **THEN** 第二次只抽出剩下的 1 份，與第一次不重複；3 份作答都標記為中獎

### Requirement: 活動的編輯與狀態轉換依序執行

只有草稿 MUST 能編輯、刪除與發布。系統 MUST 在活動狀態 commit 之後的值上檢查這些條件：一個操作還沒 commit 時，同一個活動的編輯、刪除與狀態轉換 MUST 等它 commit 之後才檢查。狀態已經不允許時，操作 MUST 失敗，活動不變。活動在等待期間被刪除時，系統 MUST 回找不到。

#### Scenario: 發布還沒 commit 時編輯、刪除、封存或再發布一次

- **WHEN** 草稿的發布還沒 commit 時，開始編輯、刪除、封存或再發布同一個活動
- **THEN** 該操作等發布 commit 之後才檢查，以 `INVALID_ACTIVITY_STATUS` 失敗；活動維持已發布，選項沒有被換掉。HTTP 回應沿用後台路由既有的錯誤處理：封存回 409 `INVALID_ACTIVITY_STATUS`，編輯、刪除、發布回 400 `BAD_REQUEST`

#### Scenario: 編輯還沒 commit 時發布

- **WHEN** 草稿的編輯還沒 commit 時，開始發布同一個活動
- **THEN** 發布等編輯 commit 之後才執行，發布的是編輯後的活動

#### Scenario: 刪除還沒 commit 時封存

- **WHEN** 草稿的刪除還沒 commit 時，開始封存同一個活動
- **THEN** 封存等刪除 commit 之後回找不到，不回資料庫錯誤

### Requirement: 編輯草稿不會清掉沒有送出或不可為空的選項與欄位

編輯草稿時，請求沒有帶 `options` 時，系統 MUST NOT 改動活動的選項（含競猜的正確答案）；沒有帶 `fields` 時，MUST NOT 改動表單欄位。投票與競猜收到空的 `options`、表單收到空的 `fields` 時，系統 MUST 回 400，MUST NOT 刪除既有的選項或欄位，也 MUST NOT 儲存同一個請求的其他欄位。後台的編輯對話框 MUST 以完整活動（含選項與欄位）帶入內容；完整活動載入完成前 MUST NOT 允許儲存，載入失敗時 MUST 顯示錯誤並 MUST NOT 允許儲存。

#### Scenario: 只改標題時，選項、正確答案與表單欄位都保留

- **WHEN** 成員對有選項（其中一個標為正確答案）與表單欄位的草稿送出只含 `title` 的 `PATCH /portal/activities/:id`
- **THEN** 回 200，`GET /portal/activities/:id` 的標題已更新，選項、正確答案與表單欄位與編輯前相同

#### Scenario: 投票或競猜的選項送空陣列時回 400

- **WHEN** 成員對投票或競猜草稿送出 `options: []`
- **THEN** 回 400，選項與標題都維持編輯前的內容

#### Scenario: 表單的欄位送空陣列時回 400

- **WHEN** 成員對表單草稿送出 `fields: []`
- **THEN** 回 400，表單欄位維持編輯前的內容

#### Scenario: 編輯對話框帶出完整活動的選項

- **WHEN** 成員在活動卡片按「編輯」，完整活動載入完成後只改標題並儲存
- **THEN** 對話框顯示原本的選項與正確答案，送出的 `options` 包含原本的選項與正確答案

#### Scenario: 完整活動載入失敗時顯示錯誤且不能儲存

- **WHEN** 成員按「編輯」，`GET /portal/activities/:id` 失敗
- **THEN** 對話框顯示錯誤訊息，「儲存」按鈕停用，不送出 `PATCH`

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
