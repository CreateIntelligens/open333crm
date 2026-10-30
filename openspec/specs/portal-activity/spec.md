# portal-activity Specification

## Purpose
粉絲活動與積分的保證：送出活動時作答、積分與事件一起成立；不允許重複參加的活動，每位粉絲只留下一筆作答；積分帳本的餘額依序累計；抽獎不重複抽出；活動的編輯與狀態轉換依序執行。這些保證在同時操作時也成立。

## Requirements

### Requirement: 送出活動的寫入一起成立

粉絲送出活動時，系統 MUST 在同一個交易寫入作答、活動設定的積分與 `portal.activity.submitted` 事件。其中一項寫不進去時，系統 MUST NOT 留下另外兩項，並回錯誤。事件 MUST 寫進 outbox，在交易 commit 之後才送給訂閱者，至少送出一次。事件內容 MUST 包含 `activityId`、`contactId`、`submissionId` 與 `activityType`。

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

### Requirement: 不允許重複參加的活動，每位粉絲只留下一筆作答

活動的 `settings.allowMultiple` 不是 `true` 時，同一位粉絲 MUST 只能留下一筆作答，也只拿到一次積分。同一位粉絲同時送出多次時，系統 MUST 只讓一次成功，其他回「您已參加過這個活動」。不同粉絲的送出 MUST NOT 互相等待。

#### Scenario: 第二次送出被拒絕，不再給積分

- **WHEN** 粉絲送出不允許重複參加的活動之後，再送出一次
- **THEN** 第二次回「您已參加過這個活動」，這位粉絲的積分只加一次

#### Scenario: 同一位粉絲同時送出兩次

- **WHEN** 粉絲的第一次送出還沒 commit，第二次送出開始
- **THEN** 第二次等第一次 commit 之後才檢查，回 `ALREADY_SUBMITTED`；這位粉絲只有一筆作答與一筆積分紀錄

#### Scenario: 同時送出時，活動 id 的大小寫不同

- **WHEN** 粉絲的第一次送出還沒 commit，第二次以大寫的活動 id 送出同一個活動
- **THEN** 第二次仍等第一次 commit 之後才檢查，回 `ALREADY_SUBMITTED`；這位粉絲只有一筆作答

### Requirement: 積分帳本的餘額依序累計

每一筆積分紀錄的 `balance` MUST 等於同一位聯絡人前一筆紀錄的 `balance` 加上這筆的 `amount`。目前餘額是 `createdAt` 最新的一筆。同時寫入同一位聯絡人的積分時，後一筆 MUST 以前一筆 commit 之後的餘額計算。新的一筆 MUST 排在既有紀錄之後，即使寫入時間落在同一毫秒。這條規則適用於送出活動給點、後台調整、聯絡人合併與解除合併轉移積分。

#### Scenario: 同時寫同一位聯絡人的積分

- **WHEN** 加 10 點還沒 commit 時，另一個交易加 3 點
- **THEN** 後一筆等前一筆 commit 之後才讀餘額；最新一筆的 `balance` 是 13，前一筆是 10

#### Scenario: 同時寫入時，聯絡人 id 的大小寫不同

- **WHEN** 加 10 點還沒 commit 時，另一個交易以大寫的聯絡人 id 加 3 點
- **THEN** 後一筆仍等前一筆 commit 之後才讀餘額，`balance` 是 13

#### Scenario: 同一毫秒內連續寫入

- **WHEN** 以同一個寫入時間，連續為同一位聯絡人加 3 次 1 點
- **THEN** 依 `createdAt` 由新到舊，`balance` 是 3、2、1，三筆的時間都不同

#### Scenario: 調整積分還沒 commit 時合併聯絡人

- **WHEN** 被合併方有 10 點，再加 5 點還沒 commit 時，開始把它併入另一位聯絡人
- **THEN** 合併等調整 commit 之後才讀餘額；被合併方的最新餘額是 0，保留方收到 15 點

#### Scenario: 扣點還沒 commit 時解除合併

- **WHEN** 合併轉入 10 點之後，保留方扣 8 點還沒 commit 時，開始解除這次合併
- **THEN** 解除合併等扣點 commit 之後才讀餘額；只轉回剩下的 2 點，保留方的餘額是 0，不是負數

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
- **THEN** 該操作等發布 commit 之後才檢查，回 `INVALID_ACTIVITY_STATUS`；活動維持已發布，選項沒有被換掉

#### Scenario: 編輯還沒 commit 時發布

- **WHEN** 草稿的編輯還沒 commit 時，開始發布同一個活動
- **THEN** 發布等編輯 commit 之後才執行，發布的是編輯後的活動

#### Scenario: 刪除還沒 commit 時封存

- **WHEN** 草稿的刪除還沒 commit 時，開始封存同一個活動
- **THEN** 封存等刪除 commit 之後回找不到，不回資料庫錯誤
