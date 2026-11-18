/**
 * MJML → HTML compiler (Task 2.2)
 * Full email rendering pipeline: Block JSON → MJML → HTML with variable substitution.
 */

import { blockJsonToMjml, substituteMjmlVars, type BlockNode } from './mjml-renderer.js';

function stripMjmlTags(input: string, prefix: string): string {
  let result = '';
  let cursor = 0;
  while (true) {
    const start = input.indexOf(prefix, cursor);
    if (start === -1) return result + input.slice(cursor);
    const end = input.indexOf('>', start + prefix.length);
    if (end === -1) return result + input.slice(cursor);
    result += input.slice(cursor, start);
    cursor = end + 1;
  }
}

/**
 * Compile MJML string to HTML.
 * Uses dynamic import to avoid bundling issues – install `mjml` in the api package.
 */
export async function compileMjml(mjml: string): Promise<{ html: string; errors: string[] }> {
  try {
    // Dynamic import via Function keeps mjml as an optional runtime dependency.
    const importer = new Function(
      'specifier',
      'return import(specifier)',
    ) as (specifier: string) => Promise<unknown>;
    const mjmlPkg = await importer('mjml').catch(() => null);

    if (!mjmlPkg) {
      // Fallback: strip MJML tags and return a basic HTML shell for environments
      // where mjml is not installed (e.g. test environment)
      const stripped = stripMjmlTags(stripMjmlTags(mjml, '<mj-'), '</mj-').trim();
      return { html: `<html><body>${stripped}</body></html>`, errors: ['mjml package not found – using fallback'] };
    }

    const compile = (mjmlPkg as { default?: (input: string, options?: object) => { html: string; errors?: Array<{ message: string }> } }).default
      ?? (mjmlPkg as (input: string, options?: object) => { html: string; errors?: Array<{ message: string }> });
    const result = compile(mjml, { validationLevel: 'skip' });

    return {
      html: result.html,
      errors: result.errors?.map((e: { message: string }) => e.message) ?? [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { html: '', errors: [msg] };
  }
}

/**
 * Full pipeline: Block JSON → MJML → HTML, with variable substitution.
 *
 * @param blocks  - Array of BlockNode objects (from template body JSON)
 * @param vars    - Variable map, e.g. { contact_name: 'Alice', coupon_code: 'ABC10' }
 * @returns Rendered HTML string, ready to send as email body
 */
export async function renderEmailTemplate(
  blocks: BlockNode[],
  vars: Record<string, string> = {},
): Promise<string> {
  const mjml = blockJsonToMjml(blocks);
  const mjmlWithVars = substituteMjmlVars(mjml, vars);
  const { html, errors } = await compileMjml(mjmlWithVars);

  if (errors.length > 0 && !html) {
    throw new Error(`Email render failed: ${errors.join('; ')}`);
  }

  return html;
}
