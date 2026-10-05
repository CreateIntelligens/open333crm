import { AUTOMATION_EVENT_MAP, AUTOMATION_FACT_MAP, type AutomationFactType } from '@open333crm/automation';
import { summarizeAction } from './rule-summary';
import { ruleEventName } from './rule-actions';
import { conditionLeaves } from './condition-tree';

export type TestFieldInput = 'text' | 'number' | 'select' | 'boolean' | 'datetime' | 'list';

export interface TestFormField {
  key: string;
  label: string;
  input: TestFieldInput;
  /** 欄位在契約的型別：送出時依它轉型，例如是／否欄位要送布林值，渠道要送陣列 */
  factType?: AutomationFactType;
  options?: Array<{ value: string; label: string }>;
}

/**
 * 試跑表單的欄位：規則條件用到的每個欄位一格（依出現順序、不重複），
 * 名稱用契約的中文名稱，輸入方式依欄位型別。只問跟這條規則有關的資料，不必手寫 JSON。
 */
export function testFormFields(conditions: unknown): TestFormField[] {
  const keys = [...new Set(conditionLeaves(conditions).map((leaf) => leaf.fact))];
  return keys.map((key) => {
    const def = AUTOMATION_FACT_MAP.get(key);
    const label = def?.label ?? key;
    const factType = def?.type;
    if (def?.values?.length) {
      return { key, label, input: 'select', factType, options: def.values.map((o) => ({ value: String(o.value), label: o.label })) };
    }
    const input: TestFieldInput =
      def?.type === 'number' ? 'number'
        : def?.type === 'boolean' ? 'boolean'
          : def?.type === 'datetime' ? 'datetime'
            : def?.type === 'string_array' ? 'list'
              : 'text';
    return { key, label, input, factType };
  });
}

/**
 * 表單填的值轉成試跑 API 要的 facts；沒填的欄位不送，讓規則看到「沒有值」。
 * 依欄位在契約的型別轉型：規則存的是布林值、陣列時，送字串會讓條件永遠不符合。
 */
export function buildTestFacts(fields: TestFormField[], values: Record<string, string>): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = (values[field.key] ?? '').trim();
    if (!raw) continue;
    const type = field.factType ?? (field.input === 'number' ? 'number' : field.input === 'boolean' ? 'boolean' : 'string');
    if (type === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n)) facts[field.key] = n;
    } else if (type === 'boolean') {
      facts[field.key] = raw === 'true';
    } else if (type === 'string_array') {
      facts[field.key] = raw.split(/[、,，]/).map((v) => v.trim()).filter(Boolean);
    } else if (type === 'datetime') {
      // datetime-local 沒有時區，依瀏覽器時區轉成 ISO，與 workers 傳入的時間點一致
      const date = new Date(raw);
      if (!Number.isNaN(date.getTime())) facts[field.key] = date.toISOString();
    } else {
      facts[field.key] = raw;
    }
  }
  return facts;
}

/**
 * 試跑結果的中文說明。試跑只評估條件；規則停用、事件不會送出時，條件符合實際也不會執行，
 * 關鍵字規則還要訊息含關鍵字，這些都要講清楚，不能只說「會觸發」。
 */
export function describeTestResult(
  result: { matched?: boolean },
  actions: unknown,
  context: { isActive?: boolean; eventName?: string } = {},
): { triggered: boolean; headline: string; actions: string[] } {
  if (!result.matched) return { triggered: false, headline: '不會觸發：條件不符合', actions: [] };
  if (context.isActive === false) {
    return { triggered: false, headline: '條件符合，但規則目前停用，不會執行', actions: [] };
  }
  const event = context.eventName ? AUTOMATION_EVENT_MAP.get(context.eventName) : undefined;
  if (event?.dispatched === false) {
    return { triggered: false, headline: `條件符合，但系統目前不會送出「${event.label}」事件，不會執行`, actions: [] };
  }
  return {
    triggered: true,
    headline: context.eventName === 'keyword.matched' ? '會觸發（客人的訊息還要含有設定的關鍵字）' : '會觸發',
    actions: Array.isArray(actions) ? actions.map(summarizeAction) : [],
  };
}

/**
 * 規則沒有條件時，試跑表單上方的說明。依「已儲存」的規則判斷（試跑評估的也是已儲存的版本）：
 * 停用、事件不會送出時不能說「每次都會執行」。
 */
export function noConditionNote(rule: {
  isActive?: boolean;
  trigger?: { type?: string } | null;
  eventType?: string;
}): string {
  if (rule.isActive === false) return '這條規則沒有條件，但目前停用，不會執行。';
  const eventName = ruleEventName(rule);
  const event = AUTOMATION_EVENT_MAP.get(eventName);
  if (event?.dispatched === false) return `這條規則沒有條件，但系統目前不會送出「${event.label}」事件，不會執行。`;
  if (eventName === 'keyword.matched') return '這條規則沒有其他條件，客人的訊息含有設定的關鍵字就會執行。';
  return `這條規則沒有條件，每次${event?.label ?? '觸發'}都會執行。`;
}
