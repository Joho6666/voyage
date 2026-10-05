import { chongqingTrip, DEMO_TRIP_ID } from "@/data/demo/chongqing";
import type { Trip, TripSummary } from "@/types/travel";
import type { SupabaseTripRepository } from "./supabase";
// Shared presence check — lib/supabase-config imports no supabase-js, so
// this file still loads without the bundle.
import { isSupabaseEnvConfigured } from "@/lib/supabase-config";

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
  private static readonly storageKey = "voyage.guest.trips.v1";
  private trips: Map<string, Trip>;

  constructor() {
    this.trips = new Map<string, Trip>();
    // The hardcoded Chongqing fixture (coordinates, prices, operating status)
    // is fabricated data: it must only exist when demo mode is explicit.
    if (process.env.VOYAGE_DEMO_MODE === "true") {
      this.trips.set(chongqingTrip.id, structuredClone(chongqingTrip));
    }

    // Guest mode is intentionally local-only. Keep the in-memory fallback
    // useful across browser reloads without making localStorage a server
    // dependency or weakening Supabase RLS.
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(MemoryTripRepository.storageKey);
      if (!stored) return;
      const trips = JSON.parse(stored) as Trip[];
      for (const trip of trips) {
        if (trip && typeof trip.id === "string") {
          this.trips.set(trip.id, trip);
        }
      }
    } catch {
      // Ignore malformed or unavailable browser storage and keep the session trips.
    }
  }

  private persist() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(MemoryTripRepository.storageKey, JSON.stringify([...this.trips.values()]));
    } catch {
      // Guest persistence is best-effort; the in-memory session remains usable.
    }
  }

  async list() {
    return [...this.trips.values()].map(toSummary);
  }

  async get(id: string) {
    const trip = this.trips.get(id);
    return trip ? structuredClone(trip) : null;
  }

  async save(trip: Trip) {
    this.trips.set(trip.id, structuredClone(trip));
    this.persist();
    return structuredClone(trip);
  }

  async update(trip: Trip) {
    return this.save(trip);
  }

  async delete(id: string) {
    this.trips.delete(id);
    this.persist();
  }
}

function createRepository(): TripRepository {
  if (isSupabaseEnvConfigured()) {
    const local = new MemoryTripRepository();
    // The remote repository — and the supabase-js bundle it pulls in — loads
    // on first data call, not at module import, so guest mode never pays for
    // it. A failed load falls back to the local repository permanently.
    let remotePromise: Promise<SupabaseTripRepository | null> | null = null;
    const loadRemote = () => {
      remotePromise ??= import("./supabase")
        .then(({ SupabaseTripRepository: Repository }) => new Repository())
        .catch(() => null);
      return remotePromise;
    };
    const withRemote = async <T>(action: (remote: SupabaseTripRepository) => Promise<T>, fallback: () => Promise<T>): Promise<T> => {
      const remote = await loadRemote();
      if (!remote) return fallback();
      return (await remote.hasAuthenticatedUser()) ? action(remote) : fallback();
    };
    return {
      list: () => withRemote((remote) => remote.list(), () => local.list()),
      get: (id) => withRemote((remote) => remote.get(id), () => local.get(id)),
      save: (trip) => withRemote((remote) => remote.save(trip), () => local.save(trip)),
      update: (trip) => withRemote((remote) => remote.update(trip), () => local.update(trip)),
      delete: (id) => withRemote((remote) => remote.delete(id), () => local.delete(id)),
    };
  }
  return new MemoryTripRepository();
}

export const tripRepository: TripRepository = createRepository();
