#!/usr/bin/env node
/**
 * Open333CLI Command Scaffold Generator
 * Usage: npx tsx scaffold-command.ts <command-name> <description> [--scope <scope>]
 *
 * Generates:
 * - apps/cli/src/commands/<name>.ts (command function + class)
 * - Updates apps/cli/src/commands.ts (import + registry)
 * - Updates apps/cli/src/types.ts (placeholder types)
 * - Creates test file
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(__dirname, "../../apps/cli");
const SRC = resolve(CLI_ROOT, "src");
const COMMANDS_DIR = resolve(SRC, "commands");
const TESTS_DIR = resolve(SRC, "__tests__");

function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function kebabToPascal(str: string): string {
  return str
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

function generateCommand(
  name: string,
  description: string,
  scope: string,
): string {
  const camel = kebabToCamel(name);
  const pascal = kebabToPascal(name);
  const typeName = `${pascal}Response`;
  const optionsType = `${pascal}Options`;

  return `import { Flags } from '@oclif/core';
import { ApiClient } from '../api-client.js';
import { Open333Command } from '../base-command.js';
import { getProfile, resolveProfileName } from '../config-store.js';
import { readToken } from '../credential-store.js';
import { CliError } from '../errors.js';
import { consoleOutput, type CliOutput } from '../output.js';
import type { ${typeName} } from '../types.js';

export interface ${optionsType} {
  profile?: string;
  json?: boolean;
  // Add custom flags here
  // filter?: string;
}

export async function ${camel}Command(options: ${optionsType}, output: CliOutput = consoleOutput): Promise<void> {
  const profileName = resolveProfileName(options.profile);
  const profile = getProfile(profileName);
  if (!profile) throw new CliError(\`Profile "\${profileName}" is not configured. Run open333 login first.\`, 'PROFILE_MISSING');

  const token = await readToken(profile.host, profile.profile);
  const client = new ApiClient({ host: profile.host, token });
  const data = await client.get<${typeName}>('/api/v1/cli/${name.replace(/_/g, "-")}');

  if (options.json) {
    output.log(JSON.stringify(data, null, 2));
    return;
  }

  // TODO: Format text output
  // for (const item of data.items) output.log(\`\${item.id}  \${item.name}\`);
  output.log(JSON.stringify(data, null, 2)); // placeholder
}

export default class ${pascal} extends Open333Command {
  static id = '${name}';
  static description = '${description}';

  static flags = {
    help: Flags.help({ char: 'h' }),
    profile: Flags.string({ description: 'local profile name' }),
    json: Flags.boolean({ description: 'print JSON output' }),
    // Add custom flags here
    // filter: Flags.string({ description: 'filter by name' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(${pascal});
    await ${camel}Command(flags, { log: this.log.bind(this) });
  }
}
`;
}

function generateTypes(name: string): string {
  const pascal = kebabToPascal(name);
  const typeName = `${pascal}Response`;

  return `export interface ${typeName} {
  // TODO: Define response structure
  items: Array<{ id: string; name: string; status: string }>;
  total: number;
}
`;
}

function generateTest(name: string): string {
  const camel = kebabToCamel(name);
  const pascal = kebabToPascal(name);

  return `import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ${camel}Command } from '../commands/${name}.js';
import { CliError } from '../errors.js';

vi.mock('../config-store.js', () => ({ getProfile: vi.fn(), resolveProfileName: vi.fn() }));
vi.mock('../credential-store.js', () => ({ readToken: vi.fn() }));
vi.mock('../api-client.js', () => ({
  ApiClient: vi.fn().mockImplementation(() => ({ get: vi.fn() })),
}));

describe('${camel}Command', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws PROFILE_MISSING when profile not configured', async () => {
    const { getProfile } = await import('../config-store.js');
    vi.mocked(getProfile).mockReturnValue(undefined);

    await expect(${camel}Command({})).rejects.toThrow(CliError);
  });

  // TODO: Add more tests
  // it('calls API and formats output', async () => { ... });
});
`;
}

function updateCommandsTs(name: string): void {
  const commandsTs = resolve(SRC, "commands.ts");
  let content = readFileSync(commandsTs, "utf-8");
  const pascal = kebabToPascal(name);

  // Add import
  if (!content.includes(`import ${pascal} from './commands/${name}.js`)) {
    const importLine = `import ${pascal} from './commands/${name}.js';\n`;
    content = content.replace(
      /^(import .+ from '\.\/commands\/.+\.js';\n)+/,
      (match) => match + importLine,
    );
  }

  // Add to registry
  if (!content.includes(`'${name}': ${pascal}`)) {
    content = content.replace(
      /export default \{([\s\S]+?)\}/,
      (match, inner) => `export default {${inner}  '${name}': ${pascal},\n}`,
    );
  }

  writeFileSync(commandsTs, content);
  console.log(`✅ Updated ${commandsTs}`);
}

function updateTypesTs(name: string): void {
  const typesTs = resolve(SRC, "types.ts");
  let content = readFileSync(typesTs, "utf-8");
  const typeDef = generateTypes(name);

  if (!content.includes(typeDef.trim().split("\n")[0])) {
    // Insert before last line (export {})
    content = content.replace(/(\n)?$/, `\n${typeDef}$1`);
    writeFileSync(typesTs, content);
    console.log(`✅ Updated ${typesTs}`);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: tsx scaffold-command.ts <command-name> <description> [--scope <scope>]",
    );
    console.error(
      'Example: tsx scaffold-command.ts case-list "List cases" --scope cli:cases:read',
    );
    process.exit(1);
  }

  const name = args[0];
  const description = args[1];
  const scopeIdx = args.indexOf("--scope");
  const scope =
    scopeIdx !== -1 ? args[scopeIdx + 1] : `cli:${name.split("-")[0]}:read`;

  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(
      "Command name must be kebab-case (e.g., case-list, contact-search)",
    );
    process.exit(1);
  }

  const commandFile = resolve(COMMANDS_DIR, `${name}.ts`);
  const testFile = resolve(TESTS_DIR, `${name}-command.test.ts`);

  if (existsSync(commandFile)) {
    console.error(`Command ${name} already exists at ${commandFile}`);
    process.exit(1);
  }

  // Generate files
  writeFileSync(commandFile, generateCommand(name, description, scope));
  console.log(`✅ Created ${commandFile}`);

  writeFileSync(testFile, generateTest(name));
  console.log(`✅ Created ${testFile}`);

  updateCommandsTs(name);
  updateTypesTs(name);

  console.log("\n📋 Next steps:");
  console.log(`1. Add scope "${scope}" to cli-session.service.ts`);
  console.log(`2. Add capability to cli-endpoints.ts with scope: ["${scope}"]`);
  console.log(
    `3. Add route to cli.routes.ts with hasCurrentCliScope check for "${scope}"`,
  );
  console.log(`4. Edit ${commandFile} to implement the actual logic`);
  console.log(
    `5. Run: pnpm --filter @open333crm/cli build && pnpm --filter @open333crm/cli dev -- ${name} --help`,
  );
}

main();
