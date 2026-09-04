import type { TravelAction } from "@/services/ai/actions/types";
import type { Trip } from "@/types/travel";

export interface ItemChange {
  type: "added" | "removed" | "time_shifted" | "replaced" | "reordered" | "stay_changed";
  itemId?: string;
  placeName: string;
  detail: string;
}

export interface TransitChange {
  fromPlaceName: string;
  toPlaceName: string;
  oldMode: string;
  newMode: string;
  detail: string;
}

export interface TripDiffMetrics {
  walkDistanceBeforeMeters: number;
  walkDistanceAfterMeters: number;
  walkDistanceDiffMeters: number; // negative = saved walking
  walkDurationBeforeMinutes: number;
  walkDurationAfterMinutes: number;
  walkDurationSavedMinutes: number; // positive = saved time
  estimatedCostBefore: number;
  estimatedCostAfter: number;
  costDiff: number; // positive = cost increase, negative = money saved
  transitChanges: TransitChange[];
}

export interface TripChangeSet {
  id: string;
  summary: string;
  metrics: TripDiffMetrics;
  itemChanges: ItemChange[];
  actions: TravelAction[];
  beforeTrip: Trip;
  proposedTrip: Trip;
}
