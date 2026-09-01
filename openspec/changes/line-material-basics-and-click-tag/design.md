## Context

程式碼實查現況（附行號）：
- **ShortLink** 有 `tagOnClick`、ClickLog 記 `contactId`（`schema.prisma:1475-1526`）。`trackClick` 依 tagOnClick 直接貼 contactTag（`shortlink.service.ts:337-346`），並發 `link.clicked` 到 eventBus（`shortlink.service.ts:348-359`）。
- **automation-engine** 事件清單 18 種，**無 `link.clicked`**（`packages/automation/src/contracts/events.ts`）；合約驗證會擋非清單事件（`composer.ts:44`、`validation.ts:132`）。規則引擎本身有 `add_tag` action（`action-executor.ts:123`），但那是 **API 端 in-process 執行器**。
- **worker 端動作執行器**（`apps/workers/src/lib/automation-actions.ts`）只支援 assign_agent/update_case_status/escalate_case/notify/notify_supervisor/send_message/send_material，**無 add_tag**。
- automation worker 已訂閱 link.clicked（`automation.worker.ts:542`），但因事件沒註冊、且 worker 無 add_tag，整條斷。

關鍵矛盾：**規則若跑在 API in-process 執行器有 add_tag，但跑到 worker 佇列就沒有** —— 需確認 automation 動作實際在哪執行，補齊缺的那端。

## Goals / Non-Goals

**Goals:**
- `link.clicked` 成為合法 automation 觸發事件，UI 可選、合約驗證放行。
- worker 端支援 `add_tag` 動作。
- 端到端打通：點短連結 → link.clicked → 規則 → add_tag 貼標，且可用「哪一條短連結」當條件。
- 收邊 line_imagemap postback / line_video endCard。

**Non-Goals:**
- 行為型 Segment 條件（點過某連結）——本 change 仍走「先貼標、再用 tag 分眾」。
- 素材級點擊歸因（第 5 塊）、Rich Menu 分眾（第 3 塊）、行為分眾直查。
- 不移除既有 tagOnClick「直接路徑」（兩條並存）。

## Decisions

### D1. link.clicked 事件定義
- `events.ts` 加 `LINK_CLICKED: 'link.clicked'`，定義 `{ name, label:'短連結被點擊', category:'engagement'（新類別或歸 message）, provides: ['tenant','contact'] }`。
- provides 含 `contact`：點擊已能解析 contactId（lineUid→ChannelIdentity），故規則可對聯絡人動作。未解析出 contactId 的匿名點擊 → 規則的 contact-scope 動作跳過（不報錯）。

### D2. facts 帶 shortLinkId / slug
- `automation-facts.ts` 對 link.clicked 事件補 facts：`shortLinkId`、`slug`、`tagOnClick`（供規則條件「若點的是 slug=xxx 的連結」）。
- payload 來源：shortlink.service.ts 發事件時已知這些值，確認 eventBus payload 帶齊。

### D3. worker add_tag 動作
- `automation-actions.ts` 加分支 `action.type === 'add_tag'`：讀 `action.config.tagId` 或 `tagName`，對 `context.contactId` upsert contactTag。
- **冪等**：已有該 tag 不重複插入（用 unique 或 findFirst 判斷）。
- **缺 contactId 時**：log skip、不報錯（比照現有 caseId 缺失的 skip 模式，`automation-actions.ts:93`）。
- **RLS**：透過 worker 的租戶綁定連線寫入（比照 send_material），不繞過。

### D4. 兩條路徑並存，不互斥
- 「直接路徑」（tagOnClick 硬綁一個 tag）保留 —— 簡單場景免設規則。
- 「正規路徑」（link.clicked 規則）是進階 —— 可對點擊做多動作（貼標+通知+發訊）、可依 slug 分流。
- 兩者可能對同一點擊都貼標 → add_tag 冪等確保不重複。

### D5. material 收邊（第 1 塊）
- **line_imagemap postback**：目前 imagemap action 遇 postback 降級成 message（`builders.ts:262`）。LINE imagemap 官方 action 只支援 uri/message/clipboard（無 postback），故**降級是正確的**——本 change 只需在 UI 明確標示「imagemap 不支援 postback」而非默默降級。
- **line_video endCard**：目前用 imagemap+video 兩則包裝（`builders.ts:284`）。LINE 原生 video 訊息本就不含 CTA 按鈕，endCard 是加值——保留權宜作法，補註解說明，不改行為。

## Risks / Trade-offs

- **動作執行位置**：需先確認 automation 規則的 add_tag 到底跑 API in-process 還是 worker。若兩處都可能跑，兩處都要有 add_tag（API 已有、worker 待補）。實作前先 trace 一條規則的實際執行路徑。
- **重複貼標**：直接路徑 + 正規路徑可能雙貼 → 靠 add_tag 冪等。
- **匿名點擊**：無 contactId 的點擊觸發規則時，contact-scope 動作要安全跳過，不可讓整條規則報錯。
- **事件量**：熱門短連結點擊多 → link.clicked 事件量大，規則引擎要能承載（沿用既有佇列，非新增負載模式）。
- **imagemap postback**：確認「降級是對的」——若之後要支援點擊回傳，imagemap 天生不行，得改用其他訊息型別，非本 change 範圍。
