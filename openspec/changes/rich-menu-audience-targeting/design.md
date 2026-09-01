## Context

程式碼實查（附行號）：
- `RichMenu`（`schema.prisma:1269-1298`）：status draft/published/error、lineRichMenuId、selected（全體 default）。
- **publish 已完整**：`publishRichMenu`（`rich-menu.service.ts:405`）建 LINE richmenu + 上傳圖 + selected 時設全體 default（`POST /v2/bot/user/all/richmenu/{id}`, line 476）；`unpublishRichMenu`（:502）。schema 註解「本期僅 draft」過時。
- **channel-plugin link 能力齊**（`line/index.ts`）：`linkMenuToUser`(:429 單人)、`linkMenuToUsers`(:437 bulk，自動每 500 分批)、`unlinkMenuFromUsers`(:447)、`getUserMenu`(:455)。
- **受眾解析**：`calculateSegmentContacts`（`segment.service.ts:111`）回 contactIds，支援 tag/channelType/日期規則。contact 的 LINE uid 在 ChannelIdentity（where channelType='LINE'）。

缺口：**沒有把「已發布 menu」綁到「受眾」的業務邏輯**——零件全在，只差組裝 + 背景批次。

## Goals / Non-Goals

**Goals:**
- 已發布 Rich Menu 可綁定到 Segment 或標籤受眾（不同受眾看不同 menu）。
- 綁定走背景佇列（受眾大 + LINE rate limit）。
- 可解除綁定（回全體 default）。
- 前端對已發布 menu 提供綁定 UI。

**Non-Goals:**
- 換頁（richmenuswitch）——已支援於 areas action。
- 新好友自動依標籤綁（automation trigger 驅動）——後續接 automation。
- 每個使用者綁定狀態的完整追蹤表（本 change 綁定為 fire-and-forget 批次；狀態查詢用 LINE getUserMenu 即時查，不建映射表）。

## Decisions

### D1. 受眾 → LINE uid 解析
- 支援兩種受眾來源：`segmentId`（走 calculateSegmentContacts）或 `tagId`（直接篩 contactTag）→ 得 contactIds。
- contactIds → ChannelIdentity（where channelType='LINE', contactId in [...]）取 uid，去重。
- 該租戶該 channel 才算（rich menu 綁在特定 channel，uid 要是同 channel 的 LINE 身分）。

### D2. 綁定走背景佇列（不阻塞 API）
- API 端 `bindRichMenuToAudience` 解析出 uid 清單後，入 `rich-menu-bind` job（payload: tenantId、channelId、lineRichMenuId、uids），立即回 { queued: N }。
- worker 消化 job → 取 channel 憑證 → plugin.linkMenuToUsers（已自動每 500 分批 + LINE bulk API）。
- **為何背景**：受眾可能上千，bulk link 每批 500 且有 rate limit，同步跑會逾時/撞限。

### D3. 只對 published menu 開放
- bind 前檢查 menu.status==='published' 且有 lineRichMenuId；draft/error 擋（回明確錯誤「請先發布」）。

### D4. 綁定狀態不建映射表（MVP）
- 不建「哪個 uid 綁哪個 menu」的 DB 映射（LINE 端已是 source of truth）。查單一使用者現綁的 menu 用 plugin.getUserMenu 即時查。
- 未來若要「受眾綁定歷史/統計」再加表，本 change 先不做（避免與 LINE 端不同步的維護負擔）。

### D5. 全體 default 與分眾綁定並存
- LINE 規則：per-user 綁定優先於 all-default。所以「全體看 A menu、VIP 看 B menu」= publish A 設 default + bind B 給 VIP 受眾。兩者不衝突。

## Risks / Trade-offs

- **背景批次失敗處理**：bulk link 中途失敗（rate limit/token 過期）→ job 重試（BullMQ 既有重試）；部分成功部分失敗難原子回滾（LINE 無交易），靠重試冪等（重綁同 menu 無害）。
- **uid 時效**：解析當下的受眾 uid，之後受眾變動不會自動重綁（本 change 是一次性綁定，非動態）。動態綁定（新符合條件的人自動綁）需 automation，範圍外。
- **無映射表的代價**：無法「列出這個 menu 綁了哪些人」——只能逐一 getUserMenu 查。MVP 接受，UI 只顯示「已送出綁定 N 人」。
- **RLS**：受眾 contacts 解析走租戶連線；worker 綁定用 channel 憑證（channel 屬本租戶）。確認 job 帶 tenantId 供 worker 驗證。
- **rate limit**：LINE bulk link 有速率限制，plugin 已分批但未加 sleep；大量時可能撞限 → 靠 job 重試。若常撞可後續加批間延遲。
