// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Place, Trip } from "@/types/travel";
import type { ProviderForecast, ProviderRoute, TravelDataProvider } from "@/skill/providers";
import { JsonSkillRepository } from "@/skill/repository";
import { VoyageSkillRuntime } from "@/skill/runtime";

vi.setConfig({ testTimeout: 30_000 });

interface Fixture {
  places: Place[];
  weather: ProviderForecast[];
  route: Omit<ProviderRoute, "source">;
}

class RealFixtureProvider implements TravelDataProvider {
  readonly kind = "amap" as const;
  constructor(private readonly fixture: Fixture) {}

  async searchPlaces(input: { query: string; category?: Place["category"]; limit: number }) {
    return this.fixture.places
      .filter((place) => !input.category || place.category === input.category)
      .slice(0, input.limit)
      .map((place) => ({ ...place, source: "amap" as const, provenance: { source: "amap" as const, estimated: false as const } }));
  }

  async getWeather() {
    return this.fixture.weather.map((forecast) => ({ ...forecast, source: "amap" as const }));
  }

  async planRoute(input: Parameters<TravelDataProvider["planRoute"]>[0]) {
    return { ...this.fixture.route, mode: input.mode, source: "amap" as const };
  }
}

describe("proposalToken confirmation discipline", () => {
  let dataDir: string;
  let runtime: VoyageSkillRuntime;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "voyage-token-"));
    const fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
    runtime = new VoyageSkillRuntime(new JsonSkillRepository(dataDir), async () => new RealFixtureProvider(fixture));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function createTrip() {
    const created = await runtime.createTrip({
      origin: "桂林", destination: "重庆", startDate: "2030-05-01", days: 2, people: 2, budget: 2500,
      preferences: [], walkingTolerance: "low", fallbackPolicy: "estimated",
    }) as any;
    return created.data;
  }

  async function propose(tripId: string, instruction = "第二天少走一点") {
    const proposal = await runtime.proposeChange({ tripId, instruction, fallbackPolicy: "estimated" }) as any;
    expect(proposal.data.proposalToken).toBeTruthy();
    expect(proposal.data.proposalId).toBeTruthy();
    return proposal.data as { proposalId: string; proposalToken: string; baseRevision: number };
  }

  it("mints a one-time token on propose and applies with it", async () => {
    const data = await createTrip();
    const proposal = await propose(data.tripId);
    const applied = await runtime.applyChange({
      tripId: data.tripId, proposalId: proposal.proposalId, expectedTripRevision: proposal.baseRevision,
      confirmed: true, proposalToken: proposal.proposalToken,
    }) as any;
    expect(applied.data.revision).toBe(proposal.baseRevision + 1);
  });

  it("rejects apply without any token (skipping propose)", async () => {
    const data = await createTrip();
    const proposal = await propose(data.tripId);
    await expect(runtime.applyChange({
      tripId: data.tripId, proposalId: proposal.proposalId, expectedTripRevision: proposal.baseRevision, confirmed: true,
    })).rejects.toMatchObject({ code: "PROPOSAL_TOKEN_REQUIRED" });
  });

  it("rejects a token that does not match the proposal", async () => {
    const data = await createTrip();
    const proposal = await propose(data.tripId);
    await expect(runtime.applyChange({
      tripId: data.tripId, proposalId: proposal.proposalId, expectedTripRevision: proposal.baseRevision,
      confirmed: true, proposalToken: "not-the-minted-token",
    })).rejects.toMatchObject({ code: "PROPOSAL_TOKEN_INVALID" });
  });

  it("rejects a token from a different proposal", async () => {
    const data = await createTrip();
    const first = await propose(data.tripId, "第二天少走一点");
    const second = await propose(data.tripId, "第二天省100元");
    await expect(runtime.applyChange({
      tripId: data.tripId, proposalId: second.proposalId, expectedTripRevision: second.baseRevision,
      confirmed: true, proposalToken: first.proposalToken,
    })).rejects.toMatchObject({ code: "PROPOSAL_TOKEN_INVALID" });
  });

  it("expires the token after the TTL", async () => {
    // Short-TTL repository exercises the same expiry check as the default
    // 10-minute TTL without mocking the clock (fake timers hang the provider
    // pipeline and leak across files in the same worker).
    const shortDir = await mkdtemp(path.join(os.tmpdir(), "voyage-token-ttl-"));
    try {
      const fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as Fixture;
      const shortRuntime = new VoyageSkillRuntime(
        new JsonSkillRepository(shortDir, { proposalTtlSec: 1 }),
        async () => new RealFixtureProvider(fixture),
      );
      const created = await shortRuntime.createTrip({
        origin: "桂林", destination: "重庆", startDate: "2030-05-01", days: 2, people: 2, budget: 2500,
        preferences: [], fallbackPolicy: "estimated",
      }) as any;
      const proposal = await shortRuntime.proposeChange({ tripId: created.data.tripId, instruction: "第二天少走一点", fallbackPolicy: "estimated" }) as any;
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await expect(shortRuntime.applyChange({
        tripId: created.data.tripId, proposalId: proposal.data.proposalId, expectedTripRevision: proposal.data.baseRevision,
        confirmed: true, proposalToken: proposal.data.proposalToken,
      })).rejects.toMatchObject({ code: "PROPOSAL_EXPIRED" });
    } finally {
      await rm(shortDir, { recursive: true, force: true });
    }
  });

  it("rejects a replay of an already-applied token", async () => {
    const data = await createTrip();
    const proposal = await propose(data.tripId);
    const input = {
      tripId: data.tripId, proposalId: proposal.proposalId, expectedTripRevision: proposal.baseRevision,
      confirmed: true, proposalToken: proposal.proposalToken,
    };
    await runtime.applyChange(input);
    // The record is deleted on apply, so the replay fails closed.
    await expect(runtime.applyChange(input)).rejects.toMatchObject({ code: "PROPOSAL_NOT_FOUND" });
  });

  it("rejects when the trip revision moved after the proposal", async () => {
    const data = await createTrip();
    const proposal = await propose(data.tripId);
    await runtime.updateTrip({ tripId: data.tripId, expectedTripRevision: proposal.baseRevision, patch: { title: "改个标题" } });
    await expect(runtime.applyChange({
      tripId: data.tripId, proposalId: proposal.proposalId, expectedTripRevision: proposal.baseRevision,
      confirmed: true, proposalToken: proposal.proposalToken,
    })).rejects.toMatchObject({ code: "PROPOSAL_STALE" });
  });

  it("rejects a tampered changeSet even with a valid token", async () => {
    const data = await createTrip();
    const proposal = await propose(data.tripId);
    const file = path.join(dataDir, "proposals", `${proposal.proposalId}.json`);
    const record = JSON.parse(await readFile(file, "utf8")) as { changeSet: { summary: string } };
    record.changeSet.summary = "看似无害的改动";
    await writeFile(file, JSON.stringify(record, null, 2), "utf8");
    await expect(runtime.applyChange({
      tripId: data.tripId, proposalId: proposal.proposalId, expectedTripRevision: proposal.baseRevision,
      confirmed: true, proposalToken: proposal.proposalToken,
    })).rejects.toMatchObject({ code: "PROPOSAL_TAMPERED" });
  });

  it("does not leak the plaintext token in the stored proposal record", async () => {
    const data = await createTrip();
    const proposal = await propose(data.tripId);
    const file = path.join(dataDir, "proposals", `${proposal.proposalId}.json`);
    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain(proposal.proposalToken);
    expect(raw).toContain("tokenHash");
    expect(raw).toContain("expiresAt");
  });

  it("keeps the trip untouched until apply succeeds", async () => {
    const data = await createTrip();
    const before = (await runtime.getTrip({ tripId: data.tripId }) as any).data.trip as Trip;
    await propose(data.tripId);
    const after = (await runtime.getTrip({ tripId: data.tripId }) as any).data.trip as Trip;
    expect(after).toEqual(before);
  });
});
