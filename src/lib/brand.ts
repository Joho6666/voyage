export const brand = {
  name: "Voyage",
  product: "Travel OS",
  tagline: "把一次旅行，变成一张真正能走的路线。",
  description:
    "AI 帮你把景点、美食、住宿和当地活动整理成每天真正走得通的旅行计划。",
  domain: "voyage.app",
} as const;

export type Brand = typeof brand;
