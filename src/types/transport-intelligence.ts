import type { RouteStep } from "./travel";

export type UrbanTransportMode = "walk" | "metro" | "bus" | "taxi" | "drive";
export type TrafficLevel = "low" | "medium" | "high" | "unknown";
export type CrowdLevel = "low" | "medium" | "high" | "unknown";

export interface TransportCost {
  min: number;
  max: number;
  currency: "CNY";
  estimated: boolean;
}

export interface TransportOption {
  id: string;
  requestedMode: UrbanTransportMode;
  mode: UrbanTransportMode;
  durationMinutes: number;
  distanceMeters: number;
  walkMeters: number;
  transferCount: number;
  cost: TransportCost;
  trafficLevel: TrafficLevel;
  crowdLevel: CrowdLevel;
  rainExposure: number;
  confidence: number;
  source: "amap" | "haversine" | "mock";
  estimated: boolean;
  updatedAt: string;
  polyline?: Array<[number, number]>;
  steps?: RouteStep[];
  warnings?: string[];
}

export interface TransportScoreWeights {
  time: number;
  cost: number;
  walking: number;
  transfers: number;
  weather: number;
  fatigue: number;
  risk: number;
}

export interface TransportContext {
  budgetSensitivity: "low" | "medium" | "high";
  walkingTolerance: "low" | "medium" | "high";
  fatigue: "low" | "medium" | "high";
  weather: "clear" | "rain" | "heat" | "cold" | "unknown";
  travelers: number;
  hasLuggage: boolean;
  accessibilityNeeds: boolean;
}

export interface TransportScoreBreakdown {
  time: number;
  cost: number;
  walking: number;
  transfers: number;
  weather: number;
  fatigue: number;
  risk: number;
}

export interface ScoredTransportOption extends TransportOption {
  score: number;
  scoreBreakdown: TransportScoreBreakdown;
  reasons: string[];
}

export interface RouteOptionSet {
  city: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  generatedAt: string;
  recommendedMode: UrbanTransportMode;
  options: ScoredTransportOption[];
  warnings: string[];
}
