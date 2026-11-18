# Figma 對照與讀取方式

## 檔案

- 檔名：`OPEN333．CRM`
- File key：`WJmEgRptkvoTFIBNWdHwpW`
- 網址：`https://www.figma.com/design/WJmEgRptkvoTFIBNWdHwpW/`

## 頁面與主要畫面（node ID）

| 頁面 | 畫面 | node ID |
|---|---|---|
| Design System | 整頁元件、token | `0:1` |
| Design System | Button | `429:8357` |
| Design System | Tag | `1697:14324` |
| Design System | Checkbox | `1379:13310` |
| Design System | Switch | `3667:38086` |
| Design System | Tab / Underline | `589:10108` |
| Design System | Segmented Control | `922:33662` |
| Design System | Pagination Item | `1787:18681` |
| Design System | Input / Bar | `909:31526` |
| Design System | Dropdown / Trigger | `909:31767` |
| Design System | Form / Input Row | `986:6389` |
| Design System | Icon（82 個） | 元件集名稱 `Icon` |
| 1．登入 | Login — Final | `3110:3` |
| 2．收件匣、通知 | 2.1 收件匣 | `3527:24859` |
| 3．工單 | 3.1 案件列表 | `1169:11569` |
| 3．工單 | 3.2 案件詳情 | `1169:14231` |
| 3．工單 | 3.3 建立案件 Modal | `1169:15041` |
| 4．聯繫人 | Contact List — Production | `2905:338` |
| 5．自動化 | 5.1 自動化 | `1787:35214` |
| 6．知識庫 | 6.1 知識庫列表 | `1787:42379` |
| 7．行銷 | 7.1 行銷活動 | `3826:21059` |
| 9．粉絲活動 | 9.1 活動管理 | `3826:22153` |
| 10．短連結 | 10.1.1 連結管理 / 10.1.2 建立連結 | `3826:27494` / `4484:34907` |
| 11．報表 | 11.1 報表 | `4143:38807` |
| 12．設定 | 12.1.1 渠道管理 | `3363:37038` |
| 12．設定 | 12.2 人員管理 ~ 12.9 一般設定 | `1787:47269`、`1787:45909`、`1787:46249`、`3603:29892` ⋯ |
| 8．渠道、13．方案 | （尚未畫） | — |

## 用 Figma 連接器讀規格

1. **帳號要有編輯權限**：Figma 規定要有 edit 權限才能讀設計資料。Claude 帳號是私人的沒關係，但連接 Figma 時要登入**公司的 Figma 帳號**
2. 在 Figma 選到畫面 → 右鍵「Copy link to selection」，連結裡的 `node-id=3363-37038` 就是 `3363:37038`
3. 讀間距、顏色：`get_design_context`（fileKey、nodeId）
4. 匯出圖示：`use_figma` 執行唯讀程式 `node.exportAsync({ format: 'SVG_STRING' })`，一次回傳上限約 20KB，圖示要分批
5. Figma 回傳的圖片下載連結 7 天後失效，**一定要把檔案存進專案**，不要在程式碼裡引用 Figma 網址
6. 只讀不寫：除非設計師要求，不要用 `use_figma` 改 Figma 檔案

## 新增圖示的步驟

1. 匯出 SVG，原檔存到 `apps/web/public/icons/figma/<名稱>.svg`
2. 在 `components/icons/figma-icons.tsx` 加元件：`fill`／`stroke` 的灰色（#6D6D6D、#707E93、#37404C、#EE3134）改成 `currentColor`，屬性改成 React 寫法（`stroke-width` → `strokeWidth`）
3. 用 `text-*` 控制顏色

## 本機開發環境（給接手的人）

- 用 Docker 跑完整環境，**只連本機資料庫、只放假資料**，不連 UAT：`docker compose -f docker-compose.dev.yml up --build -d`
- 設定檔從範例複製：`.env.api`、`.env.workers`、`.env.web`（範例為 `.env.*.example`），`NODE_ENV=development`，網址都指向 `localhost`
- 已知問題：
  - `minio/minio` 映像已從 Docker Hub 下架，本機改 `cgr.dev/chainguard/minio:latest`（**不要推上去**）
  - Apple 晶片 Mac 在 Docker 裡裝不起 TensorFlow，`.env.api` 設 `UPLOAD_CONTENT_DETECTION_ENABLED=false`
  - 本機登入關閉驗證碼：`.env.web` 設 `NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED=false`
- 登入帳號：由 seed 建立的本機測試帳號，帳號與密碼見 `packages/database/prisma/seed.ts`。只能登入本機假資料，**不要把帳密抄進文件、截圖或對話**；UAT 與正式環境的帳號向負責人申請，不共用
- seed 不會建聯絡人與對話；要測列表請手動建立，或經負責人同意後用 `sync-uat-db.sh`
