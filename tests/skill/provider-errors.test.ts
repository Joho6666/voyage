import { describe, expect, it } from "vitest";
import { normalizeProviderError } from "@/skill/errors";

describe("AMap provider errors", () => {
  it("does not report a failed fetch as empty POI results", () => {
    const error = normalizeProviderError(new TypeError("fetch failed"), "NO_POI_RESULTS");
    expect(error.code).toBe("AMAP_NETWORK_UNAVAILABLE");
    expect(error.message).not.toContain("fetch failed");
  });

  it("keeps genuine empty results and invalid keys distinct", () => {
    expect(normalizeProviderError(new Error("NO_POI_RESULTS"), "NO_POI_RESULTS").code).toBe("NO_POI_RESULTS");
    expect(normalizeProviderError(new Error("AMap search failed: INVALID_USER_KEY"), "NO_POI_RESULTS").code).toBe("PROVIDER_AUTH_FAILED");
  });
});
