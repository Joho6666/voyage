import { NextResponse } from "next/server";
import { z } from "zod";
import { FliggyTopError, createFliggyTopClient } from "@/services/booking/fliggy-top";

const querySchema = z.object({
  afterModifiedTime: z.string().max(19).optional(),
  language: z.enum(["zh_CN", "en_US"]).default("zh_CN"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(50),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    afterModifiedTime: url.searchParams.get("afterModifiedTime") ?? undefined,
    language: url.searchParams.get("language") ?? "zh_CN",
    page: url.searchParams.get("page") ?? "1",
    size: url.searchParams.get("size") ?? "50",
  });

  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST", issues: parsed.error.issues }, { status: 400 });
  }

  const client = createFliggyTopClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, code: "FLIGGY_NOT_CONFIGURED", message: "Fliggy server credentials are not configured" },
      { status: 503 },
    );
  }

  try {
    const data = await client.feedHotels(parsed.data);
    return NextResponse.json({ ok: true, source: "fliggy", data });
  } catch (error) {
    const code = error instanceof FliggyTopError ? error.code || "FLIGGY_API_ERROR" : "FLIGGY_API_ERROR";
    return NextResponse.json({ ok: false, code, message: error instanceof Error ? error.message : "Fliggy request failed" }, { status: 502 });
  }
}
