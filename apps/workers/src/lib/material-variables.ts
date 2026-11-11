import type { PrismaClient } from '@prisma/client';

const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

interface MaterialVariableDef {
  key?: unknown;
  defaultValue?: unknown;
}

/**
 * 自動化送素材時的變數值（比照 apps/api 廣播的 template-context）：
 *   素材預設值 → 聯絡人資料（contact.name / phone / email、attribute.*）→ 規則 params.variables
 * 後者覆蓋前者；空字串不覆蓋。
 *
 * workers 走 BYPASSRLS 連線，查聯絡人一定帶 tenantId。
 */
export async function resolveMaterialVariables(
  prisma: PrismaClient,
  opts: {
    tenantId: string;
    contactId?: string | null;
    materialVariables?: unknown;
    ruleVariables?: Record<string, string>;
  },
): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};

  const defs = Array.isArray(opts.materialVariables) ? (opts.materialVariables as MaterialVariableDef[]) : [];
  for (const def of defs) {
    if (typeof def?.key === 'string' && typeof def.defaultValue === 'string' && def.defaultValue !== '') {
      vars[def.key] = def.defaultValue;
    }
  }

  vars['storage.base_url'] = process.env.STORAGE_PUBLIC_BASE_URL || vars['storage.base_url'] || '';

  if (opts.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: opts.contactId, tenantId: opts.tenantId },
      include: { attributes: true },
    });
    if (contact) {
      if (contact.displayName) vars['contact.name'] = contact.displayName;
      if (contact.phone) vars['contact.phone'] = contact.phone;
      if (contact.email) vars['contact.email'] = contact.email;
      for (const attr of contact.attributes ?? []) {
        if (attr.value) vars[`attribute.${attr.key}`] = attr.value;
      }
    }
  }

  for (const [k, v] of Object.entries(opts.ruleVariables ?? {})) {
    if (typeof v === 'string' && v !== '') vars[k] = v;
  }

  return vars;
}

/**
 * 替換後仍沒有值的 {{key}} 改成空字串：原樣的大括號不能送到客人手上。
 */
export function stripUnresolvedPlaceholders<T>(body: T): T {
  if (typeof body === 'string') return body.replace(PLACEHOLDER_RE, '') as unknown as T;
  if (Array.isArray(body)) return body.map((item) => stripUnresolvedPlaceholders(item)) as unknown as T;
  if (body !== null && typeof body === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) result[k] = stripUnresolvedPlaceholders(v);
    return result as T;
  }
  return body;
}
