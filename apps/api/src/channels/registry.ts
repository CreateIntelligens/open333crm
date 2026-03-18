import type { ChannelPlugin } from './base.plugin.js';

const plugins = new Map<string, ChannelPlugin>();

export function registerChannelPlugin(plugin: ChannelPlugin): void {
  plugins.set(plugin.channelType, plugin);
}

export function getChannelPlugin(channelType: string): ChannelPlugin | undefined {
  return plugins.get(channelType);
}

export function getAllChannelPlugins(): ChannelPlugin[] {
  return Array.from(plugins.values());
}

export function hasChannelPlugin(channelType: string): boolean {
  return plugins.has(channelType);
}
