/**
 * csat flow 的單元測試依賴（change migrate-csat-tenant-ctx）：
 * 把資料庫替身包成 flow 用的 prisma。`$transaction` 直接以替身當交易，log 記下 commit 或 rollback；
 * 事件只記錄、不送出；conversation 的兩個函式也收同一個替身（各測試檔以 vi.mock 替換）。
 */
import type { Server } from 'socket.io';
import type { CsatFlowDeps } from '#src/modules/csat/csat.flow.js';
import { createFlowLog, mockTransactionPrisma, recordingPublisher, type FlowLog } from './flow-harness.js';

export function csatFlowDeps(db: object, io: Server, log: FlowLog = createFlowLog()): CsatFlowDeps & { log: FlowLog } {
  const tx = db as Record<string, unknown>;
  return {
    // readAiPrivacyPolicy() 在交易外以 prisma 讀平台設定，所以 prisma 本身也帶著替身的 model
    prisma: { ...tx, ...(mockTransactionPrisma(log, tx) as object) } as never,
    io,
    events: recordingPublisher(log),
    conversationDb: db as never,
    log,
  };
}
