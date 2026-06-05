import { CliError } from './errors.js';

const SERVICE_NAME = 'open333';

interface KeytarModule {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

interface KeytarImport {
  default?: unknown;
}

function accountKey(host: string, profile: string): string {
  return `${profile}:${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
}

function isKeytarModule(value: unknown): value is KeytarModule {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<KeytarModule>;
  return (
    typeof candidate.setPassword === 'function'
    && typeof candidate.getPassword === 'function'
    && typeof candidate.deletePassword === 'function'
  );
}

async function loadKeytar(): Promise<KeytarModule> {
  try {
    const keytarImport = await import('keytar') as unknown as KeytarImport;
    if (isKeytarModule(keytarImport)) return keytarImport;
    if (isKeytarModule(keytarImport.default)) return keytarImport.default;
  } catch {
    throw new CliError(
      'OS keychain is unavailable. Install keychain support or set OPEN333_TOKEN explicitly for tests/CI.',
      'KEYCHAIN_UNAVAILABLE',
    );
  }

  throw new CliError(
    'OS keychain module loaded but does not expose the expected API. Reinstall @open333crm/cli dependencies.',
    'KEYCHAIN_UNAVAILABLE',
  );
}

export async function storeToken(host: string, profile: string, token: string): Promise<void> {
  const keytar = await loadKeytar();
  await keytar.setPassword(SERVICE_NAME, accountKey(host, profile), token);
}

export async function readToken(host: string, profile: string): Promise<string> {
  const envToken = process.env.OPEN333_TOKEN;
  if (envToken) return envToken;

  const keytar = await loadKeytar();
  const token = await keytar.getPassword(SERVICE_NAME, accountKey(host, profile));
  if (!token) {
    throw new CliError(`No local token found for profile "${profile}". Run open333 login first.`, 'TOKEN_MISSING');
  }
  return token;
}

export async function deleteToken(host: string, profile: string): Promise<void> {
  const keytar = await loadKeytar();
  await keytar.deletePassword(SERVICE_NAME, accountKey(host, profile));
}
