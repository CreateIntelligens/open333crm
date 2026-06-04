import { Flags } from '@oclif/core';
import { ApiClient } from '../api-client.js';
import { Open333Command } from '../base-command.js';
import { getProfile, resolveProfileName } from '../config-store.js';
import { readToken } from '../credential-store.js';
import { CliError } from '../errors.js';
import { consoleOutput, type CliOutput } from '../output.js';
import type { MeResponse } from '../types.js';

export interface StatusOptions {
  profile?: string;
  json?: boolean;
}

export async function statusCommand(options: StatusOptions, output: CliOutput = consoleOutput): Promise<void> {
  const profileName = resolveProfileName(options.profile);
  const profile = getProfile(profileName);
  if (!profile) throw new CliError(`Profile "${profileName}" is not configured. Run open333 login first.`, 'PROFILE_MISSING');

  const healthClient = new ApiClient({ host: profile.host });
  const health = await healthClient.health();
  const token = await readToken(profile.host, profile.profile);
  const authedClient = new ApiClient({ host: profile.host, token });
  const me = await authedClient.get<MeResponse>('/api/v1/auth/me');

  if (options.json) {
    output.log(JSON.stringify({ host: profile.host, profile: profile.profile, health, agent: me }, null, 2));
    return;
  }

  output.log(`Host: ${profile.host}`);
  output.log('Health: ok');
  output.log(`Agent: ${me.name} <${me.email}>`);
  output.log(`Tenant: ${me.tenantId}`);
}

export default class Status extends Open333Command {
  static id = 'status';
  static description = 'Check server health and current identity';

  static flags = {
    help: Flags.help({ char: 'h' }),
    profile: Flags.string({ description: 'local profile name' }),
    json: Flags.boolean({ description: 'print JSON output' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    await statusCommand(flags, { log: this.log.bind(this) });
  }
}
