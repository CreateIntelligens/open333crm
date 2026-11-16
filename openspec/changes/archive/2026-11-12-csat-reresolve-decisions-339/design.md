## Context

issue #339 的 8 項決定見 proposal。程式現況：

- `caseTransitionTimestamps()`（`@open333crm/shared`，#417）只算 `resolvedAt`／`closedAt`；API 的 `transitionCase()` 與
  workers 的 `update_case_status` 都用它。問卷欄位沒有人維護。
- `csat.scheduler.ts` 兩個排程：`csat-send`（`RESOLVED`、`csatSentAt` 空、`resolvedAt` 早於延遲）與
  `csat-auto-close`（`csatSentAt` 早於 72 小時、`csatRespondedAt` 空）。每期各取 10 張，依時間排序。
- `sendCsatSurvey()` 以 `channelType === 'LINE'` 分支：LINE 送 Flex，其他渠道送文字。
- `recordCsatScore()` 先讀再只用 id 更新；低分通知查 `role: 'SUPERVISOR'`；評分後結案不關對話。

## Goals / Non-Goals

**Goals**：重新解決的工單不再被立即結案；問卷欄位的規則只有一份；評分只處理一次；低分通知依權限與渠道可見範圍；
非 LINE 不寄問卷且不違反結構規則 5；報表分開客人自評與客服代評。

**Non-Goals**：租戶設定延遲或關閉問卷、文字回饋、非 LINE 的快速回覆問卷、把 `recordCsatScore()` 整個改寫成 flow。

## Decisions

### D1 問卷欄位放在 shared 的 `caseTransitionCsatFields()`

和 #417 相同：一個純函式算「轉成 X 時要寫的問卷欄位」，API 與 workers 都展開到更新資料。轉成 `RESOLVED`
（且原本不是 `RESOLVED`）而 `csatScore` 是空值時回傳 `{ csatSentAt: null, csatRespondedAt: null }`，其他情況回傳 `{}`。
不併進 `caseTransitionTimestamps()`：那個函式的呼叫端還有升級、指派、評分結案、逾時結案，它們不需要讀 `csatScore`。

清掉 `csatSentAt` 之後，「逾時從這次解決起算」自然成立：逾時結案排程看的是重新寄出的 `csatSentAt`。

已評分的工單：保留 `csatSentAt`／`csatRespondedAt`。逾時結案要求 `csatRespondedAt` 空值，所以不會結案；寄送排程與
`sendCsatSurvey()` 的認領多加 `csatScore: null`，涵蓋「客服代評時還沒寄過問卷」（`csatSentAt` 本來就是空值）的工單。

### D2 非 LINE 判斷接渠道外掛：`buildCsatSurvey()`

`ChannelPlugin` 加選用方法 `buildCsatSurvey({ question, options })`，回傳 `OutboundPayload`。LINE 外掛實作（Flex 移到
`packages/channel-plugins/src/line/builders.ts`），其他外掛不實作。選方法而不是布林旗標：問卷的版型本來就是渠道差異，
放進外掛後 csat 模組沒有任何 `channelType` 分支，日後 FB 要做快速回覆問卷只要在 FB 外掛實作這個方法。

- `csatSurveyChannelTypes()`（csat.service）從 `getAllChannelPlugins()` 算出支援的渠道類型。排程查詢加
  `conversations: { some: { channelType: { in } } }`，不支援的工單不進候選，也就不會每期佔住 10 個名額。
- `sendCsatSurvey()` 只取支援渠道的對話；沒有就不認領、回傳 false。
- workers 的 `createWorkerPluginRegistry()` 用同一個 `linePlugin` 物件，不需要另外註冊；以單元測試鎖住。

不寄問卷的工單停在 `RESOLVED`：`csatSentAt` 一直是空值，逾時結案排程不會選到。客服手動結案。

### D3 評分以條件更新認領

`recordCsatScore()` 先照舊以 `tenantId`（與 `contactId`）讀工單，再
`updateMany({ where: { id, tenantId, csatScore: null, contactId? }, data })`；`count` 是 0 就回傳 false，不做後續任何事。
同時寫入 `csatRatedBy`。與 PR #335 的寄送認領同一種作法；`claimOne()` 是 `$executeRaw` 的 `UPDATE ... WHERE`，
這裡 Prisma 的 `updateMany` 已能表達條件，沿用 `sendCsatSurvey()` 的寫法。

### D4 低分收件人：`case.assign` ＋ 渠道可見範圍

`notification.service.ts` 新增 `resolveCaseManagerRecipients(ctx, channelId)`：

1. 讀租戶的 `planId`，以 `permission.service.ts` 新抽出的 `loadPlanCeiling()` 算方案天花板（與
   `getEffectiveTenantPermissions()` 共用，不讀 Redis：進站管線沒有 Redis，交易內也不用 Redis）。
2. 讀租戶所有角色的權限碼，`resolveImplied()` 後與天花板取交集。
3. 角色有效權限含 `case.assign` 的啟用中成員；每人以 `getAccessibleChannelIds()` 判斷看不看得到工單渠道
   （`channel.view_all` 也取自同一份有效權限）。

**為什麼選 `case.assign`**：權限註冊表沒有「工單管理」這個碼；`case.*` 之中，`case.assign`（派工／改派給成員）最接近
「安排人跟進」，低分後的感謝訊息也告訴客人「會安排主管跟進」。注意：預設的「客服」角色也有 `case.assign`，
所以預設設定下，看得到該渠道的一般客服也會收到低分通知；租戶要只通知主管，從客服角色拿掉 `case.assign` 即可。
不新增權限碼：新碼要跑 reconcile 腳本才會到既有租戶（PERMISSIONS.md），使用者也沒有要求新碼。

通知失敗（例如資料庫錯誤）寫工單時間軸 `csat_low_score_notify_failed`，不可只寫 log。

### D5 評分後關閉對話

結案後呼叫 `closeConversationsForCase(prisma, io, caseId, tenantId, { source: 'csat', reason: ... })`，與逾時結案相同。
失敗時記 log 且工單仍是 `CLOSED`（與逾時結案現況一致）。

### D6 `csatRatedBy` 欄位與回填

`cases.csatRatedBy TEXT NULL`。migration 以每張工單最後一筆 `csat_rated` 事件的 `payload.source` 回填（#444 起才有這個事件）；
沒有事件的舊評分維持空值，報表視為客人自評（修正前也是這樣算）。`cases` 與 `case_events` 是 FORCE RLS，
回填段落前加 `-- @guard`（比照 `20261005120000`），不能略過 RLS 的身分執行時讓 migration 失敗，而不是「成功」但沒回填。

報表條件一律寫成 `"csatRatedBy" IS DISTINCT FROM 'agent'`（SQL）／`NOT: { csatRatedBy: 'agent' }` 不可用（Prisma 的
`not` 會排除 NULL），改用 `OR: [{ csatRatedBy: null }, { csatRatedBy: 'customer' }]` 或在 JS 篩。

## Risks / Trade-offs

- 預設客服角色會收到低分通知（D4）。部署後在 UAT 確認通知量是否可接受；要收斂時調角色，不必改程式。
- 已重開（`IN_PROGRESS`）的工單上，客人點上一輪問卷的按鈕仍會記錄分數並結案（不在本次範圍，proposal 已列）。
- 部署當下已在 `RESOLVED`、`csatSentAt` 空值的非 LINE 工單，部署後不再寄問卷，會停在已解決，需要客服手動結案。
