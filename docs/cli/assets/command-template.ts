// Command Template for Open333CRM CLI
// Copy to src/commands/<name>.ts and customize

import { Flags } from '@oclif/core';
import { ApiClient } from '../api-client.js';
import { Open333Command } from '../base-command.js';
import { getProfile, resolveProfileName } from '../config-store.js';
import { readToken } from '../credential-store.js';
import { CliError } from '../errors.js';
import { consoleOutput, type CliOutput } from '../output.js';
// import type { YourResponseType } from '../types.js';  // Add your types

// ============================================
// 1. DEFINE OPTIONS INTERFACE
// ============================================
export interface <CommandName>Options {
  profile?: string;
  json?: boolean;
  // Add custom flags here
  // filter?: string;
  // limit?: number;
}

// ============================================
// 2. PURE COMMAND FUNCTION (testable, reusable)
// ============================================
export async function <commandName>Command(
  options: <CommandName>Options,
  output: CliOutput = consoleOutput
): Promise<void> {
  // Resolve profile
  const profileName = resolveProfileName(options.profile);
  const profile = getProfile(profileName);
  if (!profile) {
    throw new CliError(
      `Profile "${profileName}" is not configured. Run open333 login first.`,
      'PROFILE_MISSING'
    );
  }

  // Get authenticated client
  const token = await readToken(profile.host, profile.profile);
  const client = new ApiClient({ host: profile.host, token });

  // Make API call(s)
  let data: YourResponseType;
  try {
    // Replace with your endpoint
    data = await client.get<YourResponseType>('/api/v1/cli/your-endpoint');
  } catch (err) {
    if (err instanceof CliError && err.status === 403) {
      throw new CliError(
        'Current CLI token cannot access this endpoint. Required scope: cli:your-scope:read.',
        'INSUFFICIENT_SCOPE',
        403
      );
    }
    throw err;
  }

  // Output handling
  if (options.json) {
    output.log(JSON.stringify(data, null, 2));
    return;
  }

  // Format human-readable output
  for (const item of data.items) {
    output.log(`${item.id}  ${item.name}  ${item.status}`);
  }
}

// ============================================
// 3. OCLIF COMMAND CLASS
// ============================================
export default class <CommandName> extends Open333Command {
  static id = '<command-name>';           // kebab-case: 'my-command'
  static description = 'Description of what this command does';

  static flags = {
    help: Flags.help({ char: 'h' }),
    profile: Flags.string({ description: 'local profile name' }),
    json: Flags.boolean({ description: 'print JSON output' }),
    // Add custom flags:
    // filter: Flags.string({ char: 'f', description: 'filter by name' }),
    // limit: Flags.integer({ char: 'l', default: 20, description: 'max results' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(<CommandName>);
    await <commandName>Command(
      {
        profile: flags.profile,
        json: flags.json,
        // filter: flags.filter,
        // limit: flags.limit,
      },
      { log: this.log.bind(this) }
    );
  }
}