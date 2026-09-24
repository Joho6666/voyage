export type SkillErrorCode =
  | "INVALID_INPUT"
  | "TRIP_NOT_FOUND"
  | "NO_PROVIDER_CONFIGURED"
  | "PROVIDER_AUTH_FAILED"
  | "AMAP_NETWORK_UNAVAILABLE"
  | "NO_POI_RESULTS"
  | "WEATHER_UNAVAILABLE"
  | "ROUTE_PROVIDER_UNAVAILABLE"
  | "TICKET_PROVIDER_UNAVAILABLE"
  | "MEITUAN_PROVIDER_NOT_CONFIGURED"
  | "MEITUAN_AUTH_FAILED"
  | "MEITUAN_TIMEOUT"
  | "MEITUAN_EMPTY_RESULT"
  | "MEITUAN_UNSTRUCTURED_RESULT"
  | "TRAVEL_OFFERS_UNAVAILABLE"
  | "REVISION_CONFLICT"
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
  if (/INVALID_USER_KEY|USERKEY_PLAT_NOMATCH|INVALID_USER_SCODE/.test(message)) {
    return new SkillError("PROVIDER_AUTH_FAILED", "AMap rejected AMAP_SERVER_KEY");
  }
  if (message === "NO_PROVIDER_CONFIGURED") return new SkillError("NO_PROVIDER_CONFIGURED", message);
  if (message === "NO_POI_RESULTS") return new SkillError("NO_POI_RESULTS", message);
  // A failed fetch is not an empty POI result. Keep this distinction so the
  // UI can tell users to retry/check connectivity instead of changing keys.
  if (error instanceof TypeError || /fetch failed|network|timed out|timeout|ECONN|ENOTFOUND|certificate/i.test(message)) {
    return new SkillError("AMAP_NETWORK_UNAVAILABLE", "AMap service could not be reached", {
      retryable: true,
      provider: "amap",
    });
  }
  return new SkillError(fallback, message);
}
