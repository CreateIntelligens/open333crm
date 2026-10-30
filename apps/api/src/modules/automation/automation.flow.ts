/**
 * 自動化規則管理的 flow。route 呼叫這裡，不自己開交易（AGENTS.md 結構規則 2）。
 * 目前每個操作只呼叫一個 service 函式，所以用 flowOf；加上稽核或推播時改寫成一般的 flow 函式。
 */
import { flowOf } from '../../lib/tenant-ctx.js';
import {
  createRule,
  deleteRule,
  getRule,
  listLogs,
  listRules,
  testRule,
  updateRule,
} from './automation.service.js';

export const listRulesFlow = flowOf(listRules);
export const getRuleFlow = flowOf(getRule);
export const createRuleFlow = flowOf(createRule);
export const updateRuleFlow = flowOf(updateRule);
export const deleteRuleFlow = flowOf(deleteRule);
export const testRuleFlow = flowOf(testRule);
export const listLogsFlow = flowOf(listLogs);
