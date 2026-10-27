# Spec Delta

## Purpose

讓平台管理員看到 API 與 workers 所有 BullMQ 佇列的 job 與失敗原因、重送失敗的 job，並在 job 重試用完時收到告警；同時規定各佇列 job 的保留期限。

## ADDED Requirements

### Requirement: 只允許設定的網段連線

`/api/v1/platform/queues` 底下的所有路徑（畫面、靜態檔、API、換發 cookie 的端點），API MUST 先以請求的來源 IP 比對環境變數 `QUEUE_DASHBOARD_ALLOWED_CIDRS` 列出的網段，不在網段內就回 403，不檢查登入。這個變數可以列出多個網段，以逗號分隔。IPv4 對應的 IPv6 位址（`::ffff:a.b.c.d`）MUST 以其 IPv4 位址比對。來源 IP 依 API 的受信任代理設定計算，請求自帶的 `X-Forwarded-For` MUST NOT 讓網段外的連線通過。

#### Scenario: 網段內的 IP 連線

- **WHEN** `QUEUE_DASHBOARD_ALLOWED_CIDRS` 是 `60.248.142.0/24`，來源 IP `60.248.142.10` 帶有效的監控 cookie 開啟 `/api/v1/platform/queues`
- **THEN** API 回 200

#### Scenario: 網段外的 IP 連線

- **WHEN** `QUEUE_DASHBOARD_ALLOWED_CIDRS` 是 `60.248.142.0/24`，來源 IP `203.0.113.5` 帶有效的監控 cookie 開啟 `/api/v1/platform/queues`
- **THEN** API 回 403

#### Scenario: 網段外的 IP 偽造 X-Forwarded-For

- **WHEN** 來源 IP `203.0.113.5` 帶 `X-Forwarded-For: 60.248.142.10` 開啟 `/api/v1/platform/queues`
- **THEN** API 回 403

#### Scenario: IPv4 對應的 IPv6 位址

- **WHEN** `QUEUE_DASHBOARD_ALLOWED_CIDRS` 是 `60.248.142.0/24`，來源 IP 是 `::ffff:60.248.142.10`，帶有效的監控 cookie
- **THEN** API 回 200

#### Scenario: 換發 cookie 的端點也檢查網段

- **WHEN** 來源 IP `203.0.113.5` 帶有效的平台 JWT 呼叫 `POST /api/v1/platform/queues/session`
- **THEN** API 回 403，不設定 cookie

### Requirement: 沒有設定網段時拒絕所有連線

`QUEUE_DASHBOARD_ALLOWED_CIDRS` 沒有設定、是空值，或任一個網段的格式錯誤時，`/api/v1/platform/queues` 底下的所有路徑 MUST 回 403。格式正確的網段是 `<IP 位址>/<十進位前綴>`，不含空白或多餘的片段。API 照常啟動，平台後台的其他路由不受影響。

#### Scenario: 沒有設定網段

- **WHEN** 沒有設定 `QUEUE_DASHBOARD_ALLOWED_CIDRS`，來源 IP `127.0.0.1` 帶有效的監控 cookie 開啟 `/api/v1/platform/queues`
- **THEN** API 回 403

#### Scenario: 網段的前綴是空白

- **WHEN** `QUEUE_DASHBOARD_ALLOWED_CIDRS` 是 `60.248.142.0/`，來源 IP `203.0.113.5` 帶有效的監控 cookie 開啟 `/api/v1/platform/queues`
- **THEN** API 回 403

#### Scenario: 平台後台的其他路由不受影響

- **WHEN** 沒有設定 `QUEUE_DASHBOARD_ALLOWED_CIDRS`，以有效的平台 JWT 呼叫 `GET /api/v1/platform/plans`
- **THEN** API 照常回應，不因網段設定回 403

### Requirement: 以平台 JWT 換發監控用的 cookie

平台管理員以 `Authorization: Bearer <平台 JWT>` 呼叫 `POST /api/v1/platform/queues/session`。API 依「平台路由一律驗證平台帳號」驗證這個 JWT，通過後設定監控用的 cookie。cookie MUST 是 `HttpOnly`、`SameSite=Strict`，`Path` 是 `/api/v1/platform/queues`，有效期限 MUST 不超過 1 小時。驗證失敗時，API MUST NOT 設定 cookie。換發端點以外的監控路徑，請求帶 `Origin` 標頭時，`Origin` MUST 與監控畫面同一個來源，否則回 403：`SameSite=Strict` 擋不住同一個上層網域的其他子網域。

#### Scenario: 換發成功

- **WHEN** 有效的平台 JWT 從允許的網段呼叫 `POST /api/v1/platform/queues/session`
- **THEN** 回應設定一個 `HttpOnly`、`SameSite=Strict`、`Path=/api/v1/platform/queues` 的 cookie，有效期限不超過 1 小時

#### Scenario: 以租戶 JWT 換發

- **WHEN** 租戶的 JWT 從允許的網段呼叫 `POST /api/v1/platform/queues/session`
- **THEN** API 回 401，不設定 cookie

#### Scenario: 須改密碼的平台帳號換發

- **WHEN** `mustChangePassword` 為 true 的平台帳號，以有效的平台 JWT 從允許的網段呼叫 `POST /api/v1/platform/queues/session`
- **THEN** API 拒絕請求，不設定 cookie

#### Scenario: 其他來源的頁面帶監控 cookie 呼叫

- **WHEN** 平台管理員持有有效的監控 cookie，從允許的網段開啟 `https://other.example.com` 的頁面，這個頁面帶 cookie 對 `/api/v1/platform/queues/api/queues/event-webhook/<job id>/retry` 送出 PUT
- **THEN** API 回 403，job 不重送

### Requirement: 列出所有佇列

佇列監控畫面 MUST 列出 API 與 workers 兩個行程使用中的每個 BullMQ 佇列，包括各佇列 waiting、active、delayed、completed、failed 的 job，以及 failed job 的失敗原因與 stack。

#### Scenario: 列出 workers 行程的佇列

- **WHEN** 平台管理員以有效的監控 cookie 從允許的網段開啟佇列清單
- **THEN** 清單包含 `notification`、`automation`、`event-automation` 與 `api-scheduler`

#### Scenario: 顯示失敗原因

- **WHEN** `event-webhook` 佇列有一個 failed job，失敗原因是 `HTTP 500`
- **THEN** 這個 job 的細節顯示失敗原因 `HTTP 500`

### Requirement: 只放行讀取與重送單一個 failed job

佇列監控的 API MUST 只放行兩種請求：`GET` 請求，以及重送單一個狀態是 failed 的 job。其他會改變佇列或 job 的請求 MUST 回 403，包括新增、刪除、清除、清空、暫停、重送整個狀態、提前執行、修改 job 資料或排程。重送狀態不是 failed 的 job（例如 completed）MUST 回 403。之後新增的寫入操作，在放行之前 MUST 回 403。

#### Scenario: 重送一個 failed job

- **WHEN** 平台管理員重送 `event-webhook` 佇列中一個 failed job
- **THEN** API 回 2xx，這個 job 回到等待處理的狀態

#### Scenario: 重送一個 completed job

- **WHEN** 平台管理員重送 `notification` 佇列中一個 completed job
- **THEN** API 回 403，job 的狀態不變

#### Scenario: 重送時 job 已不是 failed

- **WHEN** 兩個重送請求同時檢查到同一個 job 是 failed，第一個請求重送之後 job 執行完成，第二個請求才實際重送
- **THEN** 第二個請求不重送這個 job，job 維持 completed

#### Scenario: 重送整個 failed 狀態

- **WHEN** 平台管理員要一次重送 `event-webhook` 佇列的所有 failed job
- **THEN** API 回 403，failed job 的狀態不變

#### Scenario: 刪除整個佇列

- **WHEN** 平台管理員要清空或刪除 `automation` 佇列
- **THEN** API 回 403，佇列內的 job 不變

#### Scenario: 修改 job 資料

- **WHEN** 平台管理員要修改一個 failed job 的資料
- **THEN** API 回 403，job 的資料不變

### Requirement: 重送 job 寫入平台稽核

平台管理員重送一個 job 成功時，API MUST 寫入一筆 `PlatformAuditLog`。action 是 `queue.job.retry`，targetType 是 `queue_job`，targetId 是佇列名稱與 job id，platformUserId 是這位平台管理員。被拒絕的請求 MUST NOT 寫入稽核。

#### Scenario: 重送成功時寫入稽核

- **WHEN** 平台管理員 P 重送 `event-webhook` 佇列的 failed job J，重送成功
- **THEN** API 寫入一筆 action 為 `queue.job.retry` 的稽核，platformUserId 是 P，targetId 含 `event-webhook` 與 J 的 id

#### Scenario: 被拒絕的重送不寫入稽核

- **WHEN** 平台管理員重送一個 completed job，API 回 403
- **THEN** API 不寫入稽核

### Requirement: job 資料只顯示識別欄位

佇列監控 MUST 遮蔽 job 資料中的內容，只顯示識別欄位。識別欄位是：最上層的 `name`、`type`，以及任一層名稱為 `id` 或以 `Id` 結尾、值是字串或數字的欄位。其他欄位的值 MUST 顯示為 `[已遮蔽]`，包括之後新增的欄位。job 的失敗原因與 stack 照常顯示。

#### Scenario: 遮蔽訊息內容

- **WHEN** `event-automation` 佇列的 job 資料是 `{ eventId: 'e1', name: 'message.received', tenantId: 't1', payload: { contactId: 'c1', content: '我的電話是 0912…' } }`
- **THEN** 畫面顯示 `eventId`、`name`、`tenantId`、`payload.contactId` 的值，`payload.content` 顯示為 `[已遮蔽]`

#### Scenario: 巢狀的 name 不是識別欄位

- **WHEN** job 資料是 `{ name: 'contact.created', payload: { name: '王小明' } }`
- **THEN** 最上層的 `name` 顯示 `contact.created`，`payload.name` 顯示為 `[已遮蔽]`

### Requirement: 被認領擋下的副作用標示跳過

處理 job 時，副作用因為認領鍵已有紀錄而跳過，這個 job 的回傳值 MUST 列出每個被跳過的認領鍵（種類、來源 id、子鍵）。沒有副作用被跳過時，回傳值 MUST NOT 含這份清單。管理員重送 job 之後，可以從回傳值看出哪些副作用沒有再執行。

#### Scenario: 重送已執行過規則動作的 job

- **WHEN** `automation` 佇列的 job 第一次執行時，已認領並執行規則動作 A，之後 job 失敗，管理員重送這個 job
- **THEN** 重送完成後，job 的回傳值列出 A 的認領鍵，種類是 `automation_action`

#### Scenario: 第一次執行沒有跳過

- **WHEN** `automation` 佇列的 job 第一次執行，所有規則動作都認領成功
- **THEN** job 的回傳值不含跳過清單

### Requirement: job 移到 failed set 時發出告警

任何佇列的 job 移到 failed set 時，API MUST 以 `ops-alert` 發出一則告警：重試用完、或 job 丟出不可重試的錯誤，都算移到 failed set。job 失敗之後還會重試時，MUST NOT 發出告警。同一個佇列的告警使用同一個合併鍵，不同佇列的合併鍵不同。`ops-alert` 自己的佇列失敗時，MUST NOT 發出告警。

#### Scenario: 重試用完

- **WHEN** `event-webhook` 佇列的 job 設定重試 3 次，第 3 次也失敗
- **THEN** API 發出一則告警，含佇列名稱 `event-webhook` 與 job id

#### Scenario: 還會重試的失敗

- **WHEN** `event-webhook` 佇列的 job 第 1 次失敗，還有 2 次重試
- **THEN** API 不發出告警

#### Scenario: workers 行程的佇列

- **WHEN** workers 行程處理的 `notification` 佇列有一個 job 移到 failed set
- **THEN** API 發出一則告警，含佇列名稱 `notification`

#### Scenario: 告警佇列本身失敗

- **WHEN** `ops-alert` 佇列的 job 重試用完
- **THEN** 系統只記錄 log，不發出告警

### Requirement: 各佇列 job 的保留期限

每個佇列的 completed job 與 failed job MUST 有保留期限。原本沒有設定保留期限的佇列（`rich-menu-bind`、`data-export`、`sla`、`data-export-cleanup`、`tag-expiry-cleanup`、`agent-retention-cleanup`），completed job 保留 24 小時，failed job 保留 7 天。部署之前已經排定的週期 job，在 workers 重新啟動之後 MUST 也套用這個保留期限。

#### Scenario: completed job 超過 24 小時

- **WHEN** `data-export` 佇列的一個 job 完成超過 24 小時，佇列之後又有 job 完成
- **THEN** 這個 job 已從 Redis 刪除

#### Scenario: failed job 超過 7 天

- **WHEN** `rich-menu-bind` 佇列的一個 job 失敗超過 7 天，佇列之後又有 job 失敗
- **THEN** 這個 job 已從 Redis 刪除

#### Scenario: 部署前已排定的週期 job

- **WHEN** Redis 裡已經排定一個沒有保留期限的 `sla:poll` 週期 job，workers 以新版本重新啟動
- **THEN** 之後產生的 `sla:poll` job 都套用 completed 24 小時、failed 7 天的保留期限
