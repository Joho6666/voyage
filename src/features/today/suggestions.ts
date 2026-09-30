import type { Trip } from "@/types/travel";
import { buildWeatherContext } from "@/services/weather/context";
import { dayStats } from "@/services/routing";
import { weatherDisplay } from "@/lib/weather-display";

/**
 * Deterministic, rule-based next-step suggestions for the today screen.
 * These are NOT model output — they are computed from trip facts so the
 * agent can proactively pull the traveller instead of waiting to be found.
 * Priority order: weather safety → gaps in the plan → money → effort →
 * never-fetched data → pre-departure tasks. At most `max` are returned.
 */
export interface TodaySuggestion {
  id: string;
  /** Chip text shown to the traveller. */
  label: string;
  /** Message sent to the agent when the chip is tapped (day-scoped where relevant). */
  message: string;
}

const HEAVY_WALK_MINUTES = 90;

export function suggestTodayActions(trip: Trip, focusedDayId: string | null, todayIso: string, max = 3): TodaySuggestion[] {
  const suggestions: TodaySuggestion[] = [];
  const notStarted = todayIso < trip.startDate;
  const weather = buildWeatherContext(trip);
  const dayLabel = (dayId: string) => {
    const day = trip.days.find((candidate) => candidate.id === dayId);
    return day ? `Day ${day.index + 1}` : "某天";
  };

  // 1. Weather safety: rain or extreme heat on today/upcoming days.
  for (const day of weather.days) {
    if (suggestions.length >= max) break;
    if (day.date < todayIso) continue;
    const known = weatherDisplay(trip.days.find((candidate) => candidate.id === day.dayId)?.weather).known;
    if (!known) continue;
    if (day.isRainy) {
      suggestions.push({
        id: `rain-${day.dayId}`,
        label: `${day.date.slice(5)} 有雨，换室内方案`,
        message: `[dayId:${day.dayId}] ${day.date} 有雨，把那天的露天安排换成室内方案`,
      });
    } else if (day.isExtremeHeat) {
      suggestions.push({
        id: `heat-${day.dayId}`,
        label: `${day.date.slice(5)} 高温 ${day.tempC}°C，避晒调整`,
        message: `[dayId:${day.dayId}] ${day.date} 高温，把午间安排调整成室内或减少暴晒`,
      });
    }
  }

  // 2. An empty day first (a whole missing day beats a sparse one).
  for (const day of trip.days) {
    if (suggestions.length >= max) break;
    if (dayStats(trip, day.id).places === 0) {
      suggestions.push({
        id: `empty-${day.id}`,
        label: `${dayLabel(day.id)} 还空着，补一天安排`,
        message: `[dayId:${day.id}] Day ${day.index + 1}（${day.date}）还是空的，按我的偏好补一天安排`,
      });
      break;
    }
  }

  // 3. A sparse upcoming day (a single stop is rarely a full day).
  for (const day of trip.days) {
    if (suggestions.length >= max) break;
    if (day.date < todayIso) continue;
    if (dayStats(trip, day.id).places <= 1) {
      suggestions.push({
        id: `thin-${day.id}`,
        label: `${dayLabel(day.id)} 只排了 1 个点，要不要补充`,
        message: `[dayId:${day.id}] Day ${day.index + 1} 排得太松了，帮我再补一个顺路的点`,
      });
      break;
    }
  }

  // 4. Budget overrun.
  if (trip.estimatedSpend > trip.budget) {
    suggestions.push({
      id: "budget-over",
      label: `预估超预算 ¥${trip.estimatedSpend - trip.budget}，省一点`,
      message: "预估花费已经超过总预算了，帮我在今天的安排里省一点",
    });
  }

  // 5. Heavy walking on the focused day.
  const focusedStats = focusedDayId ? dayStats(trip, focusedDayId) : null;
  if (focusedStats && focusedStats.walkMin > HEAVY_WALK_MINUTES) {
    suggestions.push({
      id: "heavy-walk",
      label: `今天步行约 ${focusedStats.walkMin} 分钟，减负`,
      message: `[dayId:${focusedDayId}] 今天步行时间太长了，帮我砍一站或少走一点`,
    });
  }

  // 6. Provider quotes never fetched.
  if (!trip.offers?.length && !trip.offerProviderStatus) {
    suggestions.push({
      id: "offers-never",
      label: "还没看过酒店 / 车票报价，查一下",
      message: "帮我查一下这趟行程的酒店、车票和门票报价",
    });
  }

  // 7. Pre-departure tasks outstanding.
  if (notStarted) {
    const pending = trip.tasks.filter((task) => task.group === "before" && task.status !== "done");
    if (pending.length > 0) {
      suggestions.push({
        id: "tasks-pending",
        label: `出发前还有 ${pending.length} 件事没办`,
        message: `出发前还有 ${pending.length} 件事没办：${pending.slice(0, 3).map((task) => task.title).join("、")}。帮我按优先级排一下`,
      });
    }
  }

  return suggestions.slice(0, max);
}
