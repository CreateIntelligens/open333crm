---
name: open333crm-ui
description: open333crm 前端（apps/web）的 UI 設計系統與版面規範：Figma Design System 的顏色 token、共用元件（Button、Badge、Input、Select、Checkbox、Switch、Tabs、Pagination）、外框與導覽（圖示欄＋子選單）、頁面標題列、「下一頁式」表單（PageDialog）、表格樣式、Figma 對照方式與前端資安規則。只要在 open333crm 專案改畫面、新增頁面、還原 Figma 或 Claude Design 稿、調整樣式、新增選單項目、做表單或列表，就一定要先讀這份 skill，即使使用者沒有提到「設計系統」或「token」。
---

# open333crm UI 設計系統

這份 skill 記錄 open333crm 前端改版後的 UI 規則，目的是讓任何人（或 AI）接手時，做出來的畫面跟 Figma 一致、不用每次重新推敲。

**設計來源以 Figma 為準**：檔案 `OPEN333．CRM`（file key `WJmEgRptkvoTFIBNWdHwpW`），第一頁「Design System」是元件與 token 的唯一來源。Figma 與舊的 Claude Design 稿不一致時，一律照 Figma。

改畫面前先讀完這頁；需要細節時再看：
- `references/tokens.md`：所有顏色 token 的 Figma 名稱、色碼、CSS 變數、Tailwind class 對照
- `references/figma.md`：Figma 各頁面與畫面的 node ID、怎麼用 Figma 連接器讀規格、本機環境
- `references/backlog.md`：目前的改版進度與待辦（會過時）

## 1. 基本原則

1. **只用 token，不寫死色碼。** 顏色一律用 Tailwind 的語意 class（`text-foreground`、`bg-primary`、`border-border`⋯），不要寫 `text-[#37404c]`。token 有亮色和暗色兩組值，寫死色碼會讓暗色模式壞掉。Figma 有、專案還沒有的顏色，先加到 `globals.css` 和 `tailwind.config.ts`（見 tokens.md 的「新增 token」）。
2. **先用共用元件，不要自己刻。** 按鈕用 `<Button>`、標籤用 `<Badge>`、輸入框用 `<Input>`⋯。共用元件已經對齊 Figma，自己刻的樣式之後改版不會跟著變。
3. **只改 `apps/web`。** 前端設計工作不碰 `apps/api`、`apps/workers`、`packages/database`。需要新資料時找後端，不要自己改 API。
4. **保留功能，只換外觀。** 還原設計稿時，原本的資料讀取、送出、權限判斷都要保留。設計稿有、但後端沒提供資料的區塊，先不做並在程式碼留註解（例：`{/* Figma 有公司名稱，/auth/me 沒有回傳，待後端提供 */}`），不要用假資料填。

## 2. Token、頁面預設值與例外

規格分三層，改之前先分清楚屬於哪一層：

| 層 | 是什麼 | 能不能改 | 在哪裡 |
|---|---|---|---|
| **Design Token** | Figma Design System 定義的基本值：顏色、圓角、間距刻度、字級 | 只有設計師改 Figma 後才能跟著改 | `globals.css`、`tailwind.config.ts`、`references/tokens.md` |
| **頁面預設值** | 從 Figma 頁面歸納出的慣例，大部分頁面這樣做 | 可以依頁面調整，但要有理由 | 本節下方 |
| **例外** | 某一頁刻意不照預設 | 要在程式碼旁註解原因 | 該頁程式碼 |

### Design Token

**圓角**（專案已改過，**跟 Tailwind 預設不同**，容易用錯）：

| Figma | Tailwind class | 用途 |
|---|---|---|
| 6px | `rounded-sm` | 小元件 |
| 8px | `rounded-md` | 按鈕、選單項目、圖示按鈕 |
| 12px | `rounded-lg` | 輸入框、下拉選單、標籤（Tag）、卡片、表格外框 |
| 16px | `rounded-xl` | 跳出視窗、聊天泡泡 |
| 24px | `rounded-3xl` | 內容區左上角 |

**間距刻度**：0、2、4、8、12、16、20、24、28、32、36、40、48、64（Tailwind `gap-1`=4、`gap-2`=8、`gap-3`=12、`gap-4`=16、`gap-5`=20、`gap-6`=24、`gap-7`=28、`gap-8`=32、`gap-12`=48）。不在刻度上的數字（例如 18、30）先回頭確認 Figma。

**字級**：12 / 14 / 16 / 18 / 20 / 24 / 28 / 42；字型 Inter，等寬字 IBM Plex Mono（`font-mono`）。

**顏色**：見 `references/tokens.md`。

### 頁面預設值

| 項目 | 預設 | 來源 |
|---|---|---|
| 內容區內距 | 左右 32（`px-8`），上 32 | Figma 列表頁、設定頁 |
| 標題區與內容間距 | 24～28 | Figma 列表頁 |
| 大區塊之間 | 48（`gap-12`） | 12.1.1 渠道管理 |
| 頁面主要按鈕寬度 | 140（`w-[140px]`） | 7.1.1、12.1.1 |
| 表單頁內容寬度 | 620 | 10.1.2 建立連結 |
| 設計稿畫布 | 1680 × 1050 | 所有 Figma 頁面 |
| 支援裝置 | 只做桌機，檢查 MacBook 寬度與 1920 外接螢幕；不做手機、平板 | 專案決定 |

### 例外

照 Figma 某頁刻意不用預設值時（例如表格欄位很多要更寬），在程式碼旁註解，例：

```tsx
{/* 例外：欄位多，表單頁放寬到 960（Figma 3.3 建立案件） */}
```

沒有註解的「不一致」會被當成錯誤修掉。

## 3. 外框與導覽

結構（`app/dashboard/layout.tsx`）：

```
頂部列 AppHeader（高 51，bg-shell）
├─ 左側圖示欄 Sidebar（寬 66，bg-shell）
├─ 子選單 SectionNav（寬 230，只有該區有子頁才出現）
└─ 內容區 main（白底、左上 rounded-3xl、淡陰影）
     ├─ .app-content：頁面本身（自己捲動）
     └─ #page-dialog-root：下一頁式表單蓋在這裡
```

**選單資料只有一份**：`components/layout/Sidebar.tsx` 的 `RAIL` 陣列。圖示欄、子選單、手機版抽屜、頁面麵包屑都讀它。

新增選單項目：
- 新大項：在 `RAIL` 加一筆 `{ id, label, href, perm?, icon, sections? }`，`icon` 用 `components/icons/figma-icons.tsx` 的 Figma 圖示
- 新子頁：加在該大項的 `sections[].items`
- `perm` 是權限碼。**前端隱藏只是不顯示，真正的權限由後端擋**，加了 `perm` 不代表安全
- 網址底下的頁面都算同一區時，用 `match`（例：渠道 `match: '/dashboard/line'`）

選中樣式：圖示欄與子選單選中都是 `bg-primary-hover text-white`；未選中 `text-tertiary-foreground`。

## 4. 頁面標題列（Topbar）

一般頁面用 `<Topbar>`（`components/layout/Topbar.tsx`），規格依 Figma 列表頁：

```tsx
<div className="flex h-full flex-col">
  <Topbar title="行銷活動" description="管理行銷活動">
    <Button variant="outline" className="w-[140px]">匯出</Button>
    <Button className="w-[140px]"><AddIcon />新增活動</Button>
  </Topbar>
  <div className="flex-1 overflow-auto px-8 pb-8">{/* 內容 */}</div>
</div>
```

- **麵包屑自動產生**（讀 `RAIL`），不用手寫。剛好在子選單那頁時，標題會自動換成子選單名稱
- `children` 放右側操作按鈕（寬度見第 2 節頁面預設值）
- 頁面內容的左右留白跟標題對齊，用頁面預設值 `px-8`
- 設定頁（`app/dashboard/settings/page.tsx`）不用 Topbar，自己畫「設定 > xxx」麵包屑，內距 `p-8`

## 5. 表單：下一頁 vs 跳出視窗

**判斷規則：**

| 用「下一頁」（PageDialog） | 用跳出視窗（Dialog） |
|---|---|
| 欄位多的建立／編輯表單 | 確認類：刪除、結案、關閉 |
| | 一次性顯示結果：API 金鑰、Token、QR Code、嵌入碼 |
| | 快速選擇：選版型、選範本 |
| | 只有一兩個欄位：改名、命名 Passkey、調整積分 |

例外：**收件匣裡建立案件維持跳出視窗**（客服要邊看對話邊建單），工單頁才用下一頁。`CaseCreateModal` 用 `asPage` prop 切換。

**PageDialog 用法**跟 Dialog 一樣，多兩個麵包屑 prop：

```tsx
import { PageDialog, PageDialogContent, PageDialogHeader, PageDialogTitle, PageDialogFooter } from '@/components/ui/page-dialog';

<PageDialog open={open} onOpenChange={setOpen} section="設定" parent="標籤管理">
  <PageDialogContent>
    <PageDialogHeader><PageDialogTitle>新增標籤</PageDialogTitle></PageDialogHeader>
    {/* 欄位 */}
    <PageDialogFooter>
      <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
      <Button onClick={save}>儲存</Button>
    </PageDialogFooter>
  </PageDialogContent>
</PageDialog>
```

- 會蓋滿白色內容區，側欄不動；麵包屑 `{section} > {parent} > {標題}`，點 parent 回列表；瀏覽器「上一頁」也會關閉
- Footer 會自動把順序反過來，**主要按鈕在左、取消在右**（照設計稿）。按鈕照原本 Dialog 的寫法放「取消、儲存」即可
- 表單寬度統一 620px；傳給 Content 的 `max-w-*`、`max-h-*`、`overflow-*` 會被忽略（那是跳出視窗才需要的）
- 需要獨立網址（可分享、可重新整理）的表單，改用真正的路由頁，參考 `components/shortlink/LinkForm.tsx` 與 `app/dashboard/shortlinks/links/new/page.tsx`

**表單頁的欄位排版**（依短連結稿）：區塊標題 `text-sm font-semibold border-b pb-2.5`，欄位間距 `gap-5`，標籤 `text-sm font-medium`，必填星號 `text-destructive`，說明文字 `text-xs text-muted-foreground`，底部有「尚未完成：xxx」提示。

## 6. 共用元件對照 Figma

變體名稱沿用舊 API，既有頁面不用改。

**Button**（`components/ui/button.tsx`，Figma `Button`）

| variant | Figma Type | 樣子 |
|---|---|---|
| `default` | Primary | 藍底白字 600，hover 深藍，停用灰 `#D0D0D0` |
| `secondary` | Secondary | 淡藍底＋藍框藍字 |
| `outline` | Outline | 白底＋灰框 `#6D6D6D` |
| `subtle` | Subtle | 白底＋淺框 `#E2E8F0` |
| `ghost` | Ghost | 無框灰字 |
| `destructive` / `ai` / `link` | （Figma 未定義） | 專案原有用途 |

size：`lg` 44、`default` 40（16px 字）、`sm` 36、`xs` 32（14px 字）。`loading` 會顯示灰底轉圈。

**Badge**（Figma `Tag`，高 22、`rounded-lg`）：Soft 用 `secondary`／`info`／`success`／`danger`／`warning`／`ai`；Solid 用 `default`／`destructive`／`solid-*`；Outline 用 `outline`／`outline-*`。

**表單**：`Input`／`Textarea` 高 48、`rounded-lg`、focus 藍框、`aria-invalid` 紅框；`Select` 高 44、淺灰底、Figma 向下箭頭；`Checkbox` 16px 方框；`Switch`（44×24，可帶 `title`／`description`）。

**Tabs**：`variant="underline"`（Figma Tab / Underline）或預設 pill（Figma Segmented Control）。TabsTrigger 的 role 是 `tab`，測試要用 `getByRole('tab')`。

**Pagination**：40×40、目前頁白底框線。

**表格**：不用寫 class，`.app-content` 裡的 `<table>` 會自動套 Figma Table/Row（表頭 `#F8FAFC` 14px 500 灰藍、內容列內距 16、滑過 `#F5F5F5`）。個別表格不要套用時加 `data-plain`。

## 7. 圖示

- Figma 圖示的原始 SVG 存在 `apps/web/public/icons/figma/`，React 元件在 `components/icons/figma-icons.tsx`
- 元件顏色用 `currentColor`，由外層 `text-*` 控制
- `AutomationIcon` 的鏤空處用 CSS 變數 `--icon-cutout`，放在有底色的地方時設成底色
- Figma 共 82 個圖示，目前只存了用到的；新頁面用到新圖示時，從 Figma 匯出 SVG 存進同一個資料夾並加元件（流程見 figma.md）
- Figma 沒有的圖示，用 `lucide-react` 補，並在旁邊註解

## 8. 資安規則（每次都要檢查）

1. **不要用 `dangerouslySetInnerHTML`**，會讓使用者輸入的內容被當成程式執行（XSS）
2. **不要把密鑰放在前端**：前端程式碼會整包送到瀏覽器；`NEXT_PUBLIC_` 開頭的變數任何人都看得到
3. **權限由後端把關**：前端隱藏按鈕只是 UX
4. **關閉安全功能只限隔離的本機開發環境**：本機為了能在 Docker 跑起來，關掉了上傳檔案檢查（`UPLOAD_CONTENT_DETECTION_ENABLED=false`）和登入驗證碼（`NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED=false`）。這兩個設定：
   - 只能用在連本機資料庫、只有假資料的環境
   - **禁止**用在 UAT、正式環境，或任何連到真實資料的環境
   - 只寫在 `.env.*`（已被 `.gitignore` 忽略），不要寫進程式碼、`docker-compose*.yml` 或文件範例
   - 本機若改連 UAT 資料（例如用了 `sync-uat-db.sh`），要先把這兩個設定改回開啟
5. **推 PR 排除 `docker-compose.dev.yml`**（本機改用第三方 MinIO 映像）
6. **截圖、貼給 AI 的內容不要有真實客戶資料**；`localhost` 是假資料，UAT 是真資料
7. **不要執行 `scripts/dev-uat.sh`**（會寫入 UAT）；`sync-uat-db.sh` 會複製真實客戶資料到本機，要負責人同意
8. `target="_blank"` 的連結要加 `rel="noopener noreferrer"`

本機另有 git hook（`.git/hooks/pre-commit`、`pre-push`）自動擋：密鑰、`.env`、資料檔、`apps/web` 以外的檔案、`dangerouslySetInnerHTML`、直接推 main。hook 只在個人電腦上，不在 repo 裡。

## 9. 改完之後的檢查

本機的 Node 環境在 Docker 裡，指令要透過容器執行（在專案根目錄）：

```bash
DC="docker compose -f docker-compose.dev.yml"

# 1. 型別檢查：錯誤數不能比改之前多（改版時基準是 18 個，都在本次改動以外）
$DC exec web sh -c "cd apps/web && npx tsc --noEmit -p tsconfig.json"

# 2. 單元測試
$DC exec web sh -c "cd apps/web && npx vitest run --project unit"

# 3. ESLint
$DC exec web sh -c "cd apps/web && npx eslint src"
```

> ESLint 目前跑不起來：`apps/web/eslint.config.mjs` 引用了 `eslint-config-next`，但專案沒有安裝這個套件。需要工程師補上依賴後才能納入檢查，修好前請在 PR 說明註記「未跑 ESLint」。

**推 PR 前多做一次正式建置**（會用到前端的 `.next` 資料夾，所以先停掉開發伺服器）：

```bash
$DC stop web
$DC run --rm web sh -c "cd apps/web && pnpm build"
$DC up -d web
```

**Playwright**：專案的 Playwright 測試（`playwright.uat.config.ts`、`tests/e2e-uat/`）是**對 UAT 執行**的，會在共用環境操作真實資料，由維護它的人負責。前端設計工作**不要自己執行**。改了導覽、表單形式等會影響這些測試的結構時，在 PR 說明列出可能受影響的測試檔，請維護者更新。目前沒有本機用的 E2E 或截圖比對測試。

**回歸測試**：
- 改了元件或共用樣式：把用到它的主要頁面都點過一遍（元件影響全站）
- 改了行為（例如按鈕的 role、表單送出流程）：同步更新 `apps/web/tests/unit/` 裡對應的測試，不要刪測試來讓它通過
- 新增有判斷邏輯的元件：照 `AGENTS.md` 的測試規範補測試

**人工檢查**：自動測試看不出畫面問題，一定要在瀏覽器看過，MacBook 寬度與 1920 外接螢幕各一次。

**更新規範**：這次改到元件、token、版面規則或頁面預設值時，同一個 PR 裡更新這份 skill。

本機開發環境、Docker、假資料的設定見 `references/figma.md` 最後一節。

## 10. 進度與待辦

這份 skill 只放長期規則。改版進度、還沒做完的項目、待後端或 PM 確認的事，放在 `references/backlog.md`，那份會隨開發更新，**內容可能已過時**，引用前先跟程式碼核對。
