import type { Trip } from "@/types/travel";

export interface DayWeatherContext {
  dayId: string;
  dayIndex: number;
  date: string;
  tempC: number;
  condition: string;
  icon: "sun" | "cloud" | "rain" | "overcast";
  isRainy: boolean;
  isHeavyRain: boolean;
  isExtremeHeat: boolean; // > 34°C
  advisory: string;
  recommendedAction?: "RAIN_PLAN" | "MOVE_INDOOR" | "REDUCE_WALKING";
}

export interface WeatherContext {
  days: DayWeatherContext[];
  hasRainAlert: boolean;
  hasHeatAlert: boolean;
  generalAdvisory: string;
}

export function buildWeatherContext(trip: Trip): WeatherContext {
  const days: DayWeatherContext[] = trip.days.map((day) => {
    const condition = day.weather?.condition || "晴";
    const tempC = day.weather?.tempC ?? 22;
    const isHeavyRain = condition.includes("大雨") || condition.includes("暴雨") || condition.includes("雷");
    const isRainy = condition.includes("雨") || day.weather?.icon === "rain" || isHeavyRain;
    const isExtremeHeat = tempC >= 34;

    let advisory = "适宜常规户外出行";
    let recommendedAction: DayWeatherContext["recommendedAction"] = undefined;

    if (isHeavyRain) {
      advisory = "强降雨天气，建议全天优先安排室内博物馆与室内商圈，避免山体步道与涉水户外，出行备好雨具。";
      recommendedAction = "RAIN_PLAN";
    } else if (isRainy) {
      advisory = "有降雨可能，建议准备雨具，午后露天景点可平滑替换为室内展馆，减少湿滑路段步行。";
      recommendedAction = "RAIN_PLAN";
    } else if (isExtremeHeat) {
      advisory = "午间气温较高，建议避开 12:00-15:00 露天烈日暴晒，多安排空调室内活动或轻轨/打车。";
      recommendedAction = "REDUCE_WALKING";
    }

    return {
      dayId: day.id,
      dayIndex: day.index,
      date: day.date,
      tempC,
      condition,
      icon: day.weather?.icon ?? "sun",
      isRainy,
      isHeavyRain,
      isExtremeHeat,
      advisory,
      recommendedAction,
    };
  });

  const hasRainAlert = days.some((d) => d.isRainy);
  const hasHeatAlert = days.some((d) => d.isExtremeHeat);

  let generalAdvisory = "天气整体良好，按计划出行即可。";
  if (hasRainAlert) {
    generalAdvisory = "行程期间有降雨预测，AI 已准备好下雨替代方案（博物馆与室内文化景点）。";
  } else if (hasHeatAlert) {
    generalAdvisory = "行程期间气温偏高，建议做好防晒并避免正午高强度暴走。";
  }

  return {
    days,
    hasRainAlert,
    hasHeatAlert,
    generalAdvisory,
  };
}
