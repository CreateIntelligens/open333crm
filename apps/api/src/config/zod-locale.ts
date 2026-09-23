/**
 * Zod 驗證訊息中文化（全域 errorMap）。
 *
 * 為何用全域 errorMap 而非逐條加訊息：全專案僅 5 處自訂過 zod 訊息，
 * 其餘一律落到內建英文（`Expected string, received number`、`Required`）。
 * 逐條補數量大且必然有漏；設一次 errorMap 即涵蓋所有現有與未來的 schema。
 *
 * 個別欄位若需要更具體的說明（例如「密碼需含大小寫」），
 * 仍可在該 schema 自訂訊息覆蓋此預設值。
 *
 * 專案使用 zod ^3.22（zod v4 的 API 是 z.config({ customError })，寫法不同）。
 */
import { z } from 'zod';

const TYPE_LABELS: Record<string, string> = {
  string: '文字',
  number: '數字',
  boolean: '是／否',
  date: '日期',
  array: '清單',
  object: '物件',
};

export function installZodChineseLocale(): void {
  z.setErrorMap((issue, ctx) => {
    switch (issue.code) {
      case z.ZodIssueCode.invalid_type: {
        // 未填與填錯型別要分開講——「必填」比「應為文字」更能讓人知道怎麼修
        if (issue.received === 'undefined' || issue.received === 'null') {
          return { message: '此欄位為必填' };
        }
        const expected = TYPE_LABELS[issue.expected as string] ?? issue.expected;
        return { message: `格式不正確，應為${expected}` };
      }

      case z.ZodIssueCode.too_small: {
        if (issue.type === 'string') {
          return { message: issue.minimum === 1 ? '此欄位為必填' : `至少需要 ${issue.minimum} 個字` };
        }
        if (issue.type === 'array') return { message: `至少需要選擇 ${issue.minimum} 項` };
        return { message: `不可小於 ${issue.minimum}` };
      }

      case z.ZodIssueCode.too_big: {
        if (issue.type === 'string') return { message: `最多 ${issue.maximum} 個字` };
        if (issue.type === 'array') return { message: `最多只能選擇 ${issue.maximum} 項` };
        return { message: `不可大於 ${issue.maximum}` };
      }

      case z.ZodIssueCode.invalid_string: {
        switch (issue.validation) {
          case 'email': return { message: '電子郵件格式不正確' };
          case 'url': return { message: '網址格式不正確' };
          case 'uuid': return { message: '識別碼格式不正確' };
          case 'datetime': return { message: '日期時間格式不正確' };
          default: return { message: '格式不正確' };
        }
      }

      case z.ZodIssueCode.invalid_enum_value:
        return { message: '不是可接受的選項' };

      case z.ZodIssueCode.unrecognized_keys:
        return { message: '包含不支援的欄位' };

      case z.ZodIssueCode.invalid_date:
        return { message: '日期格式不正確' };

      case z.ZodIssueCode.not_multiple_of:
        return { message: `必須是 ${issue.multipleOf} 的倍數` };

      case z.ZodIssueCode.custom:
        // 自訂驗證有自己的訊息時就用它，沒有才給通用說法
        return { message: ctx.defaultError === 'Invalid input' ? '輸入內容不正確' : ctx.defaultError };

      default:
        return { message: ctx.defaultError };
    }
  });
}
