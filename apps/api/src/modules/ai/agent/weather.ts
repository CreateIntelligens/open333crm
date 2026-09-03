import { z } from 'zod';
import { readBoundedText } from './web-client.js';

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const weatherSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    relative_humidity_2m: z.number(),
    weather_code: z.number().int(),
    wind_speed_10m: z.number(),
  }),
});

export interface LiveWeather {
  latitude: number;
  longitude: number;
  timezone: string;
  time: string;
  temperatureC: number;
  humidityPercent: number;
  weatherCode: number;
  windSpeedKmh: number;
}

export function normalizeWeather(payload: unknown): LiveWeather {
  const value = weatherSchema.parse(payload);
  return {
    latitude: value.latitude,
    longitude: value.longitude,
    timezone: value.timezone,
    time: value.current.time,
    temperatureC: value.current.temperature_2m,
    humidityPercent: value.current.relative_humidity_2m,
    weatherCode: value.current.weather_code,
    windSpeedKmh: value.current.wind_speed_10m,
  };
}

export async function getLiveWeather(location: string, fetchImpl: typeof fetch = fetch): Promise<LiveWeather & { location: string }> {
  const name = location.trim();
  if (!name || name.length > 200) throw new Error('Location must be 1-200 characters');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const geo = await fetchImpl(`${GEOCODING_URL}?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`, { signal: controller.signal });
    if (!geo.ok) throw new Error(`weather geocoding responded ${geo.status}`);
    const geoBody = await readBoundedText(geo.body, 20_000);
    const geoJson = JSON.parse(geoBody.text) as { results?: Array<{ latitude: number; longitude: number; name?: string }> };
    const place = geoJson.results?.[0];
    if (!place || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') throw new Error('Location was not found');
    const params = new URLSearchParams({
      latitude: String(place.latitude), longitude: String(place.longitude), timezone: 'auto',
      current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
    });
    const forecast = await fetchImpl(`${FORECAST_URL}?${params}`, { signal: controller.signal });
    if (!forecast.ok) throw new Error(`weather forecast responded ${forecast.status}`);
    const forecastBody = await readBoundedText(forecast.body, 20_000);
    return { location: place.name ?? name, ...normalizeWeather(JSON.parse(forecastBody.text)) };
  } finally {
    clearTimeout(timer);
  }
}
