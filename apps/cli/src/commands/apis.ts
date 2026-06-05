import { Flags } from '@oclif/core';
import { ApiClient } from '../api-client.js';
import { Open333Command } from '../base-command.js';
import { getProfile, resolveProfileName } from '../config-store.js';
import { readToken } from '../credential-store.js';
import { CliError } from '../errors.js';
import { consoleOutput, type CliOutput } from '../output.js';
import type { CliApisResponse } from '../types.js';

export interface ApisOptions {
  profile?: string;
  json?: boolean;
}

export async function apisCommand(options: ApisOptions, output: CliOutput = consoleOutput): Promise<void> {
  const profileName = resolveProfileName(options.profile);
  const profile = getProfile(profileName);
  if (!profile) throw new CliError(`Profile "${profileName}" is not configured. Run open333 login first.`, 'PROFILE_MISSING');

  const token = await readToken(profile.host, profile.profile);
  const client = new ApiClient({ host: profile.host, token });
  const data = await client.get<CliApisResponse>('/api/v1/cli/apis');

  if (options.json) {
    output.log(JSON.stringify(data, null, 2));
    return;
  }

  output.log(`Token: ${data.token.tokenPrefix}...${data.token.tokenSuffix}`);
  output.log(`Scopes: ${data.token.scopes.join(', ') || '(none)'}`);
  output.log('');
  for (const capability of data.capabilities) {
    output.log(capability.name);
    output.log(`  ${capability.description}`);
    output.log(`  Scopes: ${capability.scopes.join(', ')}`);
    for (const endpoint of capability.endpoints) {
      output.log(`  ${endpoint.method} ${endpoint.path} - ${endpoint.name}`);
      output.log(`    ${endpoint.description}`);
      for (const [key, param] of Object.entries(endpoint.params)) {
        output.log(`    ${key}: ${param.desc} (example: ${JSON.stringify(param.value)})`);
      }
    }
  }
}

export default class Apis extends Open333Command {
  static id = 'apis';
  static description = 'List CLI token endpoints and capabilities';

  static flags = {
    help: Flags.help({ char: 'h' }),
    profile: Flags.string({ description: 'local profile name' }),
    json: Flags.boolean({ description: 'print JSON output' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Apis);
    await apisCommand(flags, { log: this.log.bind(this) });
  }
}
