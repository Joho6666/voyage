import { NextResponse } from "next/server";
import { z } from "zod";
import { FliggyTopError, createFliggyTopClient } from "@/services/booking/fliggy-top";

const querySchema = z.object({
  hotelId: z.string().min(1).max(80),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.coerce.number().int().min(1).max(10),
  children: z.coerce.number().int().min(0).max(10).default(0),
  childrenAges: z.string().optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    hotelId: url.searchParams.get("hotelId") ?? "",
    checkIn: url.searchParams.get("checkIn") ?? "",
    checkOut: url.searchParams.get("checkOut") ?? "",
    adults: url.searchParams.get("adults") ?? "",
    children: url.searchParams.get("children") ?? "0",
    childrenAges: url.searchParams.get("childrenAges") ?? undefined,
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

  const childrenAges = parsed.data.childrenAges
    ? parsed.data.childrenAges.split(",").filter(Boolean).map(Number)
    : undefined;
  if (childrenAges && (childrenAges.length !== parsed.data.children || childrenAges.some((age) => !Number.isInteger(age) || age < 0 || age > 17))) {
    return NextResponse.json({ ok: false, code: "INVALID_CHILDREN_AGES" }, { status: 400 });
  }

  try {
    const data = await client.availability({
      hotelId: parsed.data.hotelId,
      checkIn: parsed.data.checkIn,
      checkOut: parsed.data.checkOut,
      adults: parsed.data.adults,
      children: parsed.data.children,
      childrenAges,
    });
    return NextResponse.json({ ok: true, source: "fliggy", data });
  } catch (error) {
    const code = error instanceof FliggyTopError ? error.code || "FLIGGY_API_ERROR" : "FLIGGY_API_ERROR";
    return NextResponse.json({ ok: false, code, message: error instanceof Error ? error.message : "Fliggy request failed" }, { status: 502 });
  }
}
