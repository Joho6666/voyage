// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planningSessionSchema } from "@/schemas/planning";

const base = {
  id: "planning_test",
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
};

describe("planning session importedPlaces compatibility", () => {
  it("reads a legacy session file that has no importedPlaces field", () => {
    const parsed = planningSessionSchema.parse(base);
    expect(parsed.importedPlaces).toEqual([]);
  });

  it("round-trips imported place names", () => {
    const parsed = planningSessionSchema.parse({ ...base, importedPlaces: ["洪崖洞", "解放碑步行街"] });
    expect(parsed.importedPlaces).toEqual(["洪崖洞", "解放碑步行街"]);
  });

  it("bounds the list and rejects unknown keys (schema stays strict)", () => {
    expect(() => planningSessionSchema.parse({ ...base, importedPlaces: Array.from({ length: 21 }, (_, i) => `地点${i}`) })).toThrow();
    expect(() => planningSessionSchema.parse({ ...base, importedPlaces: ["x"], unexpected: true })).toThrow();
  });
});
