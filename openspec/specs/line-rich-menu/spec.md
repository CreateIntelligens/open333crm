## Purpose

Define LINE Rich Menu management for open333CRM, including CRM-side draft authoring, LINE-channel scoped layouts and actions, admin UI behavior, and future publishing/default/binding/alias integration with the LINE Messaging API.

## Requirements

### Requirement: Rich Menu CRUD
The system SHALL allow administrators to create, read, update, and delete LINE Rich Menus via the Admin Console.

#### Scenario: Create Rich Menu
- **WHEN** an administrator submits a Rich Menu configuration (size, chatBarText, areas with actions)
- **THEN** the system calls `POST /v2/bot/richmenu`, stores the returned `richMenuId` in `RichMenu.lineRichMenuId`, and uploads the background image via `POST /v2/bot/richmenu/{richMenuId}/content`

#### Scenario: List all Rich Menus
- **WHEN** an administrator opens the Rich Menu management page
- **THEN** the system returns all Rich Menus from the local DB, reflecting current state on LINE platform

#### Scenario: Delete Rich Menu
- **WHEN** an administrator deletes a Rich Menu
- **THEN** the system calls `DELETE /v2/bot/richmenu/{richMenuId}` on LINE API and removes the record from DB

---

### Requirement: Default Rich Menu
The system SHALL allow setting and cancelling a default Rich Menu shown to all followers. A Rich Menu with `isDefault = true` becomes the default for all followers of its LINE official account when it is published. Setting a new default SHALL replace the current default on LINE without cancelling it first. The web console SHALL create new drafts with `isDefault = false`, and SHALL ask for confirmation in plain words before an action that changes the menu of all followers.

#### Scenario: Set default
- **WHEN** an administrator publishes a Rich Menu whose `isDefault` is true
- **THEN** the system calls `POST /v2/bot/user/all/richmenu/{richMenuId}` and the menu becomes the default for all followers
- **THEN** the system does not call `DELETE /v2/bot/user/all/richmenu`
- **THEN** other published Rich Menus of the same channel have `isDefault = false`; drafts keep their `isDefault`

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

### Requirement: User Rich Menu binding
The system SHALL support binding and unbinding a specific Rich Menu to individual contacts or batches of contacts.

#### Scenario: Bind single user
- **WHEN** an Automation Action `CHANNEL_UI_SWITCH` is triggered for a contact
- **THEN** the system calls `POST /v2/bot/user/{userId}/richmenu/{richMenuId}`

#### Scenario: Batch bind via Marketing
- **WHEN** a Rich Menu binding is scheduled for a segment (up to 500 contacts)
- **THEN** the system enqueues a `rich-menu-batch` BullMQ job with rate limit of 3 executions/hour
- **THEN** calls `POST /v2/bot/richmenu/bulk/link` for each batch

---

### Requirement: Rich Menu Alias for A/B switching
The system SHALL support Rich Menu Alias to enable instant switch between menus (e.g., event vs. default) without re-binding users.

#### Scenario: Create alias
- **WHEN** an administrator creates an alias referencing a `richMenuId`
- **THEN** the system calls `POST /v2/bot/richmenu/alias` and stores the `aliasId`

#### Scenario: Switch alias target
- **WHEN** an administrator updates the alias to point to a different `richMenuId`
- **THEN** all users bound to that alias see the new Rich Menu instantly without rebinding

---

### Requirement: Rich Menu 草稿模型

系統 SHALL 提供 `RichMenu` 資料模型，儲存使用者建立的 Rich Menu 草稿。每筆 record MUST 綁定到一個 LINE 渠道（`channelId` 對應 `channels.id` 且 `channels.channelType = 'LINE'`），並隸屬於該 tenant。

Record MUST 包含下列識別與歸屬欄位：
- `id` (UUID)
- `tenantId` (UUID)
- `channelId` (UUID，外鍵到 channels 表)
- `name` (string，CRM 內部名稱)
- `createdAt` / `updatedAt`

#### Scenario: 拒絕非 LINE 渠道
- **WHEN** 使用者建立 Rich Menu 時 channelId 對應的 channel `channelType` 不是 `'LINE'`
- **THEN** 系統回應 400，錯誤碼 `INVALID_CHANNEL_TYPE`，訊息「Rich Menu 僅支援 LINE 渠道」

#### Scenario: 拒絕跨 tenant 渠道
- **WHEN** 使用者建立 Rich Menu 時 channelId 屬於其他 tenant
- **THEN** 系統回應 404，錯誤碼 `NOT_FOUND`（避免洩露 channel 存在性）

### Requirement: Rich Menu 草稿內容欄位

RichMenu record MUST 包含下列欄位：
- `chatBarText` (string，聊天列底部的按鈕文字，最多 14 字)
- `size` (JSON，`{ width, height }`，必為 10 種版型其中之一的官方尺寸)
- `isDefault` (boolean，預設 `false`，取消發布時保留，意思見「Default Rich Menu」)
- `selected` (boolean，預設 `true`，意思見「圖文選單展開狀態」)
- `areas` (JSON 陣列，每筆含 `bounds` 與 `action`)
- `imageUrl` (string，MinIO 公開 URL)
- `status` (string，`draft`（預設）、`publishing`、`published`、`error` 之一)
- `lineRichMenuId` (string?，LINE 端 ID，發布時寫入，取消發布時清空)
- `publishedAt` (DateTime?，發布時寫入，取消發布時清空)

#### Scenario: 建立草稿成功
- **WHEN** 使用者 POST `/api/v1/line/rich-menus` 並提供有效的 channelId、版型 size、areas、imageUrl
- **THEN** 系統建立一筆 status=`draft` 的 RichMenu record，回傳 201 與完整 record

### Requirement: 10 種固定版型

系統 SHALL 提供 LINE 官方 10 種固定版型供使用者選擇，不接受任意 size / areas 組合。

每個版型 MUST 包含預定義的 `defaultAreas`（座標已對齊像素），使用者只能調整 action 不能改 bounds。

#### Scenario: 拒絕不在白名單的 size
- **WHEN** 使用者繞過前端直接 POST 一筆 size = `{ width: 1000, height: 500 }` 的 record
- **THEN** 系統回應 400，錯誤碼 `INVALID_LAYOUT`，訊息列出合法尺寸

### Requirement: 10 種版型清單

系統 SHALL 提供下列 10 種版型：
- **大選單 (2500×1686 或 1200×810)**：6 種
  - `large-1`: 2×2 (4 areas)
  - `large-2`: 上 1 + 下 2 (3 areas)
  - `large-3`: 上 2 + 下 1 (3 areas) — 對稱於 large-2
  - `large-4`: 上 1 + 下 3 平分 (4 areas)
  - `large-5`: 上 1 + 下 1 (2 areas，全寬橫條)
  - `large-6`: 3×2 (6 areas)
- **小選單 (2500×843 或 1200×405)**：4 種
  - `compact-1`: 3 列等寬 (3 areas)
  - `compact-2`: 1 + 2 (左大右兩格)
  - `compact-3`: 2 + 1 (左兩格右大) — 對稱於 compact-2
  - `compact-4`: 全寬單格 (1 area)

#### Scenario: 用版型 ID 建立 Rich Menu
- **WHEN** 使用者選擇 `layoutId = 'large-1'`
- **THEN** 前端載入該版型的 `size` 與 `defaultAreas`，使用者填入每個 area 的 action 後送出

---

### Requirement: 區域 Action 編輯

系統 SHALL 支援 5 種 LINE 官方 Rich Menu action 類型。每個 area 必須恰好綁定一個 action。

支援的 action：

| Type | 必填欄位 | 選填欄位 |
|---|---|---|
| `postback` | `data` (≤300 chars) | `label` (≤20 chars), `displayText` (≤300 chars) |
| `message` | `text` (≤300 chars) | `label` |
| `uri` | `uri` (https / tel / line URL scheme) | `label`, `altUri.desktop` |
| `datetimepicker` | `data`, `mode` (`date` \| `time` \| `datetime`) | `label`, `initial`, `min`, `max` |
| `richmenuswitch` | `richMenuAliasId`, `data` | `label` |

#### Scenario: 建立 uri action
- **WHEN** 使用者為某 area 設定 type=`uri`、uri=`https://example.com`、label=`官網`
- **THEN** 系統儲存該 action 並回傳，前端列表可顯示 label

#### Scenario: 拒絕缺欄位的 postback
- **WHEN** 使用者送出 type=`postback` 但 `data` 為空字串
- **THEN** 系統回應 400，錯誤碼 `INVALID_ACTION`，指出 data 必填

#### Scenario: 提示 richmenuswitch 需先 publish 目標
- **WHEN** 使用者建立 type=`richmenuswitch` action
- **THEN** 系統 SHALL 接受並儲存（不擋），但 API 回傳的 warning 欄位包含 `RICHMENUSWITCH_REQUIRES_PUBLISHED_TARGET`，前端 UI 顯示提示「目標 Rich Menu 需先 publish 並設 alias 後才能切換」

---

### Requirement: 多 LINE OA 切換

系統 SHALL 支援單一 tenant 擁有多個 LINE 渠道，使用者可在 Rich Menu 列表頁切換查看不同 OA 的草稿。

#### Scenario: 列出特定 OA 的草稿
- **WHEN** 使用者 GET `/api/v1/line/rich-menus?channelId={uuid}`
- **THEN** 系統僅回傳該 channelId 對應的 Rich Menu records

#### Scenario: 拒絕不指定 channelId 的查詢
- **WHEN** 使用者 GET `/api/v1/line/rich-menus` 但未帶 channelId
- **THEN** 系統回應 400，錯誤碼 `CHANNEL_ID_REQUIRED`（避免跨 OA 資料混雜）

#### Scenario: URL 帶 channelId 可分享 / refresh
- **WHEN** 使用者複製當前頁面 URL `/dashboard/line/rich-menus?channelId=xxx` 並在新分頁打開
- **THEN** 前端從 URL 取出 channelId，OA 切換器自動選中對應 OA 並載入該 OA 的清單

---

### Requirement: 背景圖上傳與驗證

系統 SHALL 接受使用者上傳 Rich Menu 背景圖到 MinIO，並在儲存到 `imageUrl` 前驗證圖片符合 LINE 官方規格。

驗證規則：
- 檔案格式：MUST 為 `image/jpeg` 或 `image/png`
- 檔案大小：MUST ≤ 1 MB
- 圖片尺寸：MUST 等於該 Rich Menu 選擇的版型 size（pixel 級精確比對）

#### Scenario: 上傳成功
- **WHEN** 使用者上傳 1250×843 的 JPEG 給 size=`{1250, 843}` 的草稿
- **THEN** 系統存到 MinIO 並回傳 imageUrl

#### Scenario: 拒絕格式
- **WHEN** 使用者上傳 GIF
- **THEN** 系統回應 400，錯誤碼 `INVALID_IMAGE_FORMAT`，訊息「僅支援 JPEG / PNG」

#### Scenario: 拒絕尺寸不符
- **WHEN** 使用者為 size=`{2500, 1686}` 的草稿上傳 1250×843 圖片
- **THEN** 系統回應 400，錯誤碼 `IMAGE_SIZE_MISMATCH`，訊息「需 2500×1686，實際 1250×843」

#### Scenario: 拒絕超大檔案
- **WHEN** 使用者上傳 2.5 MB 的 PNG
- **THEN** 系統回應 400，錯誤碼 `IMAGE_TOO_LARGE`，訊息「上限 1 MB」

---

### Requirement: Rich Menu 複製

系統 SHALL 提供 Rich Menu 複製功能，便於使用者建立 A/B 版本。

#### Scenario: 成功複製
- **WHEN** 使用者 POST `/api/v1/line/rich-menus/:id/duplicate`
- **THEN** 系統建立一筆新 record，欄位完全複製來源（含 areas、imageUrl、size、channelId），但：
  - `id` 重新生成
  - `name` 為原 name + 「（副本）」
  - `status` 強制設為 `draft`
  - `lineRichMenuId` / `publishedAt` 清空

#### Scenario: 來源不存在
- **WHEN** 使用者複製不存在或非自家 tenant 的 Rich Menu
- **THEN** 系統回應 404

---

### Requirement: Rich Menu 刪除限制

系統 SHALL 僅允許刪除 `status=draft` 的 Rich Menu，防止意外刪除已 publish 到 LINE 的選單。

本期所有 record `status` 固定為 `draft`，故刪除一律允許。但服務層 MUST 包含此守衛，Louis 接 publish 流程後不需改服務層程式碼。

#### Scenario: 刪除草稿成功
- **WHEN** 使用者 DELETE `/api/v1/line/rich-menus/:id` 且該 record `status=draft`
- **THEN** 系統 hard delete record（不需軟刪，草稿無業務歷史）

#### Scenario: 拒絕刪除已 publish
- **WHEN** 使用者 DELETE 一筆 `status=published` 的 record（本期不會發生，但守衛 MUST 存在）
- **THEN** 系統回應 400，錯誤碼 `CANNOT_DELETE_PUBLISHED`，訊息「請先取消發布」

---

### Requirement: 權限控制

Rich Menu CRUD endpoints SHALL 需要 SUPERVISOR 以上權限。AGENT 角色不可建立 / 編輯 / 刪除 Rich Menu。

#### Scenario: SUPERVISOR 可建立
- **WHEN** SUPERVISOR 角色的 agent POST `/api/v1/line/rich-menus`
- **THEN** 系統允許並建立 record

#### Scenario: AGENT 被拒
- **WHEN** AGENT 角色的 agent GET `/api/v1/line/rich-menus`
- **THEN** 系統回應 403，錯誤碼 `FORBIDDEN`

#### Scenario: ADMIN 可建立
- **WHEN** ADMIN 角色 POST
- **THEN** 系統允許（ADMIN > SUPERVISOR）

---

### Requirement: 前端列表頁

系統 SHALL 在 `/dashboard/line/rich-menus` 路由提供 Rich Menu 列表頁。

UI 要求：
- Topbar 顯示「LINE 管理」
- Tab 列上方有 OA 切換器（下拉，列 tenant 內所有 active LINE channels）
- Tab 列包含「Rich Menu」（active）、「Quick Reply」、「歡迎訊息」、「加好友自動回應」（後三者本期 disabled 灰色顯示，hover 提示「敬請期待」）
- 內容區為網格卡片：縮圖（背景圖）+ 名稱 + 狀態 badge（本期一律「草稿」）+ 操作按鈕（編輯、複製、刪除）
- 右上方按鈕「+ 建立 Rich Menu」
- 空狀態：插畫或圖示 + 「尚未建立任何 Rich Menu」+ 行動按鈕

#### Scenario: 首次進入空狀態
- **WHEN** 使用者首次進入頁面，該 OA 無任何 Rich Menu
- **THEN** 顯示空狀態介面與「建立第一個 Rich Menu」按鈕

#### Scenario: 切換 OA 重新載入
- **WHEN** 使用者透過 OA 切換器選擇不同 LINE channel
- **THEN** 列表立即重新載入該 OA 的 records，URL 同步更新為 `?channelId=xxx`

---

### Requirement: 前端編輯頁

系統 SHALL 在 `/dashboard/line/rich-menus/new` 與 `/dashboard/line/rich-menus/:id` 提供建立與編輯介面。

UI 要求：
- **新建流程**：先選版型（10 種卡片網格）→ 進入編輯頁
- **編輯頁**為左右雙欄：
  - 左：基本資訊（name、chatBarText、selected）+ 上傳背景圖 + 區域 action 列表（點擊每個區域展開該區域的 action 編輯器）
  - 右：即時預覽（背景圖 + 區域熱區疊層，hover 高亮）
- 底部固定按鈕：「取消」+「儲存草稿」
- **不顯示「發布」按鈕**（本期 Louis 未接手）

#### Scenario: 區域 action 編輯
- **WHEN** 使用者在左側點擊「區域 1」
- **THEN** 該區域展開 action 編輯器，顯示 5 種 action type 選項與對應欄位，右側預覽中該區域高亮顯示

#### Scenario: 儲存草稿
- **WHEN** 使用者點「儲存草稿」且所有必填欄位齊全
- **THEN** 系統 POST/PATCH，成功後 router.push 回列表頁並顯示 toast「已儲存」

#### Scenario: 取消編輯
- **WHEN** 使用者點「取消」且有未儲存變更
- **THEN** 顯示 confirm dialog 「離開將不會儲存變更，確定？」，確認後返回列表頁

---

### Requirement: 左側導航新增「LINE 管理」群組

系統 SHALL 在左側 Sidebar 新增「LINE 管理」群組導航項，群組底下含「Rich Menu」子項。

#### Scenario: 顯示群組
- **WHEN** SUPERVISOR 以上角色登入並渲染 Sidebar
- **THEN** 看到「LINE 管理」群組，展開後有「Rich Menu」項目

#### Scenario: AGENT 不顯示
- **WHEN** AGENT 角色登入
- **THEN** 不顯示「LINE 管理」群組（因子功能皆需 SUPERVISOR）

### Requirement: Rich Menu Audience Binding

The system SHALL allow a published Rich Menu to be bound to an audience (a Segment or a tag), so that different audiences see different Rich Menus. Binding SHALL only be allowed for a Rich Menu whose status is `published` (with a `lineRichMenuId`); draft or errored menus SHALL be rejected with a clear "publish first" error.

#### Scenario: Binding a draft menu is rejected

- **WHEN** a user attempts to bind a Rich Menu whose status is not `published`
- **THEN** the request is rejected with an error indicating the menu must be published first

#### Scenario: Different audiences see different menus

- **WHEN** menu A is published as the all-default and menu B is bound to the VIP audience
- **THEN** VIP users see menu B (per-user binding takes precedence over all-default) and everyone else sees menu A

### Requirement: Rich Menu Audience Binding Runs In Background

Audience binding SHALL resolve the audience to contacts, then to their LINE user ids (via LINE channel identities), and link the menu to those users through LINE's bulk-link API. Audience binding SHALL run as a background batch (audiences may be large and LINE bulk-link is rate-limited), and the API SHALL return immediately with the number of users queued.

#### Scenario: Bind published menu to a segment

- **WHEN** a user binds a published Rich Menu to a segment
- **THEN** the segment's contacts with LINE identities are resolved to user ids and a background job links the menu to those users
- **AND** the API returns the queued user count

### Requirement: Rich Menu Audience Unbinding

The system SHALL allow unbinding a Rich Menu from an audience, removing the per-user link for those users (they revert to the all-default menu, if any). Unbinding SHALL also run as a background batch.

#### Scenario: Unbind an audience from a menu

- **WHEN** a user unbinds an audience from a Rich Menu
- **THEN** a background job unlinks those users' per-user menu and they revert to the all-default menu

### Requirement: Audience Binding Is Tenant-Scoped

Audience resolution and menu binding SHALL be tenant-scoped: only contacts of the current tenant are resolved, and only Rich Menus belonging to the tenant's channel may be bound.

#### Scenario: Binding does not cross tenants

- **WHEN** an audience is resolved for binding
- **THEN** only the current tenant's contacts and channel are used; other tenants' contacts are never linked

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

`status` 是 `error` 的選單 SHALL 可以重新發布。`status` 是 `publishing`、而且最後更新超過 5 分鐘的選單，視為發布中斷，SHALL 可以重新發布。中斷的請求恢復後，MUST NOT 修改另一個請求重新認領的選單。列表頁與編輯頁 SHALL 把未超過 5 分鐘的 `publishing` 顯示成「發布中」、超過 5 分鐘的顯示成「發布中斷」，並為 `error` 與發布中斷的選單顯示發布按鈕。

#### Scenario: 重新發布失敗的選單
- **WHEN** 管理員發布一個 `status=error` 的選單，LINE 都成功
- **THEN** 回應 200，`status` 是 `published`

#### Scenario: 重新發布中斷的選單
- **WHEN** 選單的 `status` 是 `publishing`，最後更新是 6 分鐘前，管理員發布這個選單
- **THEN** 系統呼叫 LINE，回應 200，`status` 是 `published`

#### Scenario: 發布中的選單不能重新發布
- **WHEN** 選單的 `status` 是 `publishing`，最後更新是 1 分鐘前，管理員發布這個選單
- **THEN** 回應 409 `PUBLISH_IN_PROGRESS`，不呼叫 LINE

#### Scenario: 中斷的請求恢復後不改到新的認領
- **WHEN** 請求 A 認領選單後中斷超過 5 分鐘，請求 B 重新認領同一個選單；之後請求 A 恢復，寫入發布結果或把選單改成 `error`
- **THEN** 請求 A 的寫入不生效，選單仍是 B 認領的 `publishing`；B 寫入發布結果後，選單是 `published`，`lineRichMenuId` 是 B 建立的選單

#### Scenario: 列表頁與編輯頁顯示發布中斷
- **WHEN** 頁面載入一個 `publishing`、最後更新是 6 分鐘前的選單
- **THEN** 狀態顯示「發布中斷」，有發布按鈕

#### Scenario: 列表頁顯示發布中與發布失敗
- **WHEN** 列表頁載入一個 `publishing`、最後更新是 1 分鐘前的選單，與一個 `error` 的選單
- **THEN** 前者的狀態顯示「發布中」，沒有「發布」按鈕；後者顯示「發布」按鈕

### Requirement: 設預設失敗時保留原本的預設

發布 `isDefault = true` 的選單時，LINE 設預設的 API 失敗，系統 SHALL 仍完成發布，但 MUST 把這個選單的 `isDefault` 記成 `false`，MUST NOT 修改同渠道其他選單的 `isDefault`，並在回應的 `warnings` 帶 `DEFAULT_NOT_SET`。LINE 回錯誤時，LINE 上原本的預設選單 SHALL 不受影響。逾時或連線中斷時，LINE 可能已經設好預設，系統不保證資料庫與 LINE 一致，由對帳收斂。

#### Scenario: 設預設失敗
- **WHEN** 同渠道的選單 A 是預設；管理員發布 `isDefault = true` 的選單 B，LINE 建立與上傳成功，設預設失敗
- **THEN** 回應 200，選單 B 的 `status` 是 `published`、`isDefault` 是 `false`，`warnings` 含 `DEFAULT_NOT_SET`
- **THEN** 選單 A 的 `isDefault` 仍是 `true`，系統沒有呼叫 `DELETE /v2/bot/user/all/richmenu`

#### Scenario: 設預設成功
- **WHEN** 管理員發布 `isDefault = true` 的選單，LINE 設預設成功
- **THEN** 這個選單的 `isDefault` 是 `true`，同渠道其他已發布選單的 `isDefault` 是 `false`，回應沒有 `DEFAULT_NOT_SET`

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
