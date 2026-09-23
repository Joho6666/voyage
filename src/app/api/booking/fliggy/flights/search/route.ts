import { NextResponse } from "next/server";
import { z } from "zod";
import { FliggyTopError, createFliggyTopClient } from "@/services/booking/fliggy-top";

const querySchema = z.object({
  departureCityCode: z.string().regex(/^[A-Z]{3}$/),
  arrivalCityCode: z.string().regex(/^[A-Z]{3}$/),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tripType: z.coerce.number().int().refine((value): value is 1 | 2 => value === 1 || value === 2).default(1),
  cabinClass: z.enum(["ALL_CABIN", "Y", "FC", "F", "C"]).default("ALL_CABIN"),
  externalAgentName: z.string().min(1).max(80),
  searchMode: z.coerce.number().int().refine((value): value is 0 | 2 => value === 0 || value === 2).default(2),
  hasChild: z.coerce.boolean().default(false),
  hasInfant: z.coerce.boolean().default(false),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
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
    const data = await client.flightSearch(parsed.data);
    return NextResponse.json({ ok: true, source: "fliggy", data });
  } catch (error) {
    const code = error instanceof FliggyTopError ? error.code || "FLIGGY_API_ERROR" : "FLIGGY_API_ERROR";
    return NextResponse.json({ ok: false, code, message: error instanceof Error ? error.message : "Fliggy request failed" }, { status: 502 });
  }
}
