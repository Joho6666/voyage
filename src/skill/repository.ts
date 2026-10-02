import { createHash, randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TravelAction } from "@/services/ai/actions/types";
import type { TripChangeSet } from "@/types/diff";
import type { Trip } from "@/types/travel";
import type { OfferProviderStatus, TravelOffer } from "@/types/offers";
import { validateTrip } from "@/schemas/trip";
import { planningProfileSchema, planningSessionSchema, type PlanningProfile, type PlanningSession } from "@/schemas/planning";
import { SkillError } from "./errors";

export interface StoredTrip {
  trip: Trip;
  revision: number;
  hash: string;
  updatedAt: string;
}

/** Persisted planning sessions are scoped by the repository root (workspace). */
export interface StoredPlanningSession extends PlanningSession {
  hash: string;
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
  /** sha256 of the one-time proposalToken; the plaintext token is never stored. */
  tokenHash: string;
  /** RFC3339 deadline after which the token is rejected (PROPOSAL_EXPIRED). */
  expiresAt: string;
  /** sha256 of the changeSet at propose time; recomputed at apply to detect tampering. */
  changeSetHash: string;
  consumedAt?: string;
}

export const DEFAULT_PROPOSAL_TTL_SEC = 600;

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function digestText(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time comparison of two sha256 hex digests. */
function hashMatches(stored: string, computed: string) {
  if (stored.length !== computed.length) return false;
  return timingSafeEqual(Buffer.from(stored, "hex"), Buffer.from(computed, "hex"));
}

function preservePlanningProfile(input: Trip, parsed: Trip): Trip {
  const metadata = input.planningMetadata;
  if (!metadata) return parsed;
  const planningProfile = metadata.planningProfile;
  if (planningProfile) {
    const valid = planningProfileSchema.safeParse(planningProfile);
    if (!valid.success) {
      throw new SkillError("INVALID_INPUT", "Planning profile failed schema validation", valid.error.flatten());
    }
  }
  return {
    ...parsed,
    planningMetadata: {
      ...metadata,
      ...(parsed.planningMetadata ?? {}),
      ...(planningProfile ? { planningProfile: planningProfileSchema.parse(planningProfile) as PlanningProfile } : {}),
    },
  };
}

export interface RepositoryOptions {
  /** How long a proposalToken stays valid. Default 10 minutes. */
  proposalTtlSec?: number;
}

export class JsonSkillRepository {
  constructor(
    private readonly root: string,
    private readonly options: RepositoryOptions = {},
  ) {}

  /**
   * Serializes read-modify-write cycles per record file. The revision check
   * alone is check-then-act: two concurrent writers holding the same
   * expectedRevision would both pass it and the later rename would silently
   * drop the first update. Holding the re-read inside the critical section
   * makes the second writer see the bumped revision and fail loudly with
   * REVISION_CONFLICT instead.
   */
  private writeLocks = new Map<string, Promise<void>>();

  private async withWriteLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
    const prior = (this.writeLocks.get(file) ?? Promise.resolve()).catch(() => undefined);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const chain = prior.then(() => gate);
    this.writeLocks.set(file, chain);
    // Wait for the previous holder's release — never on our own gate, which
    // only resolves in the finally below.
    await prior;
    try {
      return await fn();
    } finally {
      release();
      if (this.writeLocks.get(file) === chain) this.writeLocks.delete(file);
    }
  }

  /**
   * Joins a record name under the workspace root and proves the result stays
   * inside it. Ids are encodeURIComponent-escaped (so `../` cannot survive),
   * and the resolved-path check makes the boundary a locally verifiable
   * invariant rather than an assumption about the caller's input.
   */
  private recordPath(dir: "trips" | "planning-sessions" | "proposals", id: string) {
    const base = path.resolve(this.root, dir);
    const target = path.resolve(base, `${encodeURIComponent(id)}.json`);
    if (!target.startsWith(base + path.sep)) throw new SkillError("INVALID_INPUT", "Invalid record id");
    return target;
  }

  private tripPath(id: string) {
    return this.recordPath("trips", id);
  }

  private planningSessionPath(id: string) {
    return this.recordPath("planning-sessions", id);
  }

  private proposalPath(id: string) {
    return this.recordPath("proposals", id);
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

  async getPlanningSession(id: string): Promise<StoredPlanningSession | null> {
    const raw = await this.readJson<unknown>(this.planningSessionPath(id));
    if (!raw) return null;
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new SkillError("INVALID_INPUT", "Stored planning session is malformed");
    }
    const record = raw as Record<string, unknown>;
    const parsed = planningSessionSchema.safeParse(
      Object.fromEntries(Object.entries(record).filter(([key]) => key !== "hash")),
    );
    if (!parsed.success) {
      throw new SkillError("INVALID_INPUT", "Stored planning session failed schema validation", parsed.error.flatten());
    }
    return {
      ...(parsed.data as PlanningSession),
      hash: typeof record.hash === "string" ? record.hash : digest(parsed.data),
    };
  }

  async createPlanningSession(session: PlanningSession): Promise<StoredPlanningSession> {
    const parsed = planningSessionSchema.safeParse(session);
    if (!parsed.success) {
      throw new SkillError("INVALID_INPUT", "Planning session failed schema validation", parsed.error.flatten());
    }
    const existing = await this.getPlanningSession(parsed.data.id);
    if (existing) throw new SkillError("REVISION_CONFLICT", "Planning session already exists");
    const normalized = parsed.data as PlanningSession;
    const record: StoredPlanningSession = { ...normalized, hash: digest(normalized) };
    await this.atomicWrite(this.planningSessionPath(normalized.id), record);
    return record;
  }

  async updatePlanningSession(input: {
    sessionId: string;
    expectedRevision: number;
    session: PlanningSession;
  }): Promise<StoredPlanningSession> {
    return this.withWriteLock(this.planningSessionPath(input.sessionId), async () => {
      const current = await this.getPlanningSession(input.sessionId);
      if (!current) throw new SkillError("INVALID_INPUT", "Planning session not found");
      if (current.revision !== input.expectedRevision) {
        throw new SkillError("REVISION_CONFLICT", "Planning session revision does not match expectedRevision");
      }
      if (input.session.id !== input.sessionId) {
        throw new SkillError("INVALID_INPUT", "Planning session id does not match sessionId");
      }
      const parsed = planningSessionSchema.safeParse({
        ...input.session,
        revision: current.revision + 1,
      });
      if (!parsed.success) {
        throw new SkillError("INVALID_INPUT", "Planning session failed schema validation", parsed.error.flatten());
      }
      const normalized = parsed.data as PlanningSession;
      const record: StoredPlanningSession = { ...normalized, hash: digest(normalized) };
      await this.atomicWrite(this.planningSessionPath(input.sessionId), record);
      return record;
    });
  }

  /** Compatibility alias for callers that treat a session write as a save. */
  async savePlanningSession(input: {
    session: PlanningSession;
    expectedRevision?: number;
  }): Promise<StoredPlanningSession> {
    const current = await this.getPlanningSession(input.session.id);
    if (!current) return this.createPlanningSession(input.session);
    return this.updatePlanningSession({
      sessionId: input.session.id,
      expectedRevision: input.expectedRevision ?? current.revision,
      session: input.session,
    });
  }

  /** Trip-shaped record helper for code that uses the existing repository convention. */
  async getPlanningSessionRecord(id: string) {
    const session = await this.getPlanningSession(id);
    return session
      ? { session, revision: session.revision, hash: session.hash, updatedAt: session.updatedAt }
      : null;
  }

  async listTrips(): Promise<StoredTrip[]> {
    let files: string[];
    try { files = await readdir(path.join(this.root, "trips")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const records = await Promise.all(files.filter((file) => file.endsWith(".json")).map((file) => this.readJson<StoredTrip>(path.join(this.root, "trips", file))));
    return records.filter((record): record is StoredTrip => Boolean(record?.trip?.id));
  }

  async deleteTrip(id: string) {
    return this.withWriteLock(this.tripPath(id), async () => {
      const current = await this.getTrip(id);
      if (!current) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
      await unlink(this.tripPath(id));
      // Cascade: proposals of a deleted trip embed the whole proposed trip and
      // would otherwise outlive it as orphans. Names come from readdir (plain
      // basenames) and are re-validated before any unlink.
      const proposalDir = path.resolve(this.root, "proposals");
      for (const file of await readdir(proposalDir).catch(() => [] as string[])) {
        if (!/^[A-Za-z0-9_-]+\.json$/.test(file)) continue;
        const full = path.resolve(proposalDir, file);
        if (!full.startsWith(proposalDir + path.sep)) continue;
        const record = await readFile(full, "utf8").then((text) => JSON.parse(text) as { tripId?: string }).catch(() => null);
        if (record?.tripId === id) await unlink(full).catch(() => undefined);
      }
    });
  }

  async createTrip(trip: Trip): Promise<StoredTrip> {
    const valid = validateTrip(trip);
    if (!valid.success) throw new SkillError("INVALID_INPUT", "Trip failed schema validation", valid.error.flatten());
    const parsedTrip = preservePlanningProfile(trip, valid.data as Trip);
    const record: StoredTrip = { trip: parsedTrip, revision: 1, hash: digest(parsedTrip), updatedAt: new Date().toISOString() };
    await this.atomicWrite(this.tripPath(trip.id), record);
    return record;
  }

  async replaceOffers(input: { tripId: string; expectedRevision: number; offers: TravelOffer[]; status: OfferProviderStatus; weatherByDate?: Record<string, Trip["days"][number]["weather"]> }): Promise<StoredTrip> {
    return this.withWriteLock(this.tripPath(input.tripId), async () => {
      const current = await this.getTrip(input.tripId);
      if (!current) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
      if (current.revision !== input.expectedRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
      const days = input.weatherByDate ? current.trip.days.map((day) => input.weatherByDate?.[day.date] ? { ...day, weather: input.weatherByDate[day.date] } : day) : current.trip.days;
      const valid = validateTrip({ ...current.trip, days, offers: input.offers, offerProviderStatus: input.status, updatedAt: new Date().toISOString() });
      if (!valid.success) throw new SkillError("INVALID_INPUT", "Trip failed schema validation", valid.error.flatten());
      const trip = preservePlanningProfile(current.trip, valid.data as Trip);
      const next: StoredTrip = { trip, revision: current.revision + 1, hash: digest(trip), updatedAt: new Date().toISOString() };
      await this.atomicWrite(this.tripPath(input.tripId), next);
      return next;
    });
  }

  async updateTrip(input: { tripId: string; expectedRevision: number; trip: Trip }): Promise<StoredTrip> {
    return this.withWriteLock(this.tripPath(input.tripId), async () => {
      const current = await this.getTrip(input.tripId);
      if (!current) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
      if (current.revision !== input.expectedRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
      const valid = validateTrip(input.trip);
      if (!valid.success) throw new SkillError("INVALID_INPUT", "Trip failed schema validation", valid.error.flatten());
      const trip = preservePlanningProfile(input.trip, valid.data as Trip);
      const next: StoredTrip = { trip, revision: current.revision + 1, hash: digest(trip), updatedAt: new Date().toISOString() };
      await this.atomicWrite(this.tripPath(input.tripId), next);
      return next;
    });
  }

  /**
   * Persists a proposal and mints its one-time proposalToken. The plaintext
   * token is returned to the caller exactly once and only its sha256 is
   * stored — apply-change must present it, so a model cannot apply its own
   * proposal without a human seeing the diff.
   */
  async saveProposal(input: Omit<ProposalRecord, "id" | "createdAt" | "tokenHash" | "expiresAt" | "changeSetHash">): Promise<{ record: ProposalRecord; token: string }> {
    const ttlSec = Math.max(1, this.options.proposalTtlSec ?? DEFAULT_PROPOSAL_TTL_SEC);
    const token = randomBytes(32).toString("base64url");
    const record: ProposalRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      tokenHash: digestText(token),
      expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
      changeSetHash: digest(input.changeSet),
    };
    await this.atomicWrite(this.proposalPath(record.id), record);
    return { record, token };
  }

  async getProposal(id: string) {
    return this.readJson<ProposalRecord>(this.proposalPath(id));
  }

  async applyProposal(input: { tripId: string; proposalId: string; expectedTripRevision: number; confirmed: boolean; proposalToken: string }) {
    // Lock on the trip record: apply reads the trip, compares revision+hash and
    // rewrites it — two concurrent applies must serialize the same way.
    return this.withWriteLock(this.tripPath(input.tripId), async () => {
      if (input.confirmed !== true) throw new SkillError("CONFIRMATION_REQUIRED", "Explicit confirmed=true is required");
      const proposal = await this.getProposal(input.proposalId);
      if (!proposal || proposal.tripId !== input.tripId) throw new SkillError("PROPOSAL_NOT_FOUND", "Proposal not found");
      if (proposal.consumedAt) throw new SkillError("PROPOSAL_ALREADY_APPLIED", "Proposal has already been applied");
      if (new Date(proposal.expiresAt).getTime() < Date.now()) {
        throw new SkillError("PROPOSAL_EXPIRED", "Proposal token has expired — propose again");
      }
      if (!hashMatches(proposal.tokenHash, digestText(input.proposalToken))) {
        throw new SkillError("PROPOSAL_TOKEN_INVALID", "proposalToken does not match this proposal");
      }
      if (!hashMatches(proposal.changeSetHash, digest(proposal.changeSet))) {
        throw new SkillError("PROPOSAL_TAMPERED", "Stored changeSet no longer matches the hash minted at propose time");
      }
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
      const proposedTrip = preservePlanningProfile(proposal.proposedTrip, valid.data as Trip);
      const next: StoredTrip = {
        trip: { ...proposedTrip, updatedAt: new Date().toISOString() },
        revision: current.revision + 1,
        hash: "",
        updatedAt: new Date().toISOString(),
      };
      next.hash = digest(next.trip);
      await this.atomicWrite(this.tripPath(input.tripId), next);
      // A consumed proposal embeds a full copy of the proposed trip. Keeping the
      // file "forever" made proposals/ grow without bound, so the record is
      // deleted once applied: a replay now fails closed with PROPOSAL_NOT_FOUND
      // instead of quietly succeeding again.
      await unlink(this.proposalPath(proposal.id)).catch(() => undefined);
      return next;
    });
  }
}
