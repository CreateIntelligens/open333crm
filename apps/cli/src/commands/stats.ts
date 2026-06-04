import { Flags } from '@oclif/core';
import { ApiClient } from '../api-client.js';
import { Open333Command } from '../base-command.js';
import { getProfile, resolveProfileName } from '../config-store.js';
import { readToken } from '../credential-store.js';
import { CliError } from '../errors.js';
import { consoleOutput, type CliOutput } from '../output.js';
import type {
  CliAgentPerformance,
  CliAnalyticsOverview,
  CliCaseStats,
  CliChannelAnalytics,
  CliMessageTrendPoint,
  CliStatsResponse,
} from '../types.js';

export interface StatsOptions {
  profile?: string;
  from?: string;
  to?: string;
  groupBy?: 'day' | 'week' | 'month';
  json?: boolean;
}

function appendQuery(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function formatNullable(value: number | null, suffix = ''): string {
  return value === null ? '-' : `${value}${suffix}`;
}

function sumDistribution(items: Array<{ value: number }>): number {
  return items.reduce((sum, item) => sum + item.value, 0);
}

export function formatStatsText(data: CliStatsResponse): string[] {
  const latestTrend = data.messageTrend.at(-1);
  return [
    'Overview',
    `  Messages: ${data.overview.totalMessages} (${data.overview.inboundMessages} inbound, ${data.overview.outboundMessages} outbound)`,
    `  Cases: ${data.overview.openCases} open, ${data.overview.newCases} new, ${data.overview.resolvedCases} resolved`,
    `  SLA achievement: ${formatNullable(data.overview.slaAchievementRate, '%')}`,
    `  CSAT: ${formatNullable(data.overview.csatAvg)} (${formatNullable(data.overview.csatPositiveRate, '%')} positive)`,
    '',
    'Trends',
    `  Latest period: ${latestTrend ? `${latestTrend.date} (${latestTrend.total} messages)` : '-'}`,
    `  Case trend points: ${data.cases.trend.length}`,
    `  SLA violations: ${data.cases.slaViolationCount}`,
    `  Channel messages: ${sumDistribution(data.channels.messagesByChannel)}`,
    '',
    'My Performance',
    `  Agent: ${data.my.name || data.my.agentId}`,
    `  Cases: ${data.my.casesHandled} handled, ${data.my.casesResolved} resolved, ${data.my.pendingCases} pending`,
    `  SLA soon expiring: ${data.my.slaSoonExpiring}`,
  ];
}

async function fetchStats(client: ApiClient, options: StatsOptions): Promise<CliStatsResponse> {
  const rangeParams = { from: options.from, to: options.to };
  const trendParams = { ...rangeParams, groupBy: options.groupBy ?? 'day' };

  const [overview, messageTrend, cases, channels, my] = await Promise.all([
    client.get<CliAnalyticsOverview>(appendQuery('/api/v1/cli/analytics/overview', rangeParams)),
    client.get<CliMessageTrendPoint[]>(appendQuery('/api/v1/cli/analytics/message-trend', trendParams)),
    client.get<CliCaseStats>(appendQuery('/api/v1/cli/analytics/cases', rangeParams)),
    client.get<CliChannelAnalytics>(appendQuery('/api/v1/cli/analytics/channels', rangeParams)),
    client.get<CliAgentPerformance>('/api/v1/cli/analytics/my'),
  ]);

  return { overview, messageTrend, cases, channels, my };
}

export async function statsCommand(options: StatsOptions, output: CliOutput = consoleOutput): Promise<void> {
  const profileName = resolveProfileName(options.profile);
  const profile = getProfile(profileName);
  if (!profile) throw new CliError(`Profile "${profileName}" is not configured. Run open333 login first.`, 'PROFILE_MISSING');

  const token = await readToken(profile.host, profile.profile);
  const client = new ApiClient({ host: profile.host, token });

  let data: CliStatsResponse;
  try {
    data = await fetchStats(client, options);
  } catch (err) {
    if (err instanceof CliError && err.status === 403) {
      throw new CliError(
        'Current CLI token cannot read analytics. Required scope: cli:analytics:read.',
        'INSUFFICIENT_SCOPE',
        403,
      );
    }
    throw err;
  }

  if (options.json) {
    output.log(JSON.stringify(data, null, 2));
    return;
  }

  for (const line of formatStatsText(data)) output.log(line);
}

export default class Stats extends Open333Command {
  static id = 'stats';
  static description = 'Show read-only CRM statistics for the current CLI profile';

  static flags = {
    help: Flags.help({ char: 'h' }),
    profile: Flags.string({ description: 'local profile name' }),
    from: Flags.string({ description: 'start date or timestamp for the reporting window' }),
    to: Flags.string({ description: 'end date or timestamp for the reporting window' }),
    'group-by': Flags.string({
      description: 'message trend grouping',
      options: ['day', 'week', 'month'],
      default: 'day',
      aliases: ['groupBy'],
    }),
    json: Flags.boolean({ description: 'print JSON output' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Stats);
    await statsCommand({
      profile: flags.profile,
      from: flags.from,
      to: flags.to,
      groupBy: flags['group-by'] as StatsOptions['groupBy'],
      json: flags.json,
    }, { log: this.log.bind(this) });
  }
}
