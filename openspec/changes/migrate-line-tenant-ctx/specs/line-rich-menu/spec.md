## MODIFIED Requirements

### Requirement: Rich Menu 草稿內容欄位

RichMenu record MUST 包含下列內容與發布狀態欄位：
- `chatBarText` (string，使用者在 LINE 聊天列底部看到的按鈕文字，最多 14 字)
- `size` (JSON，`{ width, height }`，必為 10 種版型其中之一的官方尺寸)
- `isDefault` (boolean，是否為所有好友的預設選單，預設 `false`)
- `selected` (boolean，聊天室打開時是否展開選單，對應 LINE 的 `selected`，預設 `true`)
- `areas` (JSON 陣列，每筆 `{ bounds: { x, y, width, height }, action: { type, ... } }`)
- `imageUrl` (string，MinIO 公開 URL)
- `status` (string，預設 `draft`。值為 `draft`、`publishing`（發布中）、`published`、`error`（發布失敗）之一)
- `lineRichMenuId` (string?，LINE 端 ID，由發布流程寫入，取消發布時清空)
- `publishedAt` (DateTime?，由發布流程寫入，取消發布時清空)

#### Scenario: 建立草稿成功
- **WHEN** 使用者 POST `/api/v1/line/rich-menus` 並提供有效的 channelId、版型 size、areas、imageUrl
- **THEN** 系統建立一筆 status=`draft` 的 RichMenu record，回傳 201 與完整 record

### Requirement: Default Rich Menu
The system SHALL allow setting and cancelling a default Rich Menu shown to all followers. A Rich Menu with `isDefault = true` becomes the default for all followers of its LINE official account when it is published. Setting a new default SHALL replace the current default on LINE without cancelling it first. The web console SHALL create new drafts with `isDefault = false`, and SHALL ask for confirmation in plain words before an action that changes the menu of all followers.

#### Scenario: Set default
- **WHEN** an administrator publishes a Rich Menu whose `isDefault` is true
- **THEN** the system calls `POST /v2/bot/user/all/richmenu/{richMenuId}` and the menu becomes the default for all followers
- **THEN** the system does not call `DELETE /v2/bot/user/all/richmenu`
- **THEN** other Rich Menus of the same channel have `isDefault = false`

#### Scenario: Cancel default
- **WHEN** an administrator unpublishes a Rich Menu whose `isDefault` is true, and the current default on LINE (`GET /v2/bot/user/all/richmenu`) is this menu
- **THEN** the system calls `DELETE /v2/bot/user/all/richmenu`

#### Scenario: 取消發布時 LINE 的預設是別的選單
- **WHEN** an administrator unpublishes a Rich Menu whose `isDefault` is true, and the current default on LINE is another menu
- **THEN** the system does not call `DELETE /v2/bot/user/all/richmenu`, and the default on LINE does not change

#### Scenario: New draft is not the default
- **WHEN** an administrator picks a layout to create a new Rich Menu
- **THEN** the option「設為所有好友的預設選單」is unchecked

#### Scenario: Check the default option
- **WHEN** an administrator checks「設為所有好友的預設選單」
- **THEN** the console asks for confirmation that says publishing replaces the menu of all followers, and the option stays unchecked if the administrator cancels

#### Scenario: Publish a default menu
- **WHEN** an administrator publishes a Rich Menu whose `isDefault` is true
- **THEN** the confirmation says the menu replaces the menu that all followers see now

#### Scenario: Unpublish a default menu
- **WHEN** an administrator unpublishes a Rich Menu whose `isDefault` is true
- **THEN** the confirmation says all followers lose the default menu

## ADDED Requirements

### Requirement: 圖文選單展開狀態

系統 SHALL 以 `selected` 決定 LINE 選單的展開狀態：發布時把 `selected` 原樣送進 LINE 建立選單 API 的 `selected`。`selected` 與 `isDefault` 互相獨立：預設選單可以收合，非預設選單可以展開。編輯頁 SHALL 以兩個選項分別設定「設為所有好友的預設選單」與「聊天室打開時展開選單」。

#### Scenario: 預設選單設為收合
- **WHEN** 管理員發布 `isDefault = true`、`selected = false` 的選單
- **THEN** LINE 建立選單 API 的 `selected` 是 `false`，系統仍把這個選單設成所有好友的預設

#### Scenario: 非預設選單設為展開
- **WHEN** 管理員發布 `isDefault = false`、`selected = true` 的選單
- **THEN** LINE 建立選單 API 的 `selected` 是 `true`，系統不呼叫設預設的 API

#### Scenario: 未傳入展開狀態
- **WHEN** 管理員建立選單，沒有傳入 `selected`
- **THEN** 選單的 `selected` 是 `true`

#### Scenario: 既有選單的預設狀態
- **WHEN** migration 執行前，一筆選單的 `selected` 是 `true`
- **THEN** migration 執行後，這筆選單的 `isDefault` 是 `true`，`selected` 不變

### Requirement: 發布在 LINE 上最多建立一次選單

系統 SHALL 在呼叫 LINE 之前，先把選單的 `status` 從 `draft` 或 `error` 改成 `publishing`。另一個請求已經把同一個選單改成 `publishing` 時，系統 MUST 回 HTTP 409，錯誤碼 `PUBLISH_IN_PROGRESS`，MUST NOT 呼叫 LINE。

LINE 建立選單之後，任何一步失敗（上傳背景圖失敗、寫入資料庫失敗），系統 SHALL 刪除剛建立的 LINE 選單，並把 `status` 改成 `error`。刪除也失敗時，LINE 上留下這個選單，系統寫一筆 error log，記錄 LINE 端的選單 id。

#### Scenario: 同一個選單同時發布兩次
- **WHEN** 兩個請求同時發布同一個 `status=draft` 的選單
- **THEN** 一個請求回 200，`status` 是 `published`；另一個回 409 `PUBLISH_IN_PROGRESS`
- **THEN** LINE 的建立選單 API 只被呼叫一次

#### Scenario: 上傳背景圖失敗
- **WHEN** LINE 建立選單成功，上傳背景圖失敗
- **THEN** 系統呼叫 LINE 刪除剛建立的選單，`status` 是 `error`，`lineRichMenuId` 是 null
- **THEN** 回應 400，錯誤碼 `LINE_API_ERROR`

#### Scenario: 寫入發布結果失敗
- **WHEN** LINE 建立選單與上傳背景圖都成功，寫入發布結果的交易失敗
- **THEN** 系統呼叫 LINE 刪除剛建立的選單
- **THEN** 選單不是 `published`，請求回錯誤

#### Scenario: 建立選單失敗
- **WHEN** LINE 建立選單的 API 回錯誤
- **THEN** `status` 是 `error`，系統不呼叫 LINE 刪除選單，回應 400，錯誤碼 `LINE_API_ERROR`

### Requirement: 同一個渠道同時只有一個選單在發布中

同一個 LINE 渠道已有其他選單是 `publishing`（停留未超過 5 分鐘）時，發布這個渠道的另一個選單 MUST 回 HTTP 409，錯誤碼 `PUBLISH_IN_PROGRESS`，MUST NOT 呼叫 LINE。不同渠道的選單 SHALL 可以同時發布。

#### Scenario: 同一個渠道的兩個選單同時發布
- **WHEN** 同一個渠道的選單 A 與選單 B 同時發布
- **THEN** 一個請求回 200；另一個回 409 `PUBLISH_IN_PROGRESS`，它的選單 `status` 不變

#### Scenario: 不同渠道的選單同時發布
- **WHEN** 渠道 X 的選單與渠道 Y 的選單同時發布
- **THEN** 兩個請求都回 200

### Requirement: 發布中斷或失敗的選單可以重新發布

`status` 是 `error` 的選單 SHALL 可以重新發布。`status` 是 `publishing`、而且最後更新超過 5 分鐘的選單，視為發布中斷，SHALL 可以重新發布。列表頁 SHALL 把 `publishing` 顯示成「發布中」，並為 `error` 的選單顯示「發布」按鈕。

#### Scenario: 重新發布失敗的選單
- **WHEN** 管理員發布一個 `status=error` 的選單，LINE 都成功
- **THEN** 回應 200，`status` 是 `published`

#### Scenario: 重新發布中斷的選單
- **WHEN** 選單的 `status` 是 `publishing`，最後更新是 6 分鐘前，管理員發布這個選單
- **THEN** 系統呼叫 LINE，回應 200，`status` 是 `published`

#### Scenario: 發布中的選單不能重新發布
- **WHEN** 選單的 `status` 是 `publishing`，最後更新是 1 分鐘前，管理員發布這個選單
- **THEN** 回應 409 `PUBLISH_IN_PROGRESS`，不呼叫 LINE

#### Scenario: 列表頁顯示發布中與發布失敗
- **WHEN** 列表頁載入一個 `publishing` 的選單與一個 `error` 的選單
- **THEN** 前者的狀態顯示「發布中」，沒有「發布」按鈕；後者顯示「發布」按鈕

### Requirement: 設預設失敗時保留原本的預設

發布 `isDefault = true` 的選單時，LINE 設預設的 API 失敗，系統 SHALL 仍完成發布，但 MUST 把這個選單的 `isDefault` 記成 `false`，MUST NOT 修改同渠道其他選單的 `isDefault`，並在回應的 `warnings` 帶 `DEFAULT_NOT_SET`。LINE 上原本的預設選單 SHALL 不受影響。

#### Scenario: 設預設失敗
- **WHEN** 同渠道的選單 A 是預設；管理員發布 `isDefault = true` 的選單 B，LINE 建立與上傳成功，設預設失敗
- **THEN** 回應 200，選單 B 的 `status` 是 `published`、`isDefault` 是 `false`，`warnings` 含 `DEFAULT_NOT_SET`
- **THEN** 選單 A 的 `isDefault` 仍是 `true`，系統沒有呼叫 `DELETE /v2/bot/user/all/richmenu`

#### Scenario: 設預設成功
- **WHEN** 管理員發布 `isDefault = true` 的選單，LINE 設預設成功
- **THEN** 這個選單的 `isDefault` 是 `true`，同渠道其他選單的 `isDefault` 是 `false`，回應沒有 `DEFAULT_NOT_SET`

### Requirement: 背景綁定只綁到仍在發布中的選單

分眾綁定的背景工作至少送出一次：發起綁定的請求 commit 之後，Redis 暫時無法使用時，系統 SHALL 仍回成功，之後補送。workers 執行綁定前 SHALL 讀取選單：選單已不是 `published`，或 `lineRichMenuId` 與工作記錄的不同時，MUST 跳過，MUST NOT 呼叫 LINE 綁定。解除綁定 SHALL 不做這項檢查，照常執行。

#### Scenario: 綁定工作晚於取消發布執行
- **WHEN** 綁定工作送出之後，管理員取消發布這個選單，之後 workers 執行綁定工作
- **THEN** workers 不呼叫 LINE 的綁定 API

#### Scenario: 綁定工作晚於重新發布執行
- **WHEN** 綁定工作送出之後，選單取消發布再重新發布（`lineRichMenuId` 改變），之後 workers 執行綁定工作
- **THEN** workers 不呼叫 LINE 的綁定 API

#### Scenario: 選單仍在發布中
- **WHEN** workers 執行綁定工作，選單仍是 `published`，`lineRichMenuId` 與工作相同
- **THEN** workers 呼叫 LINE 的綁定 API

#### Scenario: Redis 無法使用時發起綁定
- **WHEN** Redis 無法使用，管理員綁定一個已發布選單的受眾
- **THEN** 回應 200 與排入的人數，綁定工作在 Redis 恢復後送出
