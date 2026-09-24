import { NextResponse } from "next/server";
import { z } from "zod";
import { FliggyTopError, createFliggyTopClient } from "@/services/booking/fliggy-top";

const querySchema = z.object({
  shids: z.string().min(1).transform((value) => value.split(",").map(Number)),
  language: z.enum(["zh_CN", "en_US"]).default("zh_CN"),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    shids: url.searchParams.get("shids") ?? "",
    language: url.searchParams.get("language") ?? "zh_CN",
  });

  if (!parsed.success || parsed.data.shids.some((shid) => !Number.isSafeInteger(shid) || shid <= 0) || parsed.data.shids.length > 50) {
    return NextResponse.json({ ok: false, code: "INVALID_SHIDS" }, { status: 400 });
  }

  const client = createFliggyTopClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, code: "FLIGGY_NOT_CONFIGURED", message: "Fliggy server credentials are not configured" },
      { status: 503 },
    );
  }

  try {
    const data = await client.hotelInfo(parsed.data.shids, parsed.data.language);
    return NextResponse.json({ ok: true, source: "fliggy", data });
  } catch (error) {
    const code = error instanceof FliggyTopError ? error.code || "FLIGGY_API_ERROR" : "FLIGGY_API_ERROR";
    return NextResponse.json({ ok: false, code, message: error instanceof Error ? error.message : "Fliggy request failed" }, { status: 502 });
  }
}
