/**
 * 快速回覆預設組的 flow。route 呼叫這裡，不自己開交易（AGENTS.md 結構規則 2）。
 * 目前每個操作只呼叫一個 service 函式，所以用 flowOf；加上稽核或推播時改寫成一般的 flow 函式。
 */
import { flowOf } from '../../lib/tenant-ctx.js';
import { createPreset, deletePreset, listPresets, updatePreset } from './quick-reply-preset.service.js';

export const listPresetsFlow = flowOf(listPresets);
export const createPresetFlow = flowOf(createPreset);
export const updatePresetFlow = flowOf(updatePreset);
export const deletePresetFlow = flowOf(deletePreset);
