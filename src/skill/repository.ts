import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TravelAction } from "@/services/ai/actions/types";
import type { TripChangeSet } from "@/types/diff";
import type { Trip } from "@/types/travel";
import type { OfferProviderStatus, TravelOffer } from "@/types/offers";
import { validateTrip } from "@/schemas/trip";
import { SkillError } from "./errors";

export interface StoredTrip {
  trip: Trip;
  revision: number;
  hash: string;
  updatedAt: string;
}

export interface ProposalRecord {
  id: string;
  tripId: string;
  baseRevision: number;
  baseHash: string;
  actions: TravelAction[];
  changeSet: TripChangeSet;
  proposedTrip: Trip;
  createdAt: string;
  consumedAt?: string;
}

function digest(trip: Trip) {
  return createHash("sha256").update(JSON.stringify(trip)).digest("hex");
}

export class JsonSkillRepository {
  constructor(private readonly root: string) {}

  private tripPath(id: string) {
    return path.join(this.root, "trips", `${encodeURIComponent(id)}.json`);
  }

  private proposalPath(id: string) {
    return path.join(this.root, "proposals", `${encodeURIComponent(id)}.json`);
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async atomicWrite(file: string, value: unknown) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  }

  async getTrip(id: string) {
    return this.readJson<StoredTrip>(this.tripPath(id));
  }

  async listTrips(): Promise<StoredTrip[]> {
    let files: string[];
    try { files = await readdir(path.join(this.root, "trips")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const records = await Promise.all(files.filter((file) => file.endsWith(".json")).map((file) => this.readJson<StoredTrip>(path.join(this.root, "trips", file))));
    return records.filter((record): record is StoredTrip => Boolean(record?.trip?.id));
  }

  async deleteTrip(id: string) {
    const current = await this.getTrip(id);
    if (!current) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    await unlink(this.tripPath(id));
  }

  async createTrip(trip: Trip): Promise<StoredTrip> {
    const valid = validateTrip(trip);
    if (!valid.success) throw new SkillError("INVALID_INPUT", "Trip failed schema validation", valid.error.flatten());
    const parsedTrip = valid.data as Trip;
    const record: StoredTrip = { trip: parsedTrip, revision: 1, hash: digest(parsedTrip), updatedAt: new Date().toISOString() };
    await this.atomicWrite(this.tripPath(trip.id), record);
    return record;
  }

  async replaceOffers(input: { tripId: string; expectedRevision: number; offers: TravelOffer[]; status: OfferProviderStatus }): Promise<StoredTrip> {
    const current = await this.getTrip(input.tripId);
    if (!current) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (current.revision !== input.expectedRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const valid = validateTrip({ ...current.trip, offers: input.offers, offerProviderStatus: input.status, updatedAt: new Date().toISOString() });
    if (!valid.success) throw new SkillError("INVALID_INPUT", "Trip failed schema validation", valid.error.flatten());
    const trip = valid.data as Trip;
    const next: StoredTrip = { trip, revision: current.revision + 1, hash: digest(trip), updatedAt: new Date().toISOString() };
    await this.atomicWrite(this.tripPath(input.tripId), next);
    return next;
  }

  async updateTrip(input: { tripId: string; expectedRevision: number; trip: Trip }): Promise<StoredTrip> {
    const current = await this.getTrip(input.tripId);
    if (!current) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (current.revision !== input.expectedRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
    const valid = validateTrip(input.trip);
    if (!valid.success) throw new SkillError("INVALID_INPUT", "Trip failed schema validation", valid.error.flatten());
    const trip = valid.data as Trip;
    const next: StoredTrip = { trip, revision: current.revision + 1, hash: digest(trip), updatedAt: new Date().toISOString() };
    await this.atomicWrite(this.tripPath(input.tripId), next);
    return next;
  }

  async saveProposal(input: Omit<ProposalRecord, "id" | "createdAt">): Promise<ProposalRecord> {
    const record: ProposalRecord = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.atomicWrite(this.proposalPath(record.id), record);
    return record;
  }

  async getProposal(id: string) {
    return this.readJson<ProposalRecord>(this.proposalPath(id));
  }

  async applyProposal(input: { tripId: string; proposalId: string; expectedTripRevision: number; confirmed: boolean }) {
    if (input.confirmed !== true) throw new SkillError("CONFIRMATION_REQUIRED", "Explicit confirmed=true is required");
    const proposal = await this.getProposal(input.proposalId);
    if (!proposal || proposal.tripId !== input.tripId) throw new SkillError("PROPOSAL_NOT_FOUND", "Proposal not found");
    if (proposal.consumedAt) throw new SkillError("PROPOSAL_ALREADY_APPLIED", "Proposal has already been applied");
    const current = await this.getTrip(input.tripId);
    if (!current) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
    if (
      current.revision !== input.expectedTripRevision ||
      current.revision !== proposal.baseRevision ||
      current.hash !== proposal.baseHash
    ) {
      throw new SkillError("PROPOSAL_STALE", "Trip changed after this proposal was created");
    }
    const valid = validateTrip(proposal.proposedTrip);
    if (!valid.success) throw new SkillError("INVALID_INPUT", "Proposed Trip failed schema validation", valid.error.flatten());
    const next: StoredTrip = {
      trip: { ...(valid.data as Trip), updatedAt: new Date().toISOString() },
      revision: current.revision + 1,
      hash: "",
      updatedAt: new Date().toISOString(),
    };
    next.hash = digest(next.trip);
    await this.atomicWrite(this.tripPath(input.tripId), next);
    const consumed = { ...proposal, consumedAt: new Date().toISOString() };
    await this.atomicWrite(this.proposalPath(proposal.id), consumed);
    return next;
  }
}
