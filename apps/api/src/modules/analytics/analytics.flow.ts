/**
 * analytics 的報表查詢。每個報表在一個租戶交易內查詢（AGENTS.md 結構規則 2）。
 * 報表頁、CLI 與 MCP 都呼叫這裡。
 */
import { flowOf } from '../../lib/tenant-ctx.js';
import {
  exportCsv,
  getAgentPerformance,
  getCaseStats,
  getChannelAnalytics,
  getContactAnalytics,
  getCsatReport,
  getMessageTrend,
  getMyPerformance,
  getOverviewStats,
} from './analytics.service.js';

export const getOverviewStatsFlow = flowOf(getOverviewStats);
export const getMessageTrendFlow = flowOf(getMessageTrend);
export const getCaseStatsFlow = flowOf(getCaseStats);
export const getAgentPerformanceFlow = flowOf(getAgentPerformance);
export const getChannelAnalyticsFlow = flowOf(getChannelAnalytics);
export const getContactAnalyticsFlow = flowOf(getContactAnalytics);
export const getMyPerformanceFlow = flowOf(getMyPerformance);
export const getCsatReportFlow = flowOf(getCsatReport);
export const exportCsvFlow = flowOf(exportCsv);
