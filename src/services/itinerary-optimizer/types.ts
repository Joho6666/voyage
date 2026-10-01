import type { Place } from "@/types/travel";
import type { PlanningProfile } from "@/schemas/planning";

/** Day periods a place fits; v1 infers them from category + name keywords. */
export type DayPeriod = "morning" | "noon" | "afternoon" | "evening" | "night";

/**
 * How strongly each signal steers the schedule. The guide's original order is
 * a signal, not a rule — geo/time-window/walking/weather carry more weight.
 */
export interface OptimizerWeights {
  originalOrder: number;
  geoDistance: number;
  timeWindow: number;
  walking: number;
  preference: number;
  weather: number;
}

export const DEFAULT_WEIGHTS: OptimizerWeights = {
  originalOrder: 1,
  geoDistance: 3,
  timeWindow: 2,
  walking: 2,
  preference: 2,
  weather: 2,
};

export interface PlaceScheduleProfile {
  place: Place;
  /** Index in the guide/original candidate order. */
  originalOrder: number;
  periods: DayPeriod[];
  /** Rain-friendly (museums, malls, cafés, exhibitions…). */
  indoor: boolean;
  /** Hiking / stair-heavy places (山/步道/爬坡/古镇…). */
  highExertion: boolean;
  /** Viewpoints / night views that belong late in the day. */
  eveningOriented: boolean;
  estimatedStayMinutes: number;
  /**
   * v1 never parses `Place.openingHours` (an opaque provider string), so the
   * optimizer schedules without opening-time constraints and reports them as
   * unresolved instead of inventing any.
   */
  openingHoursKnown: false;
}

export interface OptimizerDay {
  dayId: string;
  date?: string;
  /** Weather as embedded on Trip days; unknown weather is never faked. */
  weather?: { condition?: string; icon?: string };
}

export interface OptimizerInput {
  /** Candidate places in guide/original order. */
  places: Place[];
  days: OptimizerDay[];
  profile?: PlanningProfile | null;
  /** Optional daily route anchor (the hotel's coordinates). */
  hotel?: { lat: number; lng: number } | null;
  weights?: Partial<OptimizerWeights>;
}

export interface OptimizerAssignment {
  dayId: string;
  places: Place[];
}

export interface OptimizerDecision {
  dayId: string;
  kind: "geo_cluster" | "time_window" | "weather" | "profile" | "walking_budget" | "order";
  reason: string;
}

export interface OptimizerMetrics {
  estimatedWalkingMetersByDay: Record<string, number>;
  totalEstimatedWalkingMeters: number;
}

export interface OptimizerOutput {
  assignments: OptimizerAssignment[];
  decisions: OptimizerDecision[];
  warnings: string[];
  /** Constraints the optimizer could not honor for lack of real data. */
  unresolvedConstraints: string[];
  metrics: OptimizerMetrics;
}
