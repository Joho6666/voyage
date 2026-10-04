import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

/**
 * Traveler Preference Memory v1 (Phase 6.9) — deliberately conservative.
 *
 * Only explicit statements and clearly observable behavioural signals are
 * recorded; nothing sensitive, no free-form profiles. Explicit entries always
 * outrank inferred ones. Inferred entries carry a confidence that grows with
 * consistent samples, decays over time, and resets when behaviour contradicts
 * them. Everything is viewable, editable, deletable and disable-able, and any
 * consumer must disclose usage ("根据你的旅行偏好…") — see summaryLine().
 */

export const preferenceKeySchema = z.enum([
  "pace",
  "walkingTolerance",
  "transportPreference",
  "mealPreference",
  "wakeTime",
  "hotelPreference",
  "budgetStyle",
  "travelStyle",
]);
export type PreferenceKey = z.output<typeof preferenceKeySchema>;

export const preferenceValueSchema = z.string().trim().min(1).max(60);
const boundedSource = z.string().trim().min(1).max(80);

export const explicitEntrySchema = z.object({
  key: preferenceKeySchema,
  value: preferenceValueSchema,
  source: boundedSource,
  updatedAt: z.string(),
}).strict();

export const inferredEntrySchema = z.object({
  key: preferenceKeySchema,
  value: preferenceValueSchema,
  confidence: z.number().min(0).max(0.9),
  samples: z.number().int().min(1).max(100),
  evidence: z.array(z.string().max(120)).max(10),
  updatedAt: z.string(),
}).strict();

export const preferenceMemorySchema = z.object({
  version: z.literal(1),
  explicit: z.array(explicitEntrySchema).max(16),
  inferred: z.array(inferredEntrySchema).max(16),
  disabledAt: z.string().optional(),
}).strict();

export type ExplicitEntry = z.output<typeof explicitEntrySchema>;
export type InferredEntry = z.output<typeof inferredEntrySchema>;
export type PreferenceMemory = z.output<typeof preferenceMemorySchema>;

const EMPTY: PreferenceMemory = { version: 1, explicit: [], inferred: [] };
/** Confidence gain per consistent sample. */
const CONFIDENCE_STEP = 0.15;
const CONFIDENCE_CEILING = 0.9;
/** Inferences older than this decay toward unusable. */
const DECAY_AFTER_MS = 30 * 86_400_000;
const DECAY_FACTOR = 0.7;

export class PreferenceMemoryStore {
  constructor(private readonly root: string) {}

  private get filePath(): string {
    return path.join(this.root, "memory", "preferences.json");
  }

  async read(): Promise<PreferenceMemory> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return preferenceMemorySchema.parse(JSON.parse(raw));
    } catch {
      return { ...EMPTY, explicit: [], inferred: [] };
    }
  }

  private async write(memory: PreferenceMemory): Promise<PreferenceMemory> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(memory, null, 2), "utf8");
    return memory;
  }

  /** Explicit user statement — always wins over any inference. */
  async setExplicit(key: PreferenceKey, value: string, source: string, now = new Date().toISOString()): Promise<PreferenceMemory> {
    const memory = await this.read();
    const entry: ExplicitEntry = { key, value: preferenceValueSchema.parse(value), source: boundedSource.parse(source), updatedAt: now };
    const explicit = [...memory.explicit.filter((candidate) => candidate.key !== key), entry];
    // An explicit statement supersedes the inference for the same key.
    const inferred = memory.inferred.filter((candidate) => candidate.key !== key);
    return this.write({ ...memory, explicit, inferred });
  }

  /**
   * Record one behavioural observation. Same value → confidence grows;
   * contradiction → the inference resets to a single low-confidence sample.
   * One or two observations never produce a high-confidence trait.
   */
  async recordInference(key: PreferenceKey, value: string, evidence: string, now = new Date().toISOString()): Promise<PreferenceMemory> {
    const memory = await this.read();
    if (memory.explicit.some((entry) => entry.key === key)) return memory;
    const parsedValue = preferenceValueSchema.parse(value);
    const existing = memory.inferred.find((candidate) => candidate.key === key);
    if (existing && existing.value === parsedValue) {
      const updated: InferredEntry = {
        ...existing,
        confidence: Math.min(CONFIDENCE_CEILING, existing.confidence + CONFIDENCE_STEP),
        samples: existing.samples + 1,
        evidence: [...existing.evidence.slice(-9), evidence],
        updatedAt: now,
      };
      return this.write({ ...memory, inferred: [...memory.inferred.filter((candidate) => candidate.key !== key), updated] });
    }
    const fresh: InferredEntry = { key, value: parsedValue, confidence: 0.3, samples: 1, evidence: [evidence], updatedAt: now };
    return this.write({ ...memory, inferred: [...memory.inferred.filter((candidate) => candidate.key !== key), fresh] });
  }

  /** Age-based decay: stale inferences lose confidence and may drop out. */
  async decay(nowMs = Date.now()): Promise<PreferenceMemory> {
    const memory = await this.read();
    const inferred = memory.inferred
      .map((entry) => {
        const age = nowMs - Date.parse(entry.updatedAt);
        if (!Number.isFinite(age) || age <= DECAY_AFTER_MS) return entry;
        return { ...entry, confidence: Math.round(entry.confidence * DECAY_FACTOR * 100) / 100 };
      })
      .filter((entry) => entry.confidence >= 0.3);
    return this.write({ ...memory, inferred });
  }

  async remove(key: PreferenceKey): Promise<PreferenceMemory> {
    const memory = await this.read();
    return this.write({
      ...memory,
      explicit: memory.explicit.filter((entry) => entry.key !== key),
      inferred: memory.inferred.filter((entry) => entry.key !== key),
    });
  }

  async setDisabled(disabled: boolean, now = new Date().toISOString()): Promise<PreferenceMemory> {
    const memory = await this.read();
    return this.write(disabled ? { ...memory, disabledAt: now } : { ...memory, disabledAt: undefined });
  }

  /**
   * The disclosure line consumers must show when using memory ("根据你的旅行
   * 偏好…"). Explicit entries are stated as facts; inferred ones always carry
   * their confidence so the traveller can see how much is guessed. Disabled
   * or empty memory yields null — callers show nothing rather than pretend.
   */
  async summaryLine(): Promise<string | null> {
    const memory = await this.read();
    if (memory.disabledAt) return null;
    const parts: string[] = [];
    for (const entry of memory.explicit) parts.push(`${entry.key}=${entry.value}（你自己告知的）`);
    for (const entry of memory.inferred) {
      parts.push(`${entry.key}=${entry.value}（可信度 ${entry.confidence.toFixed(2)}，来自 ${entry.samples} 次行为观察）`);
    }
    if (!parts.length) return null;
    return `根据你的旅行偏好：${parts.join("；")}。如果想调整或清除，随时告诉我。`;
  }
}
