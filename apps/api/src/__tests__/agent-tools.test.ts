import assert from 'node:assert/strict';
import { getAgentToolDefinitions, executeAgentTool } from '../modules/ai/agent/tool-registry.js';
import { normalizeWeather } from '../modules/ai/agent/weather.js';
import { validateWikiPath } from '../modules/ai/agent/wiki.js';
import { publishWikiReport } from '../modules/ai/agent/wiki.js';

const names = getAgentToolDefinitions().map((tool) => tool.name);
assert.deepEqual(names, ['search_web', 'read_web_page', 'get_live_weather', 'publish_wiki_report']);
await assert.rejects(() => executeAgentTool('read_web_page', { url: 'http://127.0.0.1' }, {
  tenantId: 'tenant', runId: 'run', canPublishWiki: false,
}), /unsafe URL/);
await assert.rejects(() => executeAgentTool('publish_wiki_report', {
  path: 'report', markdown: '# Report',
}, { tenantId: 'tenant', runId: 'run', canPublishWiki: false }), /not authorized/);
assert.equal(validateWikiPath('reports/2026-08-28'), 'reports/2026-08-28');
assert.throws(() => validateWikiPath('../secrets'), /safe slug/);

const wikiResponse = await publishWikiReport({
  path: 'reports/test', markdown: '# Test', runId: 'run-1',
  fetchImpl: async (_url, init) => {
    assert.equal(init?.headers && new Headers(init.headers).get('X-Idempotency-Key'), 'open333-agent-run-1');
    return new Response(JSON.stringify({ url: 'https://wiki.david888.com/reports/test', shareUrl: '/share/public-1' }), { status: 200 });
  },
});
assert.deepEqual(wikiResponse, { shareUrl: 'https://wiki.david888.com/share/public-1' });

assert.deepEqual(normalizeWeather({
  current: {
    time: '2026-08-28T09:00',
    temperature_2m: 28.4,
    relative_humidity_2m: 70,
    weather_code: 1,
    wind_speed_10m: 12,
  },
  latitude: 25.03,
  longitude: 121.56,
  timezone: 'Asia/Taipei',
}), {
  latitude: 25.03,
  longitude: 121.56,
  timezone: 'Asia/Taipei',
  time: '2026-08-28T09:00',
  temperatureC: 28.4,
  humidityPercent: 70,
  weatherCode: 1,
  windSpeedKmh: 12,
});

console.log('agent-tools tests passed');
