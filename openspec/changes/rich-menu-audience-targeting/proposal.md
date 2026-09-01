## Why

「不同標籤/受眾的人看到不同 Rich Menu」是台灣 LINE 平台的入場券（Omnichat/MAAC/Super8 三家全做）。現況盤點發現 open333CRM 的零件其實都在——publish 流程完整（`publishRichMenu` 已能建 LINE richmenu、設全體 default）、channel-plugin 也有 per-user link 與 bulk link/unlink（`linkMenuToUsers` 自動分批每 500）——**唯一缺的是「把 Rich Menu 綁到分眾」這條業務邏輯**：選一個已發布 menu + 選受眾（segment/tag）→ 解析出該群的 LINE uid → 呼叫 bulk link 綁定。（schema 註解「本期僅允許 draft」已過時，service 早已超前實作 publish。）

## What Changes

- **Rich Menu 分眾綁定**：對「已發布」的 Rich Menu，可指定一個受眾（Segment 或標籤），系統解析出該受眾中有 LINE 身分的聯絡人 uid，透過 LINE bulk link API 把該 menu 綁給這些使用者（不同受眾看不同 menu）。
- **解除分眾綁定**：可對一群 uid 解除綁定（回到全體 default menu）。
- **綁定為背景批次**：受眾可能很多（bulk link 每次 500、有 rate limit），綁定走佇列背景執行，不阻塞 API。
- **前端**：Rich Menu 詳情/列表對已發布 menu 提供「綁定受眾」操作（選 segment/tag → 綁定），顯示綁定狀態。

不在本 change 範圍：Rich Menu 換頁（richmenuswitch，已支援於 areas action）；per-user 即時綁定（新好友加入自動依標籤綁——那是自動化 trigger，可後續接 automation）；publish 流程（已完整）。

## Capabilities

### New Capabilities
（無全新 capability；為既有 Rich Menu 能力延伸）

### Modified Capabilities
- `line-rich-menu`: 新增「分眾綁定」——已發布 Rich Menu 可綁定到 Segment/標籤受眾（經 LINE bulk link），不同受眾看不同 menu；含解除綁定與背景批次執行。

## Impact

- **API (`apps/api/src/modules/line/rich-menu.service.ts`)**：
  - 新增 `bindRichMenuToAudience(menuId, { segmentId | tagId })`：解析受眾 contacts → LINE uid → 入佇列 bulk link。
  - 新增 `unbindRichMenuFromAudience`：對 uid 群解除綁定。
  - 受眾→uid 解析：contactIds（segment.service calculateSegmentContacts / tag 篩選）→ ChannelIdentity where channelType=LINE 取 uid。
- **route (`rich-menu.routes.ts`)**：`POST /rich-menus/:id/bind-audience`、`POST /rich-menus/:id/unbind-audience`。
- **worker（背景批次）**：新增 rich-menu-bind job（呼叫 plugin.linkMenuToUsers，已自動分批 500）；避免 API 同步跑大量 LINE API 撞 rate limit。
- **channel-plugin**：`linkMenuToUsers` / `unlinkMenuFromUsers` 已存在（`line/index.ts:437,447`），不用改。
- **前端 (`apps/web`)**：Rich Menu 詳情對已發布 menu 加「綁定受眾」UI（選 segment/tag）。
- **相容性**：只對 status=published 的 menu 開放綁定；draft menu 不行（需先 publish）。全體 default（publishRichMenu 的 selected）與分眾綁定並存：LINE 規則是 per-user 綁定優先於 all-default。
- **RLS**：受眾解析與綁定走租戶連線；只綁本租戶 channel 的 menu 與本租戶 contacts。
