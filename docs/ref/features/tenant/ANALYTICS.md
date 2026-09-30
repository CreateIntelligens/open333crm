# 報表

報表彙整一段期間內的訊息量、工單處理、客服績效、渠道分布、聯絡人成長與滿意度。管理者看「總覽」，每個客服可以在「我的績效」看自己的數字。

- **資料來源**：`apps/api/src/modules/analytics/*`、`apps/api/src/modules/cli/cli.routes.ts`、`apps/api/src/guards/rbac.guard.ts`
- **核對日期**：2026-09-30

## 負責的程式

| 程式 | 負責什麼 |
| --- | --- |
| `analytics.routes.ts` | 報表路由與權限 |
| `analytics.service.ts` | 每個報表的查詢。全部在查詢當下從原始資料表計算 |
| `analytics.scheduler.ts`、`analytics.aggregator.ts` | 每天把前一天的彙總寫入 `DailyStat`。沒有任何報表讀這張表，見 `../../system/AUDIT.md` 的 DB-03 |

CLI 的 `/api/v1/cli/analytics/*` 呼叫同一組服務函式，但走 CLI 的 scope 授權，見 `../../system/AUDIT.md` 的 RBAC-02。

## 有哪些報表

| 端點 | 內容 |
| --- | --- |
| `GET /analytics/overview` | 未結工單、新工單、已解決工單、SLA 達成率、平均首次回應與平均解決時間、CSAT 平均與好評率 |
| `GET /analytics/message-trend` | 訊息量趨勢，可以依日、週、月分組 |
| `GET /analytics/cases` | 工單趨勢、狀態、優先級與分類分布、SLA 逾時數、升級率 |
| `GET /analytics/agents` | 每個客服的處理量、平均首次回應與解決時間、CSAT、SLA 達成率。可以用 `agentId` 只看一人 |
| `GET /analytics/channels` | 各渠道類型的訊息量、對話量與新聯絡人數，以及機器人與真人處理的比例 |
| `GET /analytics/contacts` | 新聯絡人趨勢、活躍聯絡人數、最常用的標籤 |
| `GET /analytics/csat` | CSAT 的分數分布 |
| `GET /analytics/my` | 自己本月的績效，以及手上待處理與快到期的工單 |
| `POST /analytics/export` | 匯出 CSV，可選總覽、工單、客服或渠道 |

期間以 `from` 與 `to` 指定，預設最近 30 天。「我的績效」固定看本月。

## 數字怎麼算

**即時計算。** 每次查詢都直接統計 `cases`、`messages`、`conversations`、`contacts` 等資料表，沒有快取，也不讀 `DailyStat`。資料量大時，報表的查詢時間會跟著增加。

**SLA 達成率**是已解決、而且 `resolvedAt` 不晚於 `slaDueAt` 的工單比例。沒有 SLA 期限的工單不計入。

**平均首次回應時間永遠是空值。** 計算用的 `Case.firstResponseAt` 沒有任何程式寫入，見 `../../system/AUDIT.md` 的 SLA-01。

**CSAT 好評率**是 4 分與 5 分佔全部評分的比例。

**日期以 UTC 切分。** 依日、週、月分組用的是資料庫的 `date_trunc()`，而時間欄位存的是不帶時區的 UTC 時間。台灣時間凌晨 0 點到 8 點的資料會被算到前一天。見 `../../system/AUDIT.md` 的 ANA-01。

**不套用渠道可見範圍。** 報表統計的是全租戶，不依成員可見的渠道過濾。

## 權限

整個模組先要求 `analytics.view` 或 `analytics.view.self` 其中一個，之後各路由再檢查：

| 路由 | 權限 |
| --- | --- |
| `GET /analytics/my` | 通過模組門檻即可，也就是只有 `analytics.view.self` 也能看 |
| 其他報表 | `analytics.view` |
| `POST /analytics/export` | `analytics.export` |

側欄的「報表」要求 `analytics.view` 才顯示，而「我的績效」在它底下。因此只有 `analytics.view.self` 的客服在側欄找不到「我的績效」，只能直接輸入網址。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **平均首次回應時間永遠是空值** | 詳見 `../../system/AUDIT.md` 的 SLA-01 |
| 日期以 UTC 切分 | 詳見 `../../system/AUDIT.md` 的 ANA-01 |
| 每天寫入的彙總沒有被使用 | 詳見 `../../system/AUDIT.md` 的 DB-03 |
| 只有 `analytics.view.self` 的客服找不到入口 | 側欄的父選單要求 `analytics.view` |
| CLI 報表不受角色權限限制 | 詳見 `../../system/AUDIT.md` 的 RBAC-02 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
