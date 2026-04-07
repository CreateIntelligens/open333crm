/**
 * Template Renderer — recursive variable substitution engine.
 *
 * Walks a JSON body and replaces every `{{key}}` placeholder with the
 * corresponding value from the supplied variables map.
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface TemplateVariable {
  key: string;
  label?: string;
  defaultValue?: string;
  required?: boolean;
}

// ─── Core helpers ───────────────────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

/**
 * Replace `{{key}}` placeholders inside a single string.
 */
function replaceInString(str: string, vars: Record<string, string>): string {
  return str.replace(PLACEHOLDER_RE, (_match, key: string) => {
    return vars[key] !== undefined ? vars[key] : `{{${key}}}`;
  });
}

/**
 * Recursively walk a value (string / array / object) and substitute variables.
 */
export function renderTemplateBody<T>(body: T, variables: Record<string, string>): T {
  if (typeof body === 'string') {
    return replaceInString(body, variables) as unknown as T;
  }
  if (Array.isArray(body)) {
    return body.map((item) => renderTemplateBody(item, variables)) as unknown as T;
  }
  if (body !== null && typeof body === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      result[k] = renderTemplateBody(v, variables);
    }
    return result as T;
  }
  // number, boolean, null — return as-is
  return body;
}

/**
 * Extract all unique `{{key}}` placeholders from a template body.
 */
export function extractVariables(body: unknown): string[] {
  const keys = new Set<string>();

  function walk(val: unknown) {
    if (typeof val === 'string') {
      let m: RegExpExecArray | null;
      const re = new RegExp(PLACEHOLDER_RE.source, 'g');
      while ((m = re.exec(val)) !== null) {
        keys.add(m[1]);
      }
    } else if (Array.isArray(val)) {
      val.forEach(walk);
    } else if (val !== null && typeof val === 'object') {
      Object.values(val).forEach(walk);
    }
  }

  walk(body);
  return Array.from(keys);
}

/**
 * Validate that all required variables have been provided.
 * Returns an array of missing variable keys. Empty = OK.
 */
export function validateVariables(
  templateVars: TemplateVariable[],
  provided: Record<string, string>,
): string[] {
  const missing: string[] = [];
  for (const v of templateVars) {
    if (v.required && !provided[v.key] && !v.defaultValue) {
      missing.push(v.key);
    }
  }
  return missing;
}

/**
 * Build a complete variables map by merging defaults from the template variable
 * definitions with the explicitly provided values.
 */
export function buildVariableMap(
  templateVars: TemplateVariable[],
  provided: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const v of templateVars) {
    if (v.defaultValue !== undefined) {
      result[v.key] = v.defaultValue;
    }
  }
  // Provided values override defaults
  for (const [k, val] of Object.entries(provided)) {
    if (val !== undefined && val !== '') {
      result[k] = val;
    }
  }
  return result;
}

/**
 * Generate sample data for preview purposes.
 */
export function sampleVariables(keys: string[]): Record<string, string> {
  const samples: Record<string, string> = {
    'contact.name': '陳小明',
    'contact.phone': '0912-345-678',
    'contact.email': 'demo@example.com',
    'attribute.membership': '白金會員',
    'attribute.company': '範例科技有限公司',
    'storage.base_url': 'https://storage.example.com',
  };

  const result: Record<string, string> = {};
  for (const key of keys) {
    result[key] = samples[key] || `[${key}]`;
  }
  return result;
}
