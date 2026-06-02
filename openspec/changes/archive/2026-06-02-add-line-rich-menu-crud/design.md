## Context

LINE Rich Menu 是 OA 聊天視窗底部的固定常駐選單，**不是訊息**（與本專案已有的 Imagemap Material 容易混淆，後者是「對話中發送的單則互動圖片」）。

LINE 官方提供 **10 種固定版型**（大選單 6 種：2500×1686 或 1200×810，小選單 4 種：2500×843 或 1200×405），每個版型內含預定義的區域劃分（最多 6 個 area）。每個區域可綁定一個 action（postback / message / uri / datetimepicker / richmenuswitch）。

實際 publish 到 LINE 是多步流程：
1. `POST /v2/bot/richmenu` 建立 richmenu 拿 `richMenuId`
2. `POST /v2/bot/richmenu/{id}/content` 上傳圖檔
3. `POST /v2/bot/user/all/richmenu/{id}` 設為 default
4. （unpublish）`DELETE /v2/bot/user/all/richmenu` + `DELETE /v2/bot/richmenu/{id}`

**本次 (Daniel) 範圍**：CRUD + 預覽，DB 寫到 `rich_menus` 表，狀態固定 `draft`，**不打 LINE API**。
**未來 (Louis) 範圍**：publish / unpublish 流程，會擴 status 到 `published` / `error`，並寫入 `lineRichMenuId` 與 `publishedAt`。

## Goals / Non-Goals

**Goals:**
- 使用者能在 CRM 內快速建立 Rich Menu 草稿，不需在 LINE 後台操作
- 預覽與 LINE 實際渲染高度貼近（背景圖 + 區域熱區疊層）
- 10 種官方版型涵蓋絕大多數常見配置，避免使用者面對拖拉編輯器的學習成本
- 多 LINE OA tenant 場景：Tab 列上方放 OA 切換器，所有列表 / 編輯 / 預覽都以選中的 channel 為上下文
- 預留欄位與狀態 enum，Louis 可無縫接 publish 流程而不需改 schema

**Non-Goals:**
- ❌ 與 LINE Messaging API 互動（Louis 後續做）
- ❌ 自訂拖拉建立區域（10 種版型不夠時，使用者改用 LINE 官方後台）
- ❌ 分群投放（指派特定 user 用特定 richmenu）— LINE API 支援，但本期不做 UI
- ❌ 排程切換（時段自動切換 Rich Menu）— 第二期
- ❌ Quick Reply / 歡迎訊息 / 加好友自動回應 — 屬於「LINE 管理」模組下的未來功能
- ❌ FB Messenger 的 Persistent Menu — 屬於未來「FB 管理」模組

## Decisions

### D1. 模組位置：獨立頂層「LINE 管理」

候選：
- (A) 設定 > Rich Menu
- (B) 渠道詳情 tab
- (C) 行銷 tab 內
- **(D) 獨立頂層「LINE 管理」**（採用）
- (E) 對話內彈窗

選 D 的理由：
- Rich Menu 是 LINE OA 永久 UI 不是行銷活動，與 Material（行銷素材）語意混淆 → 排除 C
- 多 LINE OA 場景下，OA 切換器需要常駐，作為頂層導航比放在子頁更直覺 → 排除 B
- LINE 模組會繼續長大（Quick Reply / 歡迎訊息 / 加好友自動回應），預先開頂層比之後再搬移容易 → 排除 A
- 與 aitago / Crescendo Lab 等成熟 LINE OA 工具的擺法一致

### D2. 路由結構：`/dashboard/line/rich-menus`

不用平面的 `/dashboard/line`，保留 `rich-menus` 子路徑，為未來 `/dashboard/line/quick-replies`、`/welcome-messages`、`/follow-actions` 留結構。

### D3. 版型：10 種固定，不做自訂拖拉

候選：(A) 10 種固定 / (B) 自訂拖拉（cropperjs） / (C) 兩者並存

選 (A)：
- LINE 官方範本已涵蓋 95% 常見配置
- 自訂拖拉需要 cropperjs 整合 + 區域吸附 + 重疊偵測 + 嚴格座標校驗，POC 不值得
- 之後若使用者強烈要求，可加 (C) 一個「自訂」版型 → 進入 cropperjs 流程，但不在本期

### D4. OA 切換器位置：Tab 列上方

```
┌──────────────────────────────────────────────────────┐
│ Topbar: LINE 管理                                    │
├──────────────────────────────────────────────────────┤
│ 選擇官方帳號: [官方帳號 A ▼]                        │
│ ─────────────────────────────────────────────────── │
│ [Rich Menu]  Quick Reply  歡迎訊息  加好友自動回應  │
│ ─────────                                            │
│  (Rich Menu 列表)                                    │
└──────────────────────────────────────────────────────┘
```

切換 OA 時所有子功能 reset 到該 OA 的資料。OA 列表 = `channels.findMany({ tenantId, channelType: 'LINE', isActive: true })`。

### D5. 狀態 enum：`draft` / `published` / `error`

本期只用 `draft`，但 enum 全列。Louis 接 publish 後：
- 草稿建立 → `draft`
- 觸發 publish → `draft` → `published`（成功）或 `error`（失敗）
- 取消 publish → `published` → `draft`

選 string 而非 Prisma enum：與 codebase 既有慣例（Broadcast.status 是 string）一致，避免 enum migration 麻煩。

### D6. 預留 Louis 欄位但本期不寫入

```prisma
lineRichMenuId  String?    // Louis publish 後寫入
publishedAt     DateTime?  // Louis publish 後寫入
status          String     @default("draft")
```

本期 service 層只允許 `status: 'draft'` 的 record 被 update / delete，避免 Daniel 與 Louis 同時開發時動到對方資料。Louis 接手時改該守衛即可。

### D7. 區域 action 結構：與 LINE API 對齊

直接用 LINE 官方 JSON 結構儲存：

```json
{
  "bounds": { "x": 0, "y": 0, "width": 1250, "height": 843 },
  "action": {
    "type": "postback",
    "data": "menu=main",
    "label": "主選單",
    "displayText": "您點了主選單"
  }
}
```

5 種 action：
- `postback`：data + (label) + (displayText)
- `message`：text + (label)
- `uri`：uri + (label) + (altUri.desktop)
- `datetimepicker`：data + mode + (initial/min/max)
- `richmenuswitch`：richMenuAliasId + data — 提示「目標 Rich Menu 需先 publish 並設 alias」（本期不擋，Louis 端會驗證）

### D8. 圖片驗證

- 上傳到 MinIO 後驗證尺寸：必須等於版型定義的 `{ width, height }`
- 驗證失敗回 400，提示「需 1250×843 或 2500×1686」等具體尺寸
- 檔案大小限制 1MB（LINE 官方上限）
- 格式：JPEG / PNG

### D9. 複製功能

列表卡片有「複製」選單項，POST `/:id/duplicate`：建一份新 record，name 加 `（副本）`，狀態固定 `draft`。LINE 官方後台沒這功能但對 CRM 用戶有用（A/B 測試版本）。

### D10. 「LINE 管理」導航項目命名

中文使用「**LINE 管理**」（與 zh-TW 慣例一致），不用「LINE OA」「LINE 後台」等技術味重的詞。Icon 用 `MessageSquare`（lucide）或 LINE 品牌色 SVG（先用 lucide，省事；要做品牌化再換）。

## Risks / Trade-offs

[**風險：Daniel 寫的草稿被 Louis 的 publish 流程意外覆蓋**] → D6 約定 service 層守衛 + status enum 切分職責；兩人接 review 時確認介面

[**風險：Material 系統的 Imagemap 與 Rich Menu 概念混淆**] → UI 標題明確區隔「LINE 圖文訊息（單則發送）」vs「LINE Rich Menu（底部選單）」；左側導航分置兩個模組（行銷 vs LINE 管理）

[**風險：10 種版型不夠用，使用者卡住**] → 列表頁加說明「若需自訂版型，請至 LINE 官方後台設定後再同步」；之後若呼聲高再加自訂拖拉

[**風險：背景圖驗證不夠嚴格，Louis publish 時被 LINE API 退**] → D8 在 CRUD 階段就驗證尺寸 / 大小 / 格式，避免問題往後推

[**風險：多 OA 切換時資料殘留**] → 列表頁 useEffect 監聽 channelId 變化清空當前資料；URL 帶 `?channelId=xxx`（可分享連結 + refresh 後保持）

## Migration Plan

1. 新增 Prisma migration：`rich_menus` 表
2. Migration 套用後重啟 API（pickup 新 model）
3. 前端部署：路由 + 導航項目 + 元件
4. 無 seed 資料（草稿由使用者建立，不需要預設範本）
5. 回滾：drop 新表 + revert migration + 移除前端路由（純新增功能，不影響現有資料）

## Open Questions

無 — 所有決策已拍板，可直接進 spec 與 tasks。
