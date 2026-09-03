import { z } from 'zod';
import type { ToolDefinition } from '../providers/types.js';
import { readThrough2md, searchThrough2md } from './web-client.js';
import { getLiveWeather } from './weather.js';
import { publishWikiReport } from './wiki.js';
import type { TenantDb } from '../../../lib/tenant-db.js';

export interface AgentToolContext {
  tenantId: string;
  runId: string;
  canPublishWiki: boolean;
  wikiApiToken?: string;
  fetchImpl?: typeof fetch;
  prisma?: TenantDb;
  onWikiPublished?: (input: { path: string; markdown: string; shareUrl: string }) => Promise<void>;
}

const schemas = {
  search_web: z.object({ query: z.string().trim().min(1).max(500) }),
  read_web_page: z.object({ url: z.string().url().max(2_000) }),
  get_live_weather: z.object({ location: z.string().trim().min(1).max(200) }),
  publish_wiki_report: z.object({
    path: z.string().trim().min(1).max(120),
    markdown: z.string().trim().min(1).max(100_000),
  }),
} as const;

const definitions: ToolDefinition[] = [
  { name: 'search_web', description: 'Search the live web for current facts. Use for time-sensitive or external information.', parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string', minLength: 1, maxLength: 500 } } } },
  { name: 'read_web_page', description: 'Read one public web page as Markdown after a URL is known.', parameters: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri', maxLength: 2_000 } } } },
  { name: 'get_live_weather', description: 'Get current weather for a named location.', parameters: { type: 'object', required: ['location'], properties: { location: { type: 'string', minLength: 1, maxLength: 200 } } } },
  { name: 'publish_wiki_report', description: 'Publish a completed long-form Markdown report to David888 Wiki and return its public share URL. Use only when the user requests a report or publication.', parameters: { type: 'object', required: ['path', 'markdown'], properties: { path: { type: 'string', maxLength: 120 }, markdown: { type: 'string', maxLength: 100_000 } } } },
];

export function getAgentToolDefinitions(options: { canPublishWiki?: boolean } = {}): ToolDefinition[] {
  return definitions.filter((tool) => options.canPublishWiki !== false || tool.name !== 'publish_wiki_report').map((tool) => ({ ...tool, parameters: JSON.parse(JSON.stringify(tool.parameters)) }));
}

export async function executeAgentTool(name: string, rawArgs: unknown, context: AgentToolContext): Promise<unknown> {
  if (!(name in schemas)) throw new Error(`Unknown Agent tool: ${name}`);
  if (name === 'publish_wiki_report' && !context.canPublishWiki) throw new Error('Agent is not authorized to publish Wiki reports');
  switch (name) {
    case 'search_web': return searchThrough2md(schemas.search_web.parse(rawArgs).query, context.fetchImpl);
    case 'read_web_page': return readThrough2md(schemas.read_web_page.parse(rawArgs).url, context.fetchImpl);
    case 'get_live_weather': return getLiveWeather(schemas.get_live_weather.parse(rawArgs).location, context.fetchImpl);
    case 'publish_wiki_report': {
      const args = schemas.publish_wiki_report.parse(rawArgs);
      const published = await publishWikiReport({ ...args, runId: context.runId, apiToken: context.wikiApiToken, fetchImpl: context.fetchImpl });
      await context.onWikiPublished?.({ ...args, shareUrl: published.shareUrl });
      return published;
    }
  }
}
