# 19 — CSAT 滿意度調查設計

> 本文件是滿意度問卷的設計依據（issue #339，2026-11-11 使用者決定）。`04_CASE_MANAGEMENT.md` 的 CSAT 段落已過時。
> 行為以主規格 `openspec/specs/csat-survey/`、`inbound-message-processing`（回覆的攔截）、`case-management`（狀態轉換）、
> `analytics-reports`（報表）為準；本文件說明整體流程與決定的理由。
> 程式：`apps/api/src/modules/csat/`、`packages/shared/src/constants/case-transitions.ts`、
> `packages/channel-plugins/src/line/builders.ts`。

## 流程總覽

```
工單標記已解決（RESOLVED）
  │
  ▼
等待 30 分鐘（常數 CSAT_SURVEY_DELAY_MINUTES，租戶不能調整，也不能關閉問卷）
  │
  ▼
渠道外掛有 buildCsatSurvey() 嗎？（目前只有 LINE）
  ├─ 沒有（Facebook、Instagram、網站聊天室）→ 不寄問卷，工單停在已解決，由客服手動結案
  │
  └─ 有 → 認領工單（寫入 csatSentAt）→ 寄出問卷
            │
            ├─ 客人點選分數 → 記錄分數（csatRatedBy = customer）→ 送感謝訊息
            │                → 1～2 分通知負責工單的成員 → 工單 CLOSED → 關閉對話
            │
            └─ 寄出 72 小時沒有回覆 → 工單自動 CLOSED（不計 CSAT）→ 關閉對話
```

## 什麼時候寄

- 排程每分鐘找狀態是 `RESOLVED`、`resolvedAt` 早於 30 分鐘、沒有 `csatSentAt`、沒有評分、有可寄問卷渠道的對話、
  租戶啟用中的工單，每期最多 10 張。
- 寄出前以條件更新認領（`csatSentAt` 仍是空值才寫入），job 重跑或兩期重疊時只寄一次。認領之後任何一步失敗都不還原、
  不自動重寄；送不出時問卷訊息標示「沒有送出」，工單時間軸寫一筆 `csat_send_failed`。

## 只對 LINE 寄問卷

只有客人能在渠道上直接點選分數，問卷才有意義。LINE 送 Flex 訊息，五個按鈕的 postback 是 `csat:<分數>:<工單 ID>`，
客人看到「我的評分：N 分」。其他渠道原本送純文字「回覆 csat:分數」，缺工單 ID，客人回覆不了（AUDIT CASE-02），
所以先不寄；要支援時，在該渠道的外掛實作 `buildCsatSurvey()`（例如 Facebook 的快速回覆），csat 模組不用改。

判斷依外掛能力，不在 csat 模組比對 `channelType`（`AGENTS.md` 結構規則 5）。

## 重新開啟與重新解決

狀態機保留兩條離開「完成」狀態的轉換：

| 轉換 | 什麼時候用 |
| --- | --- |
| `CLOSED → OPEN`（重新開啟） | 客人說問題沒有解決 |
| `RESOLVED → IN_PROGRESS`（改回處理中） | 客服誤按「標記解決」 |

工單再次轉成 `RESOLVED` 時（客服操作或自動化的 `update_case_status`），依 `caseTransitionCsatFields()`：

| 上一輪 | 這次解決之後 |
| --- | --- |
| 沒有評分（不論問卷寄過沒有、逾時結案過沒有） | 清除 `csatSentAt`、`csatRespondedAt`；30 分鐘後再寄一份；逾時以重新寄出的時間起算 |
| 已有評分（客人或客服代評） | 保留分數與問卷欄位，不再寄問卷，不逾時結案；停在已解決，由客服手動結案 |

修正前，上一輪問卷寄出超過 72 小時的工單重新解決後，逾時結案排程在一分鐘內就把它結案（AUDIT CASE-04）。

## 客人回覆後

| 分數 | 感謝訊息 | 其他 |
| --- | --- | --- |
| 1～2 | 「非常抱歉讓您感到不滿意，我們會立即安排主管為您跟進處理，請您稍候。」 | 站內通知負責工單的成員（見下） |
| 3 | 「感謝您的回饋！我們會持續改善服務品質……」 | — |
| 4～5 | 「非常感謝您的好評！……」 | — |

- 評分以條件更新認領（`csatScore` 仍是空值才寫入）：客人連點兩次只處理一次，感謝訊息、低分通知、`case.closed` 都只有一次。
- 客人只能替狀態是 `RESOLVED` 的工單評分（issue #520）。工單重開（`OPEN`、`IN_PROGRESS`）或已結案後，客人點舊的問卷卡片
  不記分、不送感謝訊息、不發低分通知、不改工單與對話，只寫 warn log；客人只看到自己點的「我的評分：N 分」。
  工單再次解決後會寄新的問卷（見上一節）。客服代評不受這條限制。
- 評分後工單改成 `CLOSED`，並關閉工單底下的對話，與逾時結案相同。
- 低分**只通知、不升級工單**，也不發 `csat.low_score` 事件。原設計的「自動化升級工單並通知主管」不做。
- 文字回饋（`csatComment`）欄位與 API 都有，但客人沒有填寫的途徑，這次不做。

### 低分通知誰

同租戶、啟用中、有效權限（角色權限 ∩ 方案天花板）含 `case.assign`、而且看得到工單渠道（持 `channel.view_all`，
或直綁、團隊授權該渠道）的成員。不看舊的角色列舉 `role`（AUDIT RBAC-03）。

選 `case.assign`（派工／改派給成員）是因為權限註冊表沒有「工單管理」碼，而低分後要做的是安排人跟進。
預設的「客服」角色也有 `case.assign`，所以預設設定下看得到該渠道的一般客服也會收到；租戶只想通知主管時，
在「角色與權限」頁從客服角色拿掉 `case.assign`。通知送不出時，工單時間軸寫一筆 `csat_low_score_notify_failed`。

## 客服代評

收件匣的問卷卡片在客人評分前可以由客服點星代評（`POST /api/v1/cases/:id/csat`）。保留這個功能，但標記來源：

- 工單的 `csatRatedBy` 寫入 `agent`（客人回覆是 `customer`）；問卷訊息的 `metadata.csatRatedBy`、時間軸的 `csat_rated`
  也標明來源。
- 工單詳情的滿意度區塊標示「客服代評」。
- 代評一樣會送感謝訊息、低分通知、結案並關閉對話。

## 報表

- CSAT 平均與好評率**只算客人自評**（`csatRatedBy` 不是 `agent`；2026-11-04 之前沒有來源紀錄的舊評分視為客人自評）。
- 報表總覽回傳 `csatAgentRatedCount`，CSAT 分數卡顯示「客服代評 N 筆（不計入平均）」。
- `GET /analytics/csat` 的回覆數、平均、滿意率、低分工單只算客人自評，另外回傳 `agentRatedCount`。
- 客服績效、我的績效的 CSAT 平均只算客人自評。

| 指標 | 算法 |
| --- | --- |
| CSAT 分數（總覽） | 期間內建立、客人自評工單的平均分 |
| 好評率 | 客人自評中 4～5 分的比例 |
| 回覆率（`/analytics/csat`） | 期間內寄出問卷的工單中，客人自評的比例 |
| 低分工單 | 客人自評 1～2 分的工單 |

## 資料欄位

```prisma
csatScore       Int?       // 1～5，null = 沒有評分
csatComment     String?    // 文字回饋（客人目前沒有填寫途徑）
csatRespondedAt DateTime?  // 評分時間
csatSentAt      DateTime?  // 這一輪問卷的寄出時間；重新解決且沒評分時清除
csatRatedBy     String?    // customer | agent；舊資料可能是 null
```

## 不做的事（2026-11-11 決定）

- 租戶設定延遲、關閉問卷、設定低分門檻。
- 非 LINE 渠道的問卷（等需要時再做快速回覆按鈕）。
- 低分自動升級工單、`csat.low_score` 事件。
