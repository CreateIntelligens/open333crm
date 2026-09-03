import { z } from 'zod';

const WIKI_BASE_URL = 'https://wiki.david888.com';
const MAX_MARKDOWN = 100_000;
const wikiResponseSchema = z.object({ shareUrl: z.string().min(1) });

export function validateWikiPath(path: string): string {
  const normalized = path.trim().replace(/^\/+|\/+$/g, '');
  if (!/^[a-z0-9][a-z0-9/_-]{0,119}$/.test(normalized) || normalized.includes('..')) {
    throw new Error('Wiki path must be a safe slug');
  }
  return normalized;
}

export async function publishWikiReport(input: {
  path: string;
  markdown: string;
  runId: string;
  apiToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ shareUrl: string }> {
  const path = validateWikiPath(input.path);
  if (!input.markdown.trim() || input.markdown.length > MAX_MARKDOWN) throw new Error('Wiki Markdown must be 1-100000 characters');
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Idempotency-Key': `open333-agent-${input.runId}`,
  };
  if (input.apiToken) headers.Authorization = `Bearer ${input.apiToken}`;
  const response = await fetchImpl(`${WIKI_BASE_URL}/api/${path}`, {
    method: 'POST', headers, body: JSON.stringify({ text: input.markdown, public: true, share: true }),
  });
  if (!response.ok) throw new Error(`Wiki publication failed (${response.status})`);
  const payload = wikiResponseSchema.parse(await response.json());
  const shareUrl = payload.shareUrl.startsWith('/share/') ? `${WIKI_BASE_URL}${payload.shareUrl}` : payload.shareUrl;
  if (!shareUrl.startsWith(`${WIKI_BASE_URL}/share/`)) throw new Error('Wiki response did not contain a public shareUrl');
  return { shareUrl };
}
