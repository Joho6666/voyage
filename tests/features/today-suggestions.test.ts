import { describe, expect, it } from "vitest";
import { suggestTodayActions, type TodaySuggestion } from "@/features/today/suggestions";
import type { Place, RouteSegment, Task, Trip } from "@/types/travel";

const TODAY = "2030-05-01";

function place(id: string, category: Place["category"] = "attraction"): Place {
  return {
    id, name: `地点 ${id}`, category, lat: 29.56, lng: 106.57, rating: 4.5, reviewCount: 10,
    image: "", priceLevel: 1, address: "测试地址", openingStatus: "unknown", stayMinutes: 60,
    description: "", tags: [], district: "", source: "amap", sourceId: id,
    provenance: { source: "amap", estimated: false },
  };
}

function makeTrip(overrides: {
  days?: Trip["days"];
  items?: Trip["items"];
  segments?: RouteSegment[];
  weather?: Trip["days"][number]["weather"][];
  tasks?: Task[];
  budget?: number;
  estimatedSpend?: number;
  offers?: Trip["offers"];
  startDate?: string;
  endDate?: string;
} = {}): Trip {
  const days = overrides.days ?? [
    { id: "day-1", tripId: "trip-1", index: 0, date: "2030-05-01", title: "第一天", summary: "", weather: { tempC: 24, condition: "晴", icon: "sun" } },
    { id: "day-2", tripId: "trip-1", index: 1, date: "2030-05-02", title: "第二天", summary: "", weather: { tempC: 22, condition: "多云", icon: "cloud" } },
    { id: "day-3", tripId: "trip-1", index: 2, date: "2030-05-03", title: "第三天", summary: "", weather: { tempC: 22, condition: "多云", icon: "cloud" } },
  ];
  overrides.weather?.forEach((weather, index) => {
    if (weather && days[index]) days[index] = { ...days[index], weather };
  });
  return {
    id: "trip-1",
    title: "测试行程",
    destination: "重庆",
    origin: "桂林",
    startDate: overrides.startDate ?? "2030-05-01",
    endDate: overrides.endDate ?? "2030-05-03",
    travelers: 2,
    budget: overrides.budget ?? 2500,
    estimatedSpend: overrides.estimatedSpend ?? 2000,
    coverImage: "",
    vibe: [],
    prompt: "",
    days,
    items: overrides.items ?? [],
    segments: overrides.segments ?? [],
    places: [place("p-1")],
    hotels: [],
    restaurants: [],
    activities: [],
    transports: [],
    tasks: overrides.tasks ?? [],
    budgetItems: [],
    ...(overrides.offers !== undefined ? { offers: overrides.offers } : {}),
  };
}

function ids(suggestions: TodaySuggestion[]) {
  return suggestions.map((s) => s.id);
}

describe("suggestTodayActions", () => {
  it("flags rainy upcoming days first, with a day-scoped message", () => {
    const trip = makeTrip({
      weather: [
        { condition: "晴", tempC: 24, icon: "sun", provenance: { source: "amap", estimated: false }, fetchedAt: TODAY },
        { condition: "大雨", tempC: 20, icon: "rain", provenance: { source: "amap", estimated: false }, fetchedAt: TODAY },
        { condition: "多云", tempC: 22, icon: "cloud", provenance: { source: "amap", estimated: false }, fetchedAt: TODAY },
      ],
    });
    const suggestions = suggestTodayActions(trip, "day-1", TODAY);
    expect(ids(suggestions)[0]).toBe("rain-day-2");
    expect(suggestions[0].message).toContain("[dayId:day-2]");
    expect(suggestions[0].label).toContain("有雨");
  });

  it("ignores unknown-weather sentinels when suggesting rain plans", () => {
    const trip = makeTrip({
      weather: [
        { condition: "天气未知", tempC: 0, icon: "cloud", provenance: { source: "unavailable", estimated: true, reason: "no provider" }, fetchedAt: TODAY },
        { condition: "天气未知", tempC: 0, icon: "cloud", provenance: { source: "unavailable", estimated: true, reason: "no provider" }, fetchedAt: TODAY },
        { condition: "天气未知", tempC: 0, icon: "cloud", provenance: { source: "unavailable", estimated: true, reason: "no provider" }, fetchedAt: TODAY },
      ],
    });
    expect(ids(suggestTodayActions(trip, "day-1", TODAY))).not.toContain("rain-day-2");
  });

  it("suggests filling an empty day", () => {
    const trip = makeTrip({
      items: [
        { id: "it-1", dayId: "day-1", type: "place", placeId: "p-1", startTime: "09:30", duration: 60, order: 0, status: "planned" },
      ],
    });
    const suggestions = suggestTodayActions(trip, "day-1", TODAY);
    expect(ids(suggestions)).toContain("empty-day-2");
  });

  it("suggests saving money when the estimate exceeds the budget", () => {
    const trip = makeTrip({ budget: 1000, estimatedSpend: 1500 });
    const suggestions = suggestTodayActions(trip, "day-1", TODAY);
    const over = suggestions.find((s) => s.id === "budget-over");
    expect(over?.label).toContain("¥500");
  });

  it("suggests a price check only when offers were never fetched", () => {
    const neverFetched = makeTrip();
    expect(ids(suggestTodayActions(neverFetched, "day-1", TODAY))).toContain("offers-never");

    const fetched = makeTrip({ offers: [{ id: "offer-1", kind: "hotel", title: "测试酒店", provider: "meituan", fetchedAt: TODAY }] as Trip["offers"] });
    expect(ids(suggestTodayActions(fetched, "day-1", TODAY))).not.toContain("offers-never");
  });

  it("suggests pre-departure task triage only before the trip starts", () => {
    const tasks: Task[] = [
      { id: "t-1", tripId: "trip-1", title: "买高铁票", group: "before", status: "todo" },
      { id: "t-2", tripId: "trip-1", title: "订酒店", group: "before", status: "todo" },
    ];
    const base = {
      items: [
        { id: "it-1", dayId: "day-1", type: "place", placeId: "p-1", startTime: "09:30", duration: 60, order: 0, status: "planned" },
        { id: "it-2", dayId: "day-1", type: "place", placeId: "p-1", startTime: "11:00", duration: 60, order: 1, status: "planned" },
        { id: "it-3", dayId: "day-2", type: "place", placeId: "p-1", startTime: "09:30", duration: 60, order: 0, status: "planned" },
        { id: "it-4", dayId: "day-2", type: "place", placeId: "p-1", startTime: "11:00", duration: 60, order: 1, status: "planned" },
        { id: "it-5", dayId: "day-3", type: "place", placeId: "p-1", startTime: "09:30", duration: 60, order: 0, status: "planned" },
        { id: "it-6", dayId: "day-3", type: "place", placeId: "p-1", startTime: "11:00", duration: 60, order: 1, status: "planned" },
      ] as Trip["items"],
      tasks,
      offers: [{ id: "offer-1", kind: "hotel", title: "测试酒店", provider: "meituan", fetchedAt: TODAY }] as Trip["offers"],
    };
    const before = makeTrip({ ...base, startDate: "2030-06-01", endDate: "2030-06-03", days: [
      { id: "day-1", tripId: "trip-1", index: 0, date: "2030-06-01", title: "第一天", summary: "", weather: { tempC: 24, condition: "晴", icon: "sun" } },
      { id: "day-2", tripId: "trip-1", index: 1, date: "2030-06-02", title: "第二天", summary: "", weather: { tempC: 22, condition: "多云", icon: "cloud" } },
      { id: "day-3", tripId: "trip-1", index: 2, date: "2030-06-03", title: "第三天", summary: "", weather: { tempC: 22, condition: "多云", icon: "cloud" } },
    ] });
    expect(ids(suggestTodayActions(before, "day-1", TODAY))).toContain("tasks-pending");

    const during = makeTrip(base);
    expect(ids(suggestTodayActions(during, "day-1", TODAY))).not.toContain("tasks-pending");
  });

  it("caps the list at three suggestions", () => {
    // Rain + empty day + budget overrun + never-fetched offers = 4 triggers.
    const trip = makeTrip({
      weather: [
        { condition: "晴", tempC: 24, icon: "sun", provenance: { source: "amap", estimated: false }, fetchedAt: TODAY },
        { condition: "大雨", tempC: 20, icon: "rain", provenance: { source: "amap", estimated: false }, fetchedAt: TODAY },
        { condition: "多云", tempC: 22, icon: "cloud", provenance: { source: "amap", estimated: false }, fetchedAt: TODAY },
      ],
      budget: 1000,
      estimatedSpend: 1500,
    });
    const suggestions = suggestTodayActions(trip, "day-1", TODAY);
    expect(suggestions.length).toBe(3);
  });

  it("returns an empty list for a well-formed trip with everything in place", () => {
    const trip = makeTrip({
      items: [
        { id: "it-1", dayId: "day-1", type: "place", placeId: "p-1", startTime: "09:30", duration: 60, order: 0, status: "planned" },
        { id: "it-2", dayId: "day-1", type: "place", placeId: "p-1", startTime: "11:00", duration: 60, order: 1, status: "planned" },
        { id: "it-3", dayId: "day-2", type: "place", placeId: "p-1", startTime: "09:30", duration: 60, order: 0, status: "planned" },
        { id: "it-4", dayId: "day-2", type: "place", placeId: "p-1", startTime: "11:00", duration: 60, order: 1, status: "planned" },
        { id: "it-5", dayId: "day-3", type: "place", placeId: "p-1", startTime: "09:30", duration: 60, order: 0, status: "planned" },
        { id: "it-6", dayId: "day-3", type: "place", placeId: "p-1", startTime: "11:00", duration: 60, order: 1, status: "planned" },
      ],
      offers: [{ id: "offer-1", kind: "hotel", title: "测试酒店", provider: "meituan", fetchedAt: TODAY }] as Trip["offers"],
    });
    expect(suggestTodayActions(trip, "day-1", TODAY)).toEqual([]);
  });
});
