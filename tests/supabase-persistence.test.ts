import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trip } from "@/types/travel";

type RecordedCall = { table: string; op: "upsert" | "insert" | "delete"; rows: unknown[] };

function tripFixture(): Trip {
  return {
    id: "sb-trip-1",
    title: "合同测试行程",
    destination: "重庆",
    origin: "桂林",
    startDate: "2030-05-01",
    endDate: "2030-05-02",
    travelers: 2,
    budget: 2500,
    currency: "CNY",
    status: "ready",
    estimatedSpend: 2100,
    coverImage: "",
    vibe: [],
    prompt: "raw prompt",
    days: [{ id: "day-1", tripId: "sb-trip-1", index: 0, date: "2030-05-01", title: "第一天", summary: "", weather: { tempC: 24, condition: "晴", icon: "sun" } }],
    items: [{ id: "it-1", dayId: "day-1", type: "place", placeId: "p-1", startTime: "09:30", duration: 60, order: 0, status: "planned" }],
    segments: [{ id: "seg-1", tripId: "sb-trip-1", dayId: "day-1", fromItemId: "it-1", toItemId: "it-1", fromPlaceId: "p-1", toPlaceId: "p-1", mode: "walk", distanceMeters: 800, durationMinutes: 12, meters: 800, minutes: 12, label: "步行", polyline: [], steps: [], provider: "haversine", estimated: true, updatedAt: "2030-05-01T00:00:00Z" }],
    places: [{ id: "p-1", name: "洪崖洞", category: "attraction", lat: 29.56, lng: 106.57, rating: 4.6, reviewCount: 10, image: "", priceLevel: 0, address: "渝中区", openingStatus: "open", stayMinutes: 90, description: "", tags: [], district: "渝中区" }],
    hotels: [],
    restaurants: [],
    activities: [],
    transports: [],
    tasks: [{ id: "t-1", tripId: "sb-trip-1", title: "买票", group: "before", status: "todo" }],
    budgetItems: [{ id: "b-1", tripId: "sb-trip-1", category: "food", label: "火锅", planned: 120 }],
  };
}

const CHILD_TABLE_ORDER = ["itinerary_items", "route_segments", "budget_items", "trip_tasks", "places", "trip_days"];

/**
 * Builds a supabase-js client stub that records every write and serves
 * preloaded trips rows for `.select("payload").eq("id", …).maybeSingle()`.
 * The real client is never constructed (createClient is mocked), so these
 * tests pin the repository's *contract*, not the network layer.
 */
function stubSupabase(options: { storedPayloads?: Record<string, Trip>; insertErrorOn?: string } = {}) {
  const calls: RecordedCall[] = [];
  const storedPayloads = options.storedPayloads ?? {};
  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
    },
    from(table: string) {
      const upsert = async (row: Record<string, unknown>) => {
        calls.push({ table, op: "upsert", rows: [row] });
        return { error: null };
      };
      const insert = async (rows: Record<string, unknown>[]) => {
        if (options.insertErrorOn === table) return { error: { message: `insert exploded on ${table}` } };
        calls.push({ table, op: "insert", rows });
        return { error: null };
      };
      const remove = () => ({
        eq: async (_column: string, value: unknown) => {
          calls.push({ table, op: "delete", rows: [value] });
          return { error: null };
        },
      });
      const select = () => ({
        order: async () => ({
          data: Object.entries(storedPayloads).map(([id, trip]) => ({
            id, title: trip.title, destination: trip.destination, start_date: trip.startDate,
            end_date: trip.endDate, travelers: trip.travelers, budget: trip.budget,
            cover_image: trip.coverImage, status: trip.status, created_at: "2030-01-01T00:00:00Z",
          })),
          error: null,
        }),
        eq: (_column: string, value: unknown) => ({
          maybeSingle: async () => {
            const payload = storedPayloads[value as string];
            return payload ? { data: { payload } } : { data: null };
          },
        }),
      });
      return { select, upsert, insert, delete: remove };
    },
  };
  vi.mocked(createClient).mockReturnValue(client as unknown as ReturnType<typeof createClient>);
  return { calls };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { SupabaseTripRepository } from "@/services/trips/supabase";

const REPO_OPTIONS = { supabaseUrl: "https://stub.supabase.test", supabaseAnonKey: "stub-anon-key" };

describe("SupabaseTripRepository contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("save() upserts the trips row with owner and full payload", async () => {
    const { calls } = stubSupabase();
    const repo = new SupabaseTripRepository(REPO_OPTIONS);
    const trip = tripFixture();
    const saved = await repo.save(trip);

    const upsert = calls.find((call) => call.table === "trips" && call.op === "upsert");
    expect(upsert).toBeTruthy();
    const row = upsert?.rows[0] as Record<string, unknown>;
    expect(row.owner_id).toBe("user-1");
    expect(row.title).toBe("合同测试行程");
    expect(row.start_date).toBe("2030-05-01");
    expect((row.payload as Trip).id).toBe("sb-trip-1");
    expect((row.payload as Trip).updatedAt).toBeTruthy();
    expect(saved.updatedAt).toBeTruthy();
  });

  it("save() replaces each child table in the documented order", async () => {
    const { calls } = stubSupabase();
    const repo = new SupabaseTripRepository(REPO_OPTIONS);
    await repo.save(tripFixture());

    const writes = calls.filter((call) => call.table !== "trips");
    const seen: string[] = [];
    for (const call of writes) {
      if (seen[seen.length - 1] !== call.table) seen.push(call.table);
    }
    expect(seen).toEqual(CHILD_TABLE_ORDER);
    for (const table of CHILD_TABLE_ORDER) {
      const deleteCall = writes.find((call) => call.table === table && call.op === "delete");
      const insertCall = writes.find((call) => call.table === table && call.op === "insert");
      expect(deleteCall, `${table} delete`).toBeTruthy();
      expect(insertCall, `${table} insert`).toBeTruthy();
    }
  });

  it("maps camelCase trip fields onto snake_case child rows", async () => {
    const { calls } = stubSupabase();
    const repo = new SupabaseTripRepository(REPO_OPTIONS);
    await repo.save(tripFixture());

    const itemRow = calls.find((call) => call.table === "itinerary_items" && call.op === "insert")?.rows[0] as Record<string, unknown>;
    expect(itemRow).toMatchObject({ id: "it-1", trip_id: "sb-trip-1", day_id: "day-1", place_id: "p-1", duration_minutes: 60, order_idx: 0, status: "planned" });
    const segmentRow = calls.find((call) => call.table === "route_segments" && call.op === "insert")?.rows[0] as Record<string, unknown>;
    expect(segmentRow).toMatchObject({ id: "seg-1", distance_meters: 800, duration_minutes: 12, provider: "haversine", estimated: true });
    const taskRow = calls.find((call) => call.table === "trip_tasks" && call.op === "insert")?.rows[0] as Record<string, unknown>;
    expect(taskRow).toMatchObject({ id: "t-1", title: "买票", completed: false });
    const budgetRow = calls.find((call) => call.table === "budget_items" && call.op === "insert")?.rows[0] as Record<string, unknown>;
    expect(budgetRow).toMatchObject({ id: "b-1", category: "food", label: "火锅", amount: 120, currency: "CNY" });
    const dayRow = calls.find((call) => call.table === "trip_days" && call.op === "insert")?.rows[0] as Record<string, unknown>;
    expect(dayRow).toMatchObject({ id: "day-1", trip_id: "sb-trip-1", idx: 0, date: "2030-05-01" });
  });

  it("get() returns the stored payload verbatim and null for a miss", async () => {
    const trip = tripFixture();
    stubSupabase({ storedPayloads: { "sb-trip-1": trip } });
    const repo = new SupabaseTripRepository(REPO_OPTIONS);
    await expect(repo.get("sb-trip-1")).resolves.toEqual(trip);
    await expect(repo.get("missing")).resolves.toBeNull();
  });

  it("list() maps summary rows to camelCase TripSummary", async () => {
    stubSupabase({ storedPayloads: { "sb-trip-1": tripFixture() } });
    const repo = new SupabaseTripRepository(REPO_OPTIONS);
    const summaries = await repo.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: "sb-trip-1", title: "合同测试行程", startDate: "2030-05-01", endDate: "2030-05-02", budget: 2500, status: "ready", createdAt: "2030-01-01T00:00:00Z" });
  });

  it("surfaces which child table failed — the non-transactional failure window", async () => {
    // save() is delete-then-insert per table with no multi-statement
    // transaction: if route_segments insert fails here, the trips row and
    // itinerary_items were already written. The error must name the table so
    // the crash window is diagnosable; consistency is restored by the next
    // successful save().
    const { calls } = stubSupabase({ insertErrorOn: "route_segments" });
    const repo = new SupabaseTripRepository(REPO_OPTIONS);
    await expect(repo.save(tripFixture())).rejects.toThrow("save(route_segments) insert failed");
    const tripUpserts = calls.filter((call) => call.table === "trips").length;
    expect(tripUpserts).toBe(1);
    expect(calls.some((call) => call.table === "itinerary_items" && call.op === "insert")).toBe(true);
    expect(calls.some((call) => call.table === "budget_items" && call.op === "insert")).toBe(false);
  });

  it("delete() removes only the requested trip row", async () => {
    const { calls } = stubSupabase();
    const repo = new SupabaseTripRepository(REPO_OPTIONS);
    await repo.delete("sb-trip-1");
    expect(calls).toEqual([{ table: "trips", op: "delete", rows: ["sb-trip-1"] }]);
  });
});
