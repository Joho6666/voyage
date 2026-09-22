export type SkillErrorCode =
  | "INVALID_INPUT"
  | "TRIP_NOT_FOUND"
  | "NO_PROVIDER_CONFIGURED"
  | "NO_POI_RESULTS"
  | "WEATHER_UNAVAILABLE"
  | "ROUTE_PROVIDER_UNAVAILABLE"
  | "PROPOSAL_NOT_FOUND"
  | "PROPOSAL_STALE"
  | "PROPOSAL_ALREADY_APPLIED"
  | "CONFIRMATION_REQUIRED"
  | "RUNTIME_INSTALL_FAILED"
  | "INTERNAL_ERROR";

export class SkillError extends Error {
  constructor(
    public readonly code: SkillErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SkillError";
  }
}

export function normalizeProviderError(error: unknown, fallback: SkillErrorCode): SkillError {
  if (error instanceof SkillError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message === "NO_PROVIDER_CONFIGURED") return new SkillError("NO_PROVIDER_CONFIGURED", message);
  if (message === "NO_POI_RESULTS") return new SkillError("NO_POI_RESULTS", message);
  return new SkillError(fallback, message);
}
