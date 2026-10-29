/**
 * SLA 政策的 flow（#337 階段 3，AGENTS.md 結構規則 2）。
 *
 * 每個操作只呼叫一個 service 函式，沒有推播、事件或稽核。
 * 改名與同步工單上的政策名稱在同一個交易內（主規格 sla-policy-selection）。
 */
import { flowOf } from '../../lib/tenant-ctx.js';
import { createSlaPolicy, deleteSlaPolicy, listSlaPolicies, updateSlaPolicy } from './sla.service.js';

export const listSlaPoliciesFlow = flowOf(listSlaPolicies);
export const createSlaPolicyFlow = flowOf(createSlaPolicy);
export const updateSlaPolicyFlow = flowOf(updateSlaPolicy);
export const deleteSlaPolicyFlow = flowOf(deleteSlaPolicy);
