import { describe, expect, it } from "vitest";
import { assertPublicFetchUrl, assertPublicHttpUrl } from "@/lib/safe-url";

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

describe("assertPublicFetchUrl (user-supplied URLs)", () => {
  it("accepts platform links", () => {
    expect(assertPublicFetchUrl("https://www.xiaohongshu.com/explore/abc123").hostname).toBe("www.xiaohongshu.com");
    expect(assertPublicFetchUrl("https://v.douyin.com/iAbCdEf/").hostname).toBe("v.douyin.com");
  });

  it("rejects alternative spellings of loopback", () => {
    // Decimal and hex whole-number forms resolve to 127.0.0.1 without a dot.
    expect(() => assertPublicFetchUrl("http://2130706433/")).toThrow(/Private|reserved/i);
    expect(() => assertPublicFetchUrl("http://0x7f000001/")).toThrow(/Private|reserved/i);
    // Leading-zero octets can be read as octal (0177 = 127).
    expect(() => assertPublicFetchUrl("http://0177.0.0.1/")).toThrow(/Private|reserved/i);
  });

  it("rejects IPv6 loopback and private ranges", () => {
    expect(() => assertPublicFetchUrl("http://[::1]/")).toThrow(/Private|reserved/i);
    expect(() => assertPublicFetchUrl("http://[fd00::1]/")).toThrow(/Private|reserved/i);
    expect(() => assertPublicFetchUrl("http://[fe80::1]/")).toThrow(/Private|reserved/i);
  });

  it("rejects reserved and test ranges", () => {
    for (const host of ["100.64.0.1", "198.18.1.1", "192.0.2.5", "198.51.100.9", "203.0.113.4", "239.1.1.1"]) {
      expect(() => assertPublicFetchUrl(`http://${host}/`), host).toThrow(/Private|reserved/i);
    }
  });

  it("still accepts ordinary public hosts", () => {
    expect(assertPublicFetchUrl("https://xhslink.com/a/abc").hostname).toBe("xhslink.com");
  });
});
