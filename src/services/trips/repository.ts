import { chongqingTrip, DEMO_TRIP_ID } from "@/data/demo/chongqing";
import type { Trip, TripSummary } from "@/types/travel";

export interface TripRepository {
  list(): Promise<TripSummary[]>;
  get(id: string): Promise<Trip | null>;
  save(trip: Trip): Promise<Trip>;
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
    status: trip.id === DEMO_TRIP_ID ? "ready" : "draft",
  };
}

class MemoryTripRepository implements TripRepository {
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
}

class SupabaseTripRepository implements TripRepository {
  async list(): Promise<TripSummary[]> {
    throw new Error("SupabaseTripRepository is not wired in MVP. Use MemoryTripRepository.");
  }
  async get(): Promise<Trip | null> {
    throw new Error("SupabaseTripRepository is not wired in MVP.");
  }
  async save(): Promise<Trip> {
    throw new Error("SupabaseTripRepository is not wired in MVP.");
  }
}

export const tripRepository: TripRepository = new MemoryTripRepository();
export { SupabaseTripRepository };
