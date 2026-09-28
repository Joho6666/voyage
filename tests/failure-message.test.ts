import { describe, expect, it } from "vitest";
import { z } from "zod";
import { failureMessage, toolContextMessage } from "@/lib/failure-message";

describe("failureMessage", () => {
  it("maps a ZodError to a readable field message instead of a JSON issue dump", () => {
    const schema = z.object({ days: z.number().int().max(7) });
    const error = schema.safeParse({ days: 365 }).error!;
    const message = failureMessage(error, "fallback");
    expect(message).toContain("days");
    expect(message).toContain("不合法");
    expect(message).not.toContain("too_big");
    expect(message).not.toContain("{");
  });

  it("refuses JSON-shaped error text and returns the fallback", () => {
    const dump = '[{"code":"too_big","maximum":31,"path":["days"]}]';
    expect(failureMessage(new Error(dump), "无法处理")).toBe("无法处理");
    expect(failureMessage(new Error(' {"a":1}'), "无法处理")).toBe("无法处理");
  });

  it("redacts long token-like substrings from provider messages", () => {
    const leaked = "upstream rejected key ABCDEF1234567890ABCDEF1234567890";
    const message = failureMessage(new Error(leaked), "fallback");
    expect(message).toContain("[REDACTED]");
    expect(message).not.toContain("ABCDEF1234567890ABCDEF1234567890");
  });

  it("truncates long messages", () => {
    const message = failureMessage(new Error("x".repeat(500)), "fallback");
    expect(message.length).toBeLessThanOrEqual(200);
  });

  it("keeps short human messages intact", () => {
    expect(failureMessage(new Error("上游连接失败"), "fallback")).toBe("上游连接失败");
    expect(failureMessage("not an error", "fallback")).toBe("fallback");
  });
});

describe("toolContextMessage", () => {
  it("never hands a Zod dump to the model", () => {
    const schema = z.object({ dayId: z.string() });
    const error = schema.safeParse({ dayId: 5 }).error!;
    const message = toolContextMessage(error);
    expect(message).not.toContain("[{");
    expect(message).toContain("dayId");

    // A root-level failure has no field path; it must still read as a sentence.
    const rootError = schema.safeParse(42).error!;
    expect(toolContextMessage(rootError)).toBe("提交的信息不合法，请检查后重试。");
  });
});
