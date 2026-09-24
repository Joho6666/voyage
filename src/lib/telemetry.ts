export type TelemetryEvent =
  | "trip_created"
  | "trip_opened"
  | "action_requested"
  | "action_proposed"
  | "action_applied"
  | "action_undone"
  | "place_added"
  | "place_removed"
  | "route_recomputed"
  | "today_opened"
  | "external_booking_clicked";

export interface TelemetryPayload {
  tripId?: string;
  actionType?: string;
  destination?: string;
  provider?: string;
  durationDays?: number;
  travelers?: number;
  itemCount?: number;
  metersSaved?: number;
  costDiff?: number;
  timestamp?: string;
  [key: string]: unknown;
}

export function trackTelemetry(event: TelemetryEvent, payload: TelemetryPayload = {}): void {
  const sanitized: TelemetryPayload = {
    ...payload,
    timestamp: new Date().toISOString(),
  };

  // Guard against capturing sensitive raw prompt text
  if ("prompt" in sanitized) delete sanitized.prompt;
  if ("message" in sanitized) delete sanitized.message;
  if ("userText" in sanitized) delete sanitized.userText;

  if (process.env.NODE_ENV !== "production") {
    console.log(`[Telemetry] ${event}:`, sanitized);
  }

  // Future expansion: forward to PostHog, Supabase events table, or external analytics
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const recentKey = "voyage_telemetry_recent";
      const existing = JSON.parse(window.localStorage.getItem(recentKey) || "[]") as Array<{ event: string; payload: unknown }>;
      existing.push({ event, payload: sanitized });
      if (existing.length > 50) existing.shift();
      window.localStorage.setItem(recentKey, JSON.stringify(existing));
    } catch {
      // Ignore storage errors
    }
  }
}
