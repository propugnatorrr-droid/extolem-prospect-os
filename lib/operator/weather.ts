// Open-Meteo — free, no API key required.
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast"

export interface CurrentWeather {
  temperatureC: number
  windKph: number
  weatherCode: number
  isDay: boolean
}

const WEATHER_CODE_LABELS: Record<number, string> = {
  0: "clear",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "foggy",
  48: "foggy",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "rain showers",
  81: "rain showers",
  82: "violent rain showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with hail",
}

export function weatherLabel(code: number): string {
  return WEATHER_CODE_LABELS[code] || "unknown conditions"
}

export async function getCurrentWeather(lat: number, lon: number): Promise<CurrentWeather | null> {
  const url = `${WEATHER_URL}?latitude=${lat}&longitude=${lon}&current_weather=true`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = (await res.json()) as {
    current_weather?: { temperature: number; windspeed: number; weathercode: number; is_day: number }
  }
  if (!data.current_weather) return null
  return {
    temperatureC: data.current_weather.temperature,
    windKph: data.current_weather.windspeed,
    weatherCode: data.current_weather.weathercode,
    isDay: data.current_weather.is_day === 1,
  }
}
