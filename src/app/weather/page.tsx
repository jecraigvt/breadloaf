"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import {
  Thermometer,
  Wind,
  Droplets,
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudDrizzle,
  CloudFog,
  Loader2,
  RefreshCw,
  ArrowDown,
  ArrowUp,
} from "lucide-react";

interface CurrentWeather {
  temperature_2m: number;
  relative_humidity_2m: number;
  wind_speed_10m: number;
  weather_code: number;
}

interface DailyWeather {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
}

interface WeatherData {
  current: CurrentWeather;
  daily: DailyWeather;
}

const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=43.93&longitude=-72.99&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America/New_York&forecast_days=7";

function getWeatherInfo(code: number): {
  label: string;
  icon: React.ReactNode;
  bgClass: string;
} {
  // WMO Weather interpretation codes
  if (code === 0)
    return {
      label: "Clear sky",
      icon: <Sun size={24} />,
      bgClass: "from-yellow-400 to-orange-400",
    };
  if (code <= 3)
    return {
      label: code === 1 ? "Mainly clear" : code === 2 ? "Partly cloudy" : "Overcast",
      icon: <Cloud size={24} />,
      bgClass: "from-blue-300 to-blue-400",
    };
  if (code <= 49)
    return {
      label: "Fog",
      icon: <CloudFog size={24} />,
      bgClass: "from-stone-300 to-stone-400",
    };
  if (code <= 59)
    return {
      label: "Drizzle",
      icon: <CloudDrizzle size={24} />,
      bgClass: "from-blue-400 to-blue-500",
    };
  if (code <= 69)
    return {
      label: "Rain",
      icon: <CloudRain size={24} />,
      bgClass: "from-blue-500 to-blue-600",
    };
  if (code <= 79)
    return {
      label: "Snow",
      icon: <CloudSnow size={24} />,
      bgClass: "from-blue-200 to-blue-300",
    };
  if (code <= 84)
    return {
      label: "Rain showers",
      icon: <CloudRain size={24} />,
      bgClass: "from-blue-400 to-blue-600",
    };
  if (code <= 86)
    return {
      label: "Snow showers",
      icon: <CloudSnow size={24} />,
      bgClass: "from-blue-200 to-blue-400",
    };
  if (code <= 99)
    return {
      label: "Thunderstorm",
      icon: <CloudLightning size={24} />,
      bgClass: "from-purple-500 to-purple-700",
    };
  return {
    label: "Unknown",
    icon: <Cloud size={24} />,
    bgClass: "from-stone-400 to-stone-500",
  };
}

function getWeatherIcon(code: number, size: number = 20) {
  if (code === 0) return <Sun size={size} className="text-yellow-500" />;
  if (code <= 3) return <Cloud size={size} className="text-blue-400" />;
  if (code <= 49) return <CloudFog size={size} className="text-stone-400" />;
  if (code <= 59) return <CloudDrizzle size={size} className="text-blue-400" />;
  if (code <= 69) return <CloudRain size={size} className="text-blue-500" />;
  if (code <= 79) return <CloudSnow size={size} className="text-blue-300" />;
  if (code <= 84) return <CloudRain size={size} className="text-blue-500" />;
  if (code <= 86) return <CloudSnow size={size} className="text-blue-300" />;
  if (code <= 99) return <CloudLightning size={size} className="text-purple-500" />;
  return <Cloud size={size} className="text-stone-400" />;
}

function getDayName(dateStr: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
  });
}

function getFullDayName(dateStr: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default function WeatherPage() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchWeather = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(WEATHER_URL);
      if (!res.ok) throw new Error("Failed to fetch weather data");
      const data = await res.json();
      setWeather(data);
      setLastUpdated(new Date());
    } catch {
      setError("Could not load weather data. Please try again.");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchWeather();
  }, []);

  const currentInfo = weather
    ? getWeatherInfo(weather.current.weather_code)
    : null;

  return (
    <div>
      <Header
        title="Weather"
        subtitle="Current conditions at Breadloaf Hill, Vermont"
      />

      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {loading && !weather ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-green-700 mb-3" />
            <p className="text-stone-500 text-sm">Loading weather data...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <Cloud size={48} className="mx-auto text-stone-300 mb-3" />
            <p className="text-stone-500 font-medium">{error}</p>
            <button
              onClick={fetchWeather}
              className="mt-4 px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : weather && currentInfo ? (
          <>
            {/* Current conditions hero */}
            <div
              className={`bg-gradient-to-br ${currentInfo.bgClass} rounded-2xl p-6 sm:p-8 text-white shadow-lg`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    {currentInfo.icon}
                    <span className="text-white/90 font-medium">
                      {currentInfo.label}
                    </span>
                  </div>
                  <div className="text-6xl sm:text-7xl font-bold mt-3 tracking-tight">
                    {Math.round(weather.current.temperature_2m)}
                    <span className="text-3xl font-normal text-white/70">
                      °F
                    </span>
                  </div>
                </div>
                <button
                  onClick={fetchWeather}
                  disabled={loading}
                  className="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw
                    size={18}
                    className={loading ? "animate-spin" : ""}
                  />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-6">
                <div className="flex items-center gap-2">
                  <Wind size={18} className="text-white/70" />
                  <div>
                    <p className="text-white/70 text-xs">Wind</p>
                    <p className="font-semibold">
                      {Math.round(weather.current.wind_speed_10m)} mph
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Droplets size={18} className="text-white/70" />
                  <div>
                    <p className="text-white/70 text-xs">Humidity</p>
                    <p className="font-semibold">
                      {weather.current.relative_humidity_2m}%
                    </p>
                  </div>
                </div>
              </div>

              {lastUpdated && (
                <p className="text-white/50 text-xs mt-4">
                  Updated{" "}
                  {lastUpdated.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </div>

            {/* Today's high/low */}
            {weather.daily.time.length > 0 && (
              <div className="bg-white rounded-xl border border-stone-200 p-4 flex items-center justify-around">
                <div className="flex items-center gap-2 text-sm">
                  <ArrowUp size={16} className="text-red-400" />
                  <span className="text-stone-500">High</span>
                  <span className="font-bold text-stone-800 text-lg">
                    {Math.round(weather.daily.temperature_2m_max[0])}°
                  </span>
                </div>
                <div className="w-px h-8 bg-stone-200" />
                <div className="flex items-center gap-2 text-sm">
                  <ArrowDown size={16} className="text-blue-400" />
                  <span className="text-stone-500">Low</span>
                  <span className="font-bold text-stone-800 text-lg">
                    {Math.round(weather.daily.temperature_2m_min[0])}°
                  </span>
                </div>
                <div className="w-px h-8 bg-stone-200" />
                <div className="flex items-center gap-2 text-sm">
                  <CloudRain size={16} className="text-blue-400" />
                  <span className="text-stone-500">Precip</span>
                  <span className="font-bold text-stone-800 text-lg">
                    {weather.daily.precipitation_sum[0]}"
                  </span>
                </div>
              </div>
            )}

            {/* 7-day forecast */}
            <div>
              <h2 className="font-semibold text-stone-800 text-lg mb-3 flex items-center gap-2">
                <Thermometer size={18} className="text-stone-400" />
                7-Day Forecast
              </h2>

              {/* Mobile: list layout */}
              <div className="sm:hidden space-y-2">
                {weather.daily.time.map((date, i) => {
                  const code = weather.daily.weather_code[i];
                  const info = getWeatherInfo(code);
                  return (
                    <div
                      key={date}
                      className="bg-white rounded-xl border border-stone-200 p-4 flex items-center gap-4"
                    >
                      <div className="w-16 text-sm font-medium text-stone-700">
                        {getDayName(date, i)}
                      </div>
                      <div className="flex-shrink-0">
                        {getWeatherIcon(code, 24)}
                      </div>
                      <div className="flex-1 text-xs text-stone-500 truncate">
                        {info.label}
                      </div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="text-stone-800">
                          {Math.round(weather.daily.temperature_2m_max[i])}°
                        </span>
                        <span className="text-stone-400">
                          {Math.round(weather.daily.temperature_2m_min[i])}°
                        </span>
                      </div>
                      {weather.daily.precipitation_sum[i] > 0 && (
                        <div className="text-xs text-blue-500 flex items-center gap-0.5">
                          <CloudRain size={10} />
                          {weather.daily.precipitation_sum[i]}"
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop: card grid */}
              <div className="hidden sm:grid sm:grid-cols-7 gap-2">
                {weather.daily.time.map((date, i) => {
                  const code = weather.daily.weather_code[i];
                  const info = getWeatherInfo(code);
                  return (
                    <div
                      key={date}
                      className={`bg-white rounded-xl border p-3 text-center ${
                        i === 0
                          ? "border-green-300 bg-green-50/30"
                          : "border-stone-200"
                      }`}
                    >
                      <p
                        className={`text-xs font-medium mb-2 ${
                          i === 0 ? "text-green-700" : "text-stone-500"
                        }`}
                      >
                        {getDayName(date, i)}
                      </p>
                      <div className="flex justify-center mb-2">
                        {getWeatherIcon(code, 28)}
                      </div>
                      <p className="text-xs text-stone-400 mb-2 truncate">
                        {info.label}
                      </p>
                      <div className="text-sm">
                        <span className="font-bold text-stone-800">
                          {Math.round(weather.daily.temperature_2m_max[i])}°
                        </span>
                        <span className="text-stone-400 ml-1">
                          {Math.round(weather.daily.temperature_2m_min[i])}°
                        </span>
                      </div>
                      {weather.daily.precipitation_sum[i] > 0 && (
                        <p className="text-xs text-blue-500 mt-1 flex items-center justify-center gap-0.5">
                          <CloudRain size={10} />
                          {weather.daily.precipitation_sum[i]}"
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Attribution */}
            <p className="text-xs text-stone-400 text-center pt-2">
              Weather data from{" "}
              <a
                href="https://open-meteo.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-stone-600"
              >
                Open-Meteo
              </a>{" "}
              — Breadloaf Hill, VT (3995 VT Route 125)
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
