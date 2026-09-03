import { chongqingTrip, DEMO_TRIP_ID } from "@/data/demo/chongqing";
import type { Trip, TripSummary } from "@/types/travel";
import { SupabaseTripRepository, isSupabaseConfigured } from "./supabase";

export interface TripRepository {
  list(): Promise<TripSummary[]>;
  get(id: string): Promise<Trip | null>;
  save(trip: Trip): Promise<Trip>;
  update?(trip: Trip): Promise<Trip>;
  delete?(id: string): Promise<void>;
}

function toSummary(trip: Trip): TripSummary {
  return {
    id: trip.id,
    title: trip.title,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    travelers: trip.travelers,
    budget: trip.budget,
    coverImage: trip.coverImage,
    status: trip.status ?? (trip.id === DEMO_TRIP_ID ? "ready" : "draft"),
    createdAt: trip.createdAt,
  };
}

export class MemoryTripRepository implements TripRepository {
  private trips = new Map<string, Trip>([[chongqingTrip.id, structuredClone(chongqingTrip)]]);

  async list() {
    return [...this.trips.values()].map(toSummary);
  }

  async get(id: string) {
    const trip = this.trips.get(id);
    return trip ? structuredClone(trip) : null;
  }

  async save(trip: Trip) {
    this.trips.set(trip.id, structuredClone(trip));
    return structuredClone(trip);
  }

  async update(trip: Trip) {
    return this.save(trip);
  }

  async delete(id: string) {
    this.trips.delete(id);
  }
}

function createRepository(): TripRepository {
  if (isSupabaseConfigured()) {
    try {
      return new SupabaseTripRepository();
    } catch {
      return new MemoryTripRepository();
    }
  }
  return new MemoryTripRepository();
}

export const tripRepository: TripRepository = createRepository();
