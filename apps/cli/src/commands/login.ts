import { input, password } from '@inquirer/prompts';
import { Flags } from '@oclif/core';
import { ApiClient } from '../api-client.js';
import { Open333Command } from '../base-command.js';
import { saveProfile } from '../config-store.js';
import { storeToken } from '../credential-store.js';
import { consoleOutput, type CliOutput } from '../output.js';
import type { CliLoginResponse } from '../types.js';

export interface LoginOptions {
  host?: string;
  email?: string;
  profile?: string;
}

export async function loginCommand(options: LoginOptions, output: CliOutput = consoleOutput): Promise<void> {
  const host = (options.host ?? await input({ message: 'Host', default: 'http://localhost:3001' })).replace(/\/+$/, '');
  const email = options.email ?? await input({ message: 'Email' });
  const rawPassword = await password({ message: 'Password', mask: '*' });
  const profile = options.profile ?? 'default';

  const client = new ApiClient({ host });
  const data = await client.post<CliLoginResponse>('/api/v1/auth/cli/login', {
    email,
    password: rawPassword,
    profile,
    name: profile,
  });

  await storeToken(host, profile, data.token);
  saveProfile({
    host,
    profile,
    agentId: data.agent.id,
    agentEmail: data.agent.email,
    agentName: data.agent.name,
    tenantId: data.agent.tenantId,
    tokenPrefix: data.session.tokenPrefix,
    tokenSuffix: data.session.tokenSuffix,
    expiresAt: data.session.expiresAt,
  });

  output.log(`Logged in as ${data.agent.email}`);
  output.log(`Profile: ${profile}`);
  output.log(`Token: ${data.session.tokenPrefix}...${data.session.tokenSuffix}`);
}

export default class Login extends Open333Command {
  static id = 'login';
  static description = 'Log in and store a CLI-scoped token';

  static flags = {
    help: Flags.help({ char: 'h' }),
    host: Flags.string({ description: 'Open333 API host' }),
    email: Flags.string({ description: 'agent email' }),
    profile: Flags.string({ description: 'local profile name', default: 'default' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Login);
    await loginCommand(flags, { log: this.log.bind(this) });
  }
}
