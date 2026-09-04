import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Trip, TripSummary } from "@/types/travel";
import type { TripRepository } from "./repository";

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export interface SupabaseTripRepositoryOptions {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export class SupabaseTripRepository implements TripRepository {
  private client: SupabaseClient;

  constructor(options: SupabaseTripRepositoryOptions = {}) {
    const url = options.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = options.supabaseAnonKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
    this.client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }

  async list(): Promise<TripSummary[]> {
    const { data, error } = await this.client
      .from("trips")
      .select("id,title,destination,start_date,end_date,travelers,budget,cover_image,status,created_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(`SupabaseTripRepository.list failed: ${error.message}`);
    return (data ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      destination: row.destination as string,
      startDate: row.start_date as string,
      endDate: row.end_date as string,
      travelers: row.travelers as number,
      budget: Number(row.budget),
      coverImage: (row.cover_image as string) || "",
      status: (row.status as TripSummary["status"]) || "draft",
      createdAt: row.created_at as string,
    }));
  }

  async get(id: string): Promise<Trip | null> {
    const { data, error } = await this.client
      .from("trips")
      .select("payload")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseTripRepository.get failed: ${error.message}`);
    if (!data) return null;
    const payload = data.payload as Trip | null;
    return payload ?? null;
  }

  async save(trip: Trip): Promise<Trip> {
    const stamped: Trip = { ...trip, updatedAt: new Date().toISOString() };
    const userRes = await this.client.auth.getUser();
    const ownerId = userRes.data.user?.id;

    const tripRow: Record<string, unknown> = {
      id: stamped.id,
      title: stamped.title,
      destination: stamped.destination,
      origin: stamped.origin,
      start_date: stamped.startDate,
      end_date: stamped.endDate,
      travelers: stamped.travelers,
      budget: stamped.budget,
      currency: stamped.currency ?? "CNY",
      status: stamped.status ?? "draft",
      prompt: stamped.prompt,
      cover_image: stamped.coverImage,
      payload: stamped,
      updated_at: new Date().toISOString(),
    };
    if (ownerId) {
      tripRow.owner_id = ownerId;
    }

    const { error: tripError } = await this.client.from("trips").upsert(tripRow);
    if (tripError) throw new Error(`SupabaseTripRepository.save(trips) failed: ${tripError.message}`);

    await this.replaceChildren(stamped);
    return stamped;
  }

  async update(trip: Trip): Promise<Trip> {
    return this.save(trip);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client.from("trips").delete().eq("id", id);
    if (error) throw new Error(`SupabaseTripRepository.delete failed: ${error.message}`);
  }

  /**
   * Normalized child tables are the query surface; trips.payload is the
   * round-trip source of truth. Children are deleted then re-inserted on save
   * (client-side supabase-js has no multi-statement transaction; documented).
   */
  private async replaceChildren(trip: Trip) {
    const days = trip.days.map((day) => ({
      id: day.id,
      trip_id: trip.id,
      idx: day.index,
      date: day.date,
      title: day.title,
    }));
    const places = trip.places.map((place) => ({
      id: place.id,
      trip_id: trip.id,
      name: place.name,
      category: place.category,
      lat: place.lat,
      lng: place.lng,
      rating: place.rating,
      address: place.address,
      source: place.source ?? "demo",
      source_id: place.sourceId ?? null,
      payload: place,
    }));
    const items = trip.items.map((item) => ({
      id: item.id,
      trip_id: trip.id,
      day_id: item.dayId,
      place_id: item.placeId,
      type: item.type,
      start_time: item.startTime,
      end_time: item.endTime ?? null,
      duration_minutes: item.duration,
      order_idx: item.order,
      status: item.status,
      note: item.notes ?? null,
      reservation_id: item.reservationId ?? null,
    }));
    const segments = trip.segments.map((segment) => ({
      id: segment.id,
      trip_id: trip.id,
      day_id: segment.dayId,
      from_item_id: segment.fromItemId,
      to_item_id: segment.toItemId,
      mode: segment.mode,
      distance_meters: segment.meters,
      duration_minutes: segment.minutes,
      polyline: segment.polyline ?? null,
      estimated_cost: segment.estimatedCost ?? null,
    }));
    const budgetItems = trip.budgetItems.map((item) => ({
      id: item.id,
      trip_id: trip.id,
      category: item.category,
      label: item.label,
      amount: item.planned,
      currency: trip.currency ?? "CNY",
    }));
    const tasks = trip.tasks.map((task) => ({
      id: task.id,
      trip_id: trip.id,
      title: task.title,
      completed: task.status === "done",
      due_at: task.dueAt ?? null,
      linked_item_id: task.linkedItemId ?? null,
      day_id: task.dayId ?? null,
      payload: task,
    }));

    const tables: Array<[string, Record<string, unknown>[]]> = [
      ["itinerary_items", items],
      ["route_segments", segments],
      ["budget_items", budgetItems],
      ["trip_tasks", tasks],
      ["places", places],
      ["trip_days", days],
    ];

    for (const [table, rows] of tables) {
      const del = await this.client.from(table).delete().eq("trip_id", trip.id);
      if (del.error) throw new Error(`SupabaseTripRepository.save(${table}) delete failed: ${del.error.message}`);
      if (rows.length) {
        const ins = await this.client.from(table).insert(rows);
        if (ins.error) throw new Error(`SupabaseTripRepository.save(${table}) insert failed: ${ins.error.message}`);
      }
    }
  }
}
