/**
 * kb-ingest 管線各階段的資料結構定義（階段間用 JSONL 串接）。
 */

/** 逐字稿一句話（一個時間戳區間）。 */
export interface Turn {
  role: '客服' | '客戶' | '未知';
  text: string;
  /** 起始秒數（來自 [002.96s - 005.91s] 的前值）。 */
  startSec: number;
}

/** 01-scan 產出：一通電話的解析結果。 */
export interface ScannedCall {
  /** 相對 TRANSCRIPT_DIR 的檔案路徑，例：0512/ultra155200420260512085310.txt */
  file: string;
  /** 座席代碼（檔名 ultra 後 7 碼），例：1552004 */
  seat: string;
  /** 通話日期 YYYY-MM-DD，例：2026-05-12 */
  date: string;
  /** 通話時間 HH:MM:SS，例：08:53:10 */
  time: string;
  /** 本通偵測到的型號主鍵（去重），例：['TAC-11A','DH-5510'] */
  models: string[];
  /** 逐句對話。 */
  turns: Turn[];
  /** 全通字元數。 */
  charCount: number;
  /** 是否為空檔（0 byte，未接通）。 */
  empty: boolean;
}

/** 02-prefilter 產出：判定為有知識價值的候選（承接 ScannedCall 欄位）。 */
export interface CandidateCall extends ScannedCall {
  hasKnowledge: boolean;
  /** 命中原因（除錯用），例：['keyword:送修','model:TAC-11A'] */
  reasons: string[];
}

/** 03-extract 產出：從一通對話抽出的一則 QA 碎片。 */
export interface ExtractedQa {
  /** 來源檔（溯源、審核抽查用）。 */
  sourceFile: string;
  /** 標準化問句。 */
  question: string;
  /** 通用答案。 */
  answer: string;
  /** 分類（沿用 classify 的 9 類或服務/交易類）。 */
  category: string;
  /** 相關型號主鍵（通用問題留空）。 */
  models: string[];
  /** 會變動資訊（價格/門市/電話/促銷）→ 入庫需人工確認、強制 DRAFT。 */
  volatile: boolean;
  /** 需人工複檢（型號有疑義/語意不清/客服自己不確定）。 */
  needsReview: boolean;
  /** LLM 自評信心 0~1。 */
  confidence: number;
}

/** 04-cluster 產出：聚合後的一篇文章草稿（對應一個 KmArticle）。 */
export interface ArticleDraft {
  clusterId: string;
  title: string;
  content: string;
  summary: string;
  category: string;
  tags: string[];
  volatile: boolean;
  needsReview: boolean;
  /** 這則知識在逐字稿裡被問了幾次。 */
  frequency: number;
  /** 前幾個來源檔（供抽查）。 */
  sourceFiles: string[];
}
