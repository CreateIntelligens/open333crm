import Conf from 'conf';

export interface ProfileMetadata {
  host: string;
  profile: string;
  agentId?: string;
  agentEmail?: string;
  agentName?: string;
  tenantId?: string;
  tokenPrefix?: string;
  tokenSuffix?: string;
  expiresAt?: string;
}

interface ConfigShape {
  defaultProfile?: string;
  profiles?: Record<string, ProfileMetadata>;
}

let config: Conf<ConfigShape> | undefined;

function getConfig(): Conf<ConfigShape> {
  config ??= new Conf<ConfigShape>({
    projectName: 'open333',
    defaults: {
      profiles: {},
    },
  });
  return config;
}

export function getProfile(profile = getConfig().get('defaultProfile') ?? 'default'): ProfileMetadata | undefined {
  return getConfig().get('profiles')?.[profile];
}

export function saveProfile(metadata: ProfileMetadata): void {
  const configStore = getConfig();
  const profiles = configStore.get('profiles') ?? {};
  configStore.set('profiles', {
    ...profiles,
    [metadata.profile]: metadata,
  });
  configStore.set('defaultProfile', metadata.profile);
}

export function resolveProfileName(profile?: string): string {
  return profile ?? getConfig().get('defaultProfile') ?? 'default';
}
