import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl } from "@/lib/safe-url";

describe("assertPublicHttpUrl", () => {
  it("accepts a public https host", () => {
    expect(assertPublicHttpUrl("https://api.openai.com/v1").hostname).toBe("api.openai.com");
  });

  it("rejects localhost", () => {
    expect(() => assertPublicHttpUrl("http://localhost:11434")).toThrow(/Private/);
  });

  it("rejects a private IPv4", () => {
    expect(() => assertPublicHttpUrl("http://192.168.1.10")).toThrow(/Private/);
  });

  it("rejects non-http schemes", () => {
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow(/http/);
  });
});
