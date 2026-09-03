export interface WeatherDay {
  date: string;
  tempC: number;
  condition: string;
  icon: "sun" | "cloud" | "rain" | "overcast";
}

export interface WeatherProvider {
  getForecast(city: string): Promise<WeatherDay[]>;
}
