## ADDED Requirements

### Requirement: Rich Menu 草稿模型

系統 SHALL 提供 `RichMenu` 資料模型，儲存使用者建立的 Rich Menu 草稿。每筆 record MUST 綁定到一個 LINE 渠道（`channelId` 對應 `channels.id` 且 `channels.channelType = 'LINE'`），並隸屬於該 tenant。

Record MUST 包含：
- `id` (UUID)
- `tenantId` (UUID)
- `channelId` (UUID，外鍵到 channels 表)
- `name` (string，CRM 內部名稱)
- `chatBarText` (string，使用者在 LINE 聊天列底部看到的按鈕文字，最多 14 字)
- `size` (JSON，`{ width, height }`，必為 10 種版型其中之一的官方尺寸)
- `selected` (boolean，是否預設展開選單)
- `areas` (JSON 陣列，每筆 `{ bounds: { x, y, width, height }, action: { type, ... } }`)
- `imageUrl` (string，MinIO 公開 URL)
- `status` (string，預設 `draft`，本期僅允許 `draft`)
- `lineRichMenuId` (string?，LINE 端 ID，本期不寫入，留給後續 publish 流程)
- `publishedAt` (DateTime?，本期不寫入)
- `createdAt` / `updatedAt`

#### Scenario: 建立草稿成功

- **WHEN** 使用者 POST `/api/v1/line/rich-menus` 並提供有效的 channelId、版型 size、areas、imageUrl
- **THEN** 系統建立一筆 status=`draft` 的 RichMenu record，回傳 201 與完整 record

#### Scenario: 拒絕非 LINE 渠道

- **WHEN** 使用者建立 Rich Menu 時 channelId 對應的 channel `channelType` 不是 `'LINE'`
- **THEN** 系統回應 400，錯誤碼 `INVALID_CHANNEL_TYPE`，訊息「Rich Menu 僅支援 LINE 渠道」

#### Scenario: 拒絕跨 tenant 渠道

- **WHEN** 使用者建立 Rich Menu 時 channelId 屬於其他 tenant
- **THEN** 系統回應 404，錯誤碼 `NOT_FOUND`（避免洩露 channel 存在性）

---

### Requirement: 10 種固定版型

系統 SHALL 提供 LINE 官方 10 種固定版型供使用者選擇，不接受任意 size / areas 組合。

版型清單：
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

每個版型 MUST 包含預定義的 `defaultAreas`（座標已對齊像素），使用者只能調整 action 不能改 bounds。

#### Scenario: 用版型 ID 建立 Rich Menu

- **WHEN** 使用者選擇 `layoutId = 'large-1'`
- **THEN** 前端載入該版型的 `size` 與 `defaultAreas`，使用者填入每個 area 的 action 後送出

#### Scenario: 拒絕不在白名單的 size

- **WHEN** 使用者繞過前端直接 POST 一筆 size = `{ width: 1000, height: 500 }` 的 record
- **THEN** 系統回應 400，錯誤碼 `INVALID_LAYOUT`，訊息列出合法尺寸

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
