# @open333crm/kb-ingest

把**大同客服電話逐字稿**轉成有用的 KB（知識管理）資料的離線批次管線。

## 為什麼做這個

KB 現況約 540 篇，最大缺口不是產品規格，而是「服務/交易資訊」（保固、門市、
客服專線、維修費用、退換貨 = 各 0 篇 P1 缺料）與「故障排除 SOP」。而逐字稿裡客戶
最常問的正是這些。本管線的價值：

- **產出 A**：從逐字稿抽出可入庫的 QA 文章 → 補進 KmArticle（一律先 DRAFT）
- **產出 B**：問題分布 / 缺料驗證報告（100 通試跑已驗證：**71% 萃取 QA 落在 P1 服務/交易缺口**）

## 六階段管線（階段間用 data/ 下的 JSONL 串接，可斷點續跑）

| 階段 | 腳本 | 做什麼 | 產出 |
|---|---|---|---|
| 01 | `pnpm scan` | 解析 txt、過濾空檔、抽型號 | `01-scanned.jsonl` |
| 02 | `pnpm prefilter` | 規則粗篩服務/型號訊號 | `02-candidates.jsonl` |
| 03 | `pnpm extract` | Gemini flash-lite 抽 QA + 三層防幻覺 | `03-extracted.jsonl` |
| 04 | `pnpm cluster` | 硬分組 + 聚類 + 合併成篇 | `04-articles.jsonl` / `.csv` |
| 05 | `pnpm report` | 問題分布 + 缺料驗證報告 | `report-*.csv` / `.md` |
| 06 | `pnpm import` | 匯入 KmArticle（DRAFT） | 寫入 DB |

## 快速開始

```bash
# 前置：root .env 需有 GEMINI_API_KEY / DATABASE_URL / OLLAMA_BASE_URL
pnpm --filter @open333crm/database build   # 06-import 需要

cd packages/kb-ingest
pnpm scan
pnpm prefilter
pnpm extract -- --limit 100    # 先跑 100 通品質門（省成本）
pnpm cluster
pnpm report
# 人工審核 data/04-articles.csv → 另存為 data/04-articles.reviewed.csv
pnpm import -- --dry-run        # 驗證
pnpm import                     # 實際寫入 DRAFT
```

全量：`pnpm extract`（不帶 --limit，斷點續跑；建議 Ollama 開著讓 04-cluster 用 embedding 聚類）。

## 防幻覺與隱私（三層）

1. **prompt 約束**：去 PII、型號只能用本通清單、寧缺勿造（見 `src/lib/prompts.ts`）
2. **grounding**：userMessage 末端附「本通偵測到型號」
3. **程式端二次校驗**（`src/lib/guards.ts`）：幻覺型號 / 殘留 PII → 強制 needsReview；
   價格/門市/電話 → 強制 volatile

- 所有原始逐字稿與中間檔含 PII，**一律不進 git**（見 `.gitignore`）
- 匯入**一律 DRAFT**：只有 PUBLISHED+embedding 才會被 AI 檢索；DRAFT 讓人工在系統內
  二次確認後再上架。`volatile`（會變動資訊）永遠留 DRAFT，交人工當週確認

## 設計備註

- 刻意只依賴 `@open333crm/database`，不拉 apps/api 的 config 鏈（離線腳本更穩）。
  型號偵測正則複製自 `apps/api/src/modules/ai/model-matcher.ts`，若上游更新需同步。
- Gemini/Ollama 呼叫在 `src/lib/llm.ts`，讀 `process.env`（dotenv 載入 root `.env`）。
- 逐字稿為 **CRLF** 行尾、`[客服]/[客戶]` 標籤偶爾標反（prompt 已交代 LLM 依語意判斷）。
